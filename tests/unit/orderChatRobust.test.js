// ============================================================
//  Unit-teszt — handlers/orderChat.js (💬 Szöveges fuvarkiírás)
//  DB, AI, ANAF, útvonal és a comCreate mockolva — nincs valódi hálózat.
// ============================================================
let mockRules = [];          // [{ match: RegExp, rows | fn }]
const mockDbQuery = jest.fn(async (sql, params) => {
  for (const r of mockRules) {
    if (r.match.test(sql)) return r.fn ? r.fn(sql, params) : { rows: r.rows || [] };
  }
  return { rows: [] };
});
jest.mock('../../db', () => ({ query: (...a) => mockDbQuery(...a) }));
jest.mock('../../lib/audit', () => ({ fromReq: async () => {} }));
let mockFeatureOn = true;
jest.mock('../../lib/featureEnabled', () => ({ featureEnabled: async () => mockFeatureOn }));
const mockExtract = jest.fn();
jest.mock('../../lib/geminiJson', () => ({ extractJson: (...a) => mockExtract(...a) }));
// Az AI-útválasztás (lib/chatRouter) külön tesztelt — itt a fuvar-vázlat útját nézzük.
const mockRoute = jest.fn(async () => ({ delegate: 'draft' }));
jest.mock('../../lib/chatRouter', () => ({ route: (...a) => mockRoute(...a) }));
const mockAnaf = jest.fn();
jest.mock('../../services/clients', () => {
  const real = jest.requireActual('../../services/clients');
  return { normalizeCui: real.normalizeCui, validateCui: real.validateCui, anafLookup: (...a) => mockAnaf(...a) };
});
jest.mock('../../lib/routeEstimate', () => ({
  estimateRoute: async (wps) => ({
    km: 1234, durationSeconds: 3600,
    waypoints: wps.map((w, i) => ({ type: w.type, label: w.address, lat: 45 + i, lng: 25 + i })), legs: [],
  }),
}));
const mockComCreate = jest.fn(async (req, res) => res.json({ result: { ok: true, id: 'CMD-X1', fuvar_no: 'CMD-2026-0042' } }));
const mockComUpdate = jest.fn(async (req, res) => res.json({ result: { ok: true } }));
jest.mock('../../handlers/orders', () => ({
  comCreate: (...a) => mockComCreate(...a),
  comUpdate: (...a) => mockComUpdate(...a),
}));

const h = require('../../handlers/orderChat');

function call(fn, user, args) {
  return new Promise((resolve) => {
    h[fn]({ session: { user } }, { json: (p) => resolve(p.result) }, args);
  });
}
const ADMIN = { id: 1, email: 'a@x', pozicio: 'Admin', company_id: 7 };

// ============================================================
//  Robusztusság — a 💬 fuvar-chat ne bukjon el hibás AI-válasz,
//  sérült tanult adat vagy szélsőséges bemenet miatt.
// ============================================================
beforeEach(() => {
  mockFeatureOn = true; mockRules = [];
  mockDbQuery.mockClear(); mockExtract.mockReset();
});

// Determinisztikus „véletlen" generátor (a fuzz minden futásnál ugyanaz).
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const JUNK = [null, undefined, '', ' ', 0, -1, 1e12, NaN, Infinity, true, false, {}, [], { a: 1 }, ['x'],
  'x'.repeat(5000), '<script>alert(1)</script>', "'; DROP TABLE orders; --", '2026-02-30', '2026-13-01',
  '2026-10-12T25:99', 'Brașov', '12,5', '1 234', '-5', 'NULL', '{"a":1}', () => 1];
function junk(r) { return JUNK[Math.floor(r() * JUNK.length)]; }
function junkDraft(r) {
  const d = {};
  ['client', 'client_cui', 'client_id', 'ref', 'load_type', 'suly_kg', 'hossz_cm', 'szel_cm', 'mag_cm', 'pret', 'km',
    'driver_name', 'email_sofer', 'nume_sofer', 'rendszam_camion', 'rendszam_remorca', 'route_sig', 'route_km',
    'route_geo', 'edit_order_id', 'edit_fuvar_no', 'driver_raw', 'uit_codes', 'edit_uit_existing', '__proto_x']
    .forEach((k) => { if (r() < 0.8) d[k] = junk(r); });
  if (r() < 0.8) {
    d.stops = r() < 0.2 ? junk(r) : Array.from({ length: Math.floor(r() * 30) }, () => (r() < 0.2 ? junk(r) : {
      kind: ['pickup', 'delivery', 'PICKUP', 'x', null][Math.floor(r() * 5)], loc: junk(r), firma: junk(r), data: junk(r),
    }));
  }
  return d;
}
const TYPES = {
  client: 'str', client_cui: 'str', ref: 'str', driver_name: 'str', email_sofer: 'str', nume_sofer: 'str',
  rendszam_camion: 'str', rendszam_remorca: 'str', route_sig: 'str', edit_fuvar_no: 'str', driver_raw: 'str',
  client_id: 'int', hossz_cm: 'int', szel_cm: 'int', mag_cm: 'int', km: 'int', route_km: 'int', edit_uit_existing: 'int',
  suly_kg: 'num', pret: 'num',
};
function assertClean(d) {
  for (const [k, t] of Object.entries(TYPES)) {
    const v = d[k];
    if (v == null) continue;
    if (t === 'str') { expect(typeof v).toBe('string'); expect(v).not.toMatch(/\[object |^function|=>/); }
    else { expect(typeof v).toBe('number'); expect(Number.isFinite(v)).toBe(true); expect(v).toBeGreaterThanOrEqual(0); }
    if (t === 'int') expect(Number.isInteger(v)).toBe(true);
  }
  expect([null, 'FTL', 'LTL']).toContain(d.load_type);
  expect(Array.isArray(d.stops)).toBe(true);
  expect(d.stops.length).toBeLessThanOrEqual(20);
  d.stops.forEach((s) => {
    expect(['pickup', 'delivery']).toContain(s.kind);
    if (s.data != null) expect(s.data).toMatch(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/);
    if (s.loc != null) expect(s.loc.length).toBeLessThanOrEqual(200);
  });
  expect(Array.isArray(d.uit_codes)).toBe(true);
  expect(d.route_geo === null || typeof d.route_geo === 'object').toBe(true);
  expect(Object.keys(d)).not.toContain('__proto_x');
}

describe('sanitizeDraft — fuzz (hibás AI / kliens-vázlat)', () => {
  test('1000 véletlen hibás vázlat: sosem dob, minden mező a helyes típusú', () => {
    const r = rng(42);
    for (let i = 0; i < 1000; i++) {
      let out;
      expect(() => { out = h._sanitizeDraft(junkDraft(r)); }).not.toThrow();
      assertClean(out);
    }
  });
  test.each([[null], [undefined], ['szöveg'], [42], [[]], [true]])('nem objektum (%p) → üres, tiszta vázlat', (v) => {
    const d = h._sanitizeDraft(v);
    assertClean(d);
    expect(d.stops).toEqual([]);
    expect(d.client).toBeNull();
  });
  test('objektumként jövő mező nem lesz „[object Object]"', () => {
    const d = h._sanitizeDraft({ client: { name: 'X' }, driver_name: ['Pisti'],
      stops: [{ kind: 'pickup', loc: { city: 'Arad' }, firma: 'Bilka', data: '2026-10-12' }] });
    expect(d.client).toBeNull();
    expect(d.driver_name).toBeNull();
    expect(d.stops[0].loc).toBeNull();
    expect(d.stops[0].firma).toBe('Bilka');
  });
  test('érvénytelen naptári dátum eldobva, rossz óra levágva', () => {
    const d = h._sanitizeDraft({ stops: [
      { kind: 'pickup', loc: 'A', data: '2026-02-30' },
      { kind: 'delivery', loc: 'B', data: '2026-10-12T25:00' },
      { kind: 'delivery', loc: 'C', data: '2026-10-12T08:30' }] });
    expect(d.stops.map((s) => s.data)).toEqual([null, '2026-10-12', '2026-10-12T08:30']);
  });
  test('negatív / nem szám ár és súly → null; vesszős tizedes elfogadva', () => {
    const d = h._sanitizeDraft({ pret: '-5', suly_kg: '12,5', km: 'sok' });
    expect(d.pret).toBeNull(); expect(d.suly_kg).toBe(12.5); expect(d.km).toBeNull();
  });
  test('edit_order_id csak biztonságos azonosító lehet', () => {
    expect(h._sanitizeDraft({ edit_order_id: "CMD-1'; DROP" }).edit_order_id).toBeNull();
    expect(h._sanitizeDraft({ edit_order_id: 'CMD-MT181GD5NBL' }).edit_order_id).toBe('CMD-MT181GD5NBL');
  });
  test('max. 20 állomás, üres állomás kiesik', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ kind: 'delivery', loc: 'L' + i }));
    expect(h._sanitizeDraft({ stops: many }).stops).toHaveLength(20);
    expect(h._sanitizeDraft({ stops: [{ kind: 'pickup' }, { kind: 'pickup', loc: ' ' }] }).stops).toEqual([]);
  });
});

describe('orderChatTurn — hibás AI-válaszok sem buktatják el', () => {
  const turn = () => call('orderChatTurn', ADMIN, [{ messages: [{ role: 'user', text: 'fuvar Brassóból Aradra holnap' }], draft: {}, lang: 'hu' }]);
  test.each([
    ['json null', { model: 'm', json: null }],
    ['json üres', { model: 'm', json: {} }],
    ['draft szöveg', { model: 'm', json: { draft: 'nincs', reply: 'ok' } }],
    ['draft tömb', { model: 'm', json: { draft: [1, 2], reply: 'ok' } }],
    ['stops szöveg', { model: 'm', json: { draft: { stops: 'Arad' } } }],
    ['questions objektum', { model: 'm', json: { draft: {}, questions: { key: 'x' } } }],
    ['questions szemét', { model: 'm', json: { draft: {}, questions: [null, 1, 'x', { text: { a: 1 } }, { text: 'Mikor?', options: 'holnap' }] } }],
    ['reply objektum', { model: 'm', json: { draft: {}, reply: { hu: 'x' } } }],
    ['ai undefined', undefined],
  ])('%s → ok:true, tiszta vázlat', async (_n, aiOut) => {
    mockExtract.mockResolvedValue(aiOut);
    const r = await turn();
    expect(r.ok).toBe(true);
    expect(typeof r.reply).toBe('string');
    expect(r.reply).not.toMatch(/\[object /);
    assertClean(Object.assign({ uit_codes: [], route_geo: null }, r.draft));
    expect(Array.isArray(r.questions)).toBe(true);
    r.questions.forEach((q) => { expect(typeof q.text).toBe('string'); expect(Array.isArray(q.options)).toBe(true); });
    expect(r.questions.length).toBeLessThanOrEqual(4);
  });
  test('200 véletlen AI-válasz: soha nem „Eroare de server"', async () => {
    const r0 = rng(7);
    for (let i = 0; i < 200; i++) {
      mockExtract.mockResolvedValueOnce({ model: 'm', json: { reply: junk(r0), draft: junkDraft(r0), questions: junk(r0) } });
      const r = await turn();
      expect(r.ok).toBe(true);
    }
  });
  test.each([
    ['NO_KEY', Object.assign(new Error('x'), { code: 'NO_KEY' }), /nu este configurat/],
    ['időtúllépés', Object.assign(new Error('Serviciul AI nu a răspuns la timp (30 s).'), { status: 504 }), /nu a răspuns la timp/],
    ['kvóta', Object.assign(new Error('Cota gratuită AI a fost epuizată'), { status: 429 }), /Cota/],
    ['nagyon hosszú hiba', new Error('x'.repeat(5000)), /^x+$/],
  ])('AI-hiba (%s) → ok:false, érthető, rövid üzenet, nincs stack', async (_n, err, re) => {
    mockExtract.mockRejectedValue(err);
    const r = await turn();
    expect(r.ok).toBe(false);
    expect(r.err).toMatch(re);
    expect(r.err.length).toBeLessThanOrEqual(300);
    expect(r.err).not.toMatch(/at .*\.js:\d+/);
  });
  test('DB-hiba a feloldás közben → általános hiba, nem szivárog részlet', async () => {
    mockExtract.mockResolvedValue({ model: 'm', json: { draft: { driver_name: 'Pisti', stops: [{ kind: 'pickup', loc: 'Arad', firma: 'X' }] } } });
    mockRules = [{ match: /./, fn: () => { throw new Error('connection terminated: secret-host:5432'); } }];
    const r = await turn();
    if (!r.ok) expect(r.err).not.toMatch(/secret-host/);
  });
});

describe('tanult adatok — sérült / régi formátumú memória sem buktat', () => {
  test.each([
    ['null', null], ['szöveg', 'Arad'], ['szám', 5], ['tömb', ['Arad']],
    ['locs szöveg', { locs: 'Arad' }], ['locs vegyes', { locs: [null, {}, 'Str. 1, Arad', 7, ['x'], '  '] }],
    ['régi egyes', { loc: 'Str. 1, Arad' }],
  ])('_locList(%s) → csak szöveges címek listája', (_n, v) => {
    const l = h._locList(v);
    expect(Array.isArray(l)).toBe(true);
    l.forEach((x) => { expect(typeof x).toBe('string'); expect(x).not.toMatch(/\[object /); expect(x.trim()).toBe(x); expect(x).not.toBe(''); });
  });
  test.each([
    ['null', null], ['szöveg', 'Bilka'], ['clients szöveg', { clients: 'Bilka' }],
    ['clients vegyes', { clients: [null, 'Bilka', { client: {} }, { client: '  ' }, { client: 'Ok SRL', client_id: 'abc' }, { client: 'Id SRL', client_id: '12' }] }],
    ['régi egyes', { client: 'Bilka SRL', client_id: 3 }],
  ])('_clientList(%s) → tiszta megrendelő-lista', (_n, v) => {
    const l = h._clientList(v);
    expect(Array.isArray(l)).toBe(true);
    l.forEach((c) => {
      expect(typeof c.client).toBe('string'); expect(c.client).not.toMatch(/\[object /);
      expect(c.client_id === null || Number.isInteger(c.client_id)).toBe(true);
    });
  });
  test('_clientList: a hibás id null lesz, a jó id szám', () => {
    const l = h._clientList({ clients: [{ client: 'Ok SRL', client_id: 'abc' }, { client: 'Id SRL', client_id: '12' }] });
    expect(l).toEqual([{ client: 'Ok SRL', client_id: null }, { client: 'Id SRL', client_id: 12 }]);
  });
  test('túl hosszú tárolt lista 300-ra vágva', () => {
    const v = { locs: Array.from({ length: 1000 }, (_, i) => 'Str. ' + i) };
    expect(h._locList(v)).toHaveLength(300);
  });
  test('_addFront: legutóbbi elöl, duplikátum (ékezet/kisbetű-független) nélkül, max 300', () => {
    const fold = (x) => x.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    let list = [];
    for (let i = 0; i < 400; i++) list = h._addFront(list, 'Str. ' + i, fold);
    expect(list).toHaveLength(300);
    expect(list[0]).toBe('Str. 399');
    list = h._addFront(list, 'STR. 5', fold);
    expect(list[0]).toBe('STR. 5');
    expect(list.filter((x) => fold(x) === 'str. 5')).toHaveLength(1);
  });
  test('tanulás sérült memóriával: nem dob, tiszta listát ír vissza', async () => {
    const written = [];
    mockRules = [
      { match: /SELECT value FROM order_chat_memory/, rows: [{ value: { locs: [null, {}, 'Str. Vechi 1, Arad'], clients: 'x' } }] },
      { match: /INSERT INTO order_chat_memory/, fn: (sql, p) => { written.push({ kind: p[1], key: p[2], value: JSON.parse(p[3]) }); return { rows: [] }; } },
    ];
    await expect(h._learnFromDraft(7, h._sanitizeDraft({
      client: 'Bilka SRL', client_id: 3, load_type: 'FTL',
      stops: [{ kind: 'pickup', firma: 'Bilka Steel', loc: 'Str. Nouă 5, Brașov' }],
    }))).resolves.toBeUndefined();
    const fa = written.find((w) => w.kind === 'firma_addr');
    expect(fa.value.locs).toEqual(['Str. Nouă 5, Brașov', 'Str. Vechi 1, Arad']);
    expect(fa.value.loc).toBe('Str. Nouă 5, Brașov');
    const pc = written.find((w) => w.kind === 'pickup_client');
    expect(pc.value.clients).toEqual([{ client: 'Bilka SRL', client_id: 3 }]);
  });
  test('tanulás DB-hibánál: a fuvar mentése nem bukik (nem dob)', async () => {
    mockRules = [{ match: /order_chat_memory/, fn: () => { throw new Error('db down'); } }];
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(h._learnFromDraft(7, h._sanitizeDraft({ client: 'X', load_type: 'FTL',
      stops: [{ kind: 'pickup', firma: 'F', loc: 'Str. 1, Arad' }] }))).resolves.toBeUndefined();
    spy.mockRestore();
  });
  test('cím szám nélkül (csak helység) nem kerül a tanult címek közé', async () => {
    const written = [];
    mockRules = [{ match: /INSERT INTO order_chat_memory/, fn: (sql, p) => { written.push(p[1]); return { rows: [] }; } }];
    await h._learnFromDraft(7, h._sanitizeDraft({ stops: [{ kind: 'pickup', firma: 'F', loc: 'Arad' }] }));
    expect(written).not.toContain('firma_addr');
  });
});

describe('helység-egyezés (_townMatch) — szélsőséges esetek', () => {
  test.each([
    ['Str. Aradului 5, Timișoara', 'Arad', false],
    ['Calea Aradului, Arad', 'Arad', true],
    ['ARAD, jud. Arad', 'arad', true],
    ['Brașov, RO', 'Brasov', true],
    ['Târgu Mureș', 'targu mures', true],
    ['Târgu Mureș', 'Mures', true],
    ['Sfântu Gheorghe', 'Gheorghe', true],
    ['Ploiești', 'Ploiesti-Vest', false],
    ['', 'Arad', false],
    ['Arad', '', false],
    [null, null, false],
    ['Arad', '   ', false],
  ])('%p ↔ %p → %p', (addr, town, exp) => { expect(h._townMatch(addr, town)).toBe(exp); });
});

describe('„módosítottam" állítás-őr (claimsChange)', () => {
  test.each([
    'Beírtam Ploieștit a hétfői felrakáshoz.', 'átírtam a dátumot', 'Am actualizat locul de încărcare.',
    'am schimbat șoferul', 'Módosítottam a lerakót', 'hozzáadtam egy lerakót',
  ])('állítás: %p', (t) => { expect(h._claimsChange(t)).toBe(true); });
  test.each(['Melyik helységben?', 'Rendben.', 'Cine este beneficiarul?', '', null])('nem állítás: %p', (t) => {
    expect(h._claimsChange(t)).toBe(false);
  });
});
