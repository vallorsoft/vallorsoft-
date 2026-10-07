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
const SOFER = { id: 3, email: 's@x', pozicio: 'Sofer', company_id: 7 };

const AI_DRAFT = {
  client: null, client_cui: null,
  stops: [
    { kind: 'pickup', loc: 'Brașov, RO', firma: 'Bilka Steel SRL', data: '2026-10-12' },
    { kind: 'delivery', loc: 'Bicske, HU', firma: 'Cegnev Kft', data: '2026-10-13' },
    { kind: 'delivery', loc: 'Košice, SK', firma: 'Cegnev 2 Kft', data: '2026-10-14' },
  ],
  load_type: 'FTL', driver_name: 'Peto Lorincz Imre Norbert',
};

beforeEach(() => {
  mockFeatureOn = true;
  mockRules = [];
  mockDbQuery.mockClear(); mockExtract.mockReset(); mockAnaf.mockReset(); mockComCreate.mockClear(); mockComUpdate.mockClear();
});

describe('kapuk', () => {
  test('Sofőr nem használhatja', async () => {
    const r = await call('orderChatTurn', SOFER, [{ messages: [{ role: 'user', text: 'x' }] }]);
    expect(r.ok).toBe(false);
    expect(mockExtract).not.toHaveBeenCalled();
  });
  test('csomag-kapu (Pro alatt kikapcsolva)', async () => {
    mockFeatureOn = false;
    const r = await call('orderChatTurn', ADMIN, [{ messages: [{ role: 'user', text: 'x' }] }]);
    expect(r.ok).toBe(false);
    expect(r.err).toMatch(/Pro/);
  });
  test('üres üzenet', async () => {
    const r = await call('orderChatTurn', ADMIN, [{ messages: [] }]);
    expect(r.ok).toBe(false);
  });
});

describe('orderChatTurn — a példa-fuvar', () => {
  test('sofőr feloldva + hozzárendelt vontató + alap pótkocsi + auto-km; megrendelőre rákérdez', async () => {
    mockExtract.mockResolvedValue({ model: 'm', json: { reply: 'Rendben.', draft: AI_DRAFT, questions: [] } });
    mockRules = [
      { match: /FROM users WHERE company_id=\$1 AND pozicio='Sofer'/, rows: [
        { email: 'Peto@X.ro', nume: 'Pető-Lőrincz Imre Norbert' }, { email: 'b@x', nume: 'Bela Kovacs' }] },
      { match: /assigned_driver_email\)=LOWER\(\$2\)/, rows: [{ rendszam: 'B104VLR' }] },
      { match: /default_trailer_id/, rows: [{ rendszam: 'CJ36VSN' }] },
    ];
    const r = await call('orderChatTurn', ADMIN, [{ messages: [{ role: 'user', text: 'fuvar…' }], draft: {}, lang: 'hu' }]);
    expect(r.ok).toBe(true);
    expect(r.draft.email_sofer).toBe('peto@x.ro');
    expect(r.draft.nume_sofer).toBe('Pető-Lőrincz Imre Norbert');
    expect(r.draft.rendszam_camion).toBe('B104VLR');
    expect(r.draft.rendszam_remorca).toBe('CJ36VSN');
    expect(r.draft.route_km).toBe(1234);
    expect(r.draft.stops).toHaveLength(3);
    expect(r.missing).toEqual(['client']);
    expect(r.ready).toBe(false);
    const q = r.questions.find((x) => x.key === 'client');
    expect(q.text).toMatch(/megrendelő/i);            // HU felület → HU kérdés
    expect(q.options).toContain('Bilka Steel SRL');
    // A sofőr-/jármű-lista NEM megy az AI-hoz — csak a beszélgetés + vázlat.
    const sent = JSON.stringify(mockExtract.mock.calls[0][0]);
    expect(sent).not.toMatch(/Bela Kovacs/);
    // A prompt a mai dátumot tartalmazza a relatív napokhoz.
    expect(mockExtract.mock.calls[0][0].systemPrompt).toMatch(/TODAY is \d{4}-\d{2}-\d{2}/);
  });

  test('CUI → ANAF lekérés + MENTÉS az ügyfelek közé, a vázlat ehhez kötődik', async () => {
    mockExtract.mockResolvedValue({ model: 'm', json: { reply: 'ok', draft: Object.assign({}, AI_DRAFT, { client_cui: 'RO47859317', driver_name: null }), questions: [] } });
    mockAnaf.mockResolvedValue({ found: true, name: 'VALLOR TEAM SRL', cui: '47859317', address: 'Arcuș, Jud. Covasna', regCom: 'J2023000114142', active: true });
    let inserted = null;
    mockRules = [
      { match: /regexp_replace\(UPPER\(COALESCE\(cui_cif/, rows: [] },
      { match: /INSERT INTO clients/, fn: (sql, p) => { inserted = p; return { rows: [{ id: 55, denumire: 'VALLOR TEAM SRL' }] }; } },
    ];
    const r = await call('orderChatTurn', ADMIN, [{ messages: [{ role: 'user', text: 'megrendelő CUI 47859317' }], draft: {} }]);
    expect(mockAnaf).toHaveBeenCalledWith('47859317');
    expect(inserted[0]).toBe(7);                          // cégre szűrt beszúrás
    expect(r.draft.client_id).toBe(55);
    expect(r.draft.client).toBe('VALLOR TEAM SRL');
    expect(r.notes.some((n) => n.type === 'client_saved')).toBe(true);
    expect(r.ready).toBe(true);
  });

  test('már meglévő CUI → nincs ANAF-hívás, nincs új ügyfél', async () => {
    mockExtract.mockResolvedValue({ model: 'm', json: { reply: '', draft: Object.assign({}, AI_DRAFT, { client_cui: '47859317', driver_name: null }) } });
    mockRules = [{ match: /regexp_replace\(UPPER\(COALESCE\(cui_cif/, rows: [{ id: 9, denumire: 'Vallor Team' }] }];
    const r = await call('orderChatTurn', ADMIN, [{ messages: [{ role: 'user', text: 'x' }] }]);
    expect(mockAnaf).not.toHaveBeenCalled();
    expect(r.draft.client_id).toBe(9);
  });

  test('idegen client_id a kliensről → eldobva (cross-tenant védelem)', async () => {
    mockExtract.mockResolvedValue({ model: 'm', json: { reply: '', draft: Object.assign({}, AI_DRAFT, { client: 'Idegen SRL', driver_name: null }) } });
    mockRules = [{ match: /SELECT id, denumire, cui_cif FROM clients WHERE id=\$1 AND company_id=\$2/, rows: [] }];
    const r = await call('orderChatTurn', ADMIN, [{ messages: [{ role: 'user', text: 'x' }], draft: { client: 'Idegen SRL', client_id: 999 } }]);
    expect(r.draft.client_id).toBeNull();
  });

  test('ismeretlen sofőr → rákérdez, nincs hozzárendelés', async () => {
    mockExtract.mockResolvedValue({ model: 'm', json: { reply: '', draft: Object.assign({}, AI_DRAFT, { client: 'X' }) } });
    mockRules = [{ match: /pozicio='Sofer' AND blocked IS NOT TRUE ORDER BY nume/, rows: [{ email: 'b@x', nume: 'Bela Kovacs' }] }];
    const r = await call('orderChatTurn', ADMIN, [{ messages: [{ role: 'user', text: 'x' }] }]);
    expect(r.draft.email_sofer).toBeNull();
    expect(r.questions.some((q) => q.key === 'driver')).toBe(true);
  });

  test('LTL méret nélkül → hiányzik', async () => {
    mockExtract.mockResolvedValue({ model: 'm', json: { reply: '', draft: Object.assign({}, AI_DRAFT, { client: 'X', load_type: 'LTL', driver_name: null }) } });
    const r = await call('orderChatTurn', ADMIN, [{ messages: [{ role: 'user', text: 'x' }] }]);
    expect(r.missing).toContain('dims');
  });

  test('AI-hiba → érthető hiba, nincs szerver-összeomlás', async () => {
    const e = new Error('nincs kulcs'); e.code = 'NO_KEY';
    mockExtract.mockRejectedValue(e);
    const r = await call('orderChatTurn', ADMIN, [{ messages: [{ role: 'user', text: 'x' }] }]);
    expect(r.ok).toBe(false);
    expect(r.err).toMatch(/AI/);
  });
});

describe('orderChatCreate', () => {
  const READY = Object.assign({}, AI_DRAFT, { client: 'VALLOR TEAM SRL', client_id: 55, driver_name: null, pret: 1500 });

  test('hiányos vázlat → nem ment', async () => {
    const r = await call('orderChatCreate', ADMIN, [{ draft: Object.assign({}, READY, { load_type: null }) }]);
    expect(r.ok).toBe(false);
    expect(mockComCreate).not.toHaveBeenCalled();
  });

  test('kész vázlat → comCreate a sorrendben megadott állomásokkal + ügyfél-kötés', async () => {
    let linked = null;
    mockRules = [
      { match: /SELECT id, denumire, cui_cif FROM clients WHERE id=\$1/, rows: [{ id: 55, denumire: 'VALLOR TEAM SRL' }] },
      { match: /UPDATE orders SET client_id/, fn: (s, p) => { linked = p; return { rows: [] }; } },
    ];
    const r = await call('orderChatCreate', ADMIN, [{ draft: READY }]);
    expect(r.ok).toBe(true);
    expect(r.fuvar_no).toBe('CMD-2026-0042');
    const payload = mockComCreate.mock.calls[0][2][0];
    expect(payload.stops.map((s) => s.kind)).toEqual(['pickup', 'delivery', 'delivery']);
    expect(payload.loc_incarcare).toBe('Brașov, RO');
    expect(payload.loc_descarcare).toBe('Košice, SK');
    expect(payload.load_type).toBe('FTL');
    expect(payload.km).toBe(1234);
    expect(linked).toEqual([55, 'CMD-X1', 7]);
  });

  test('a kliens által küldött idegen sofőr-e-mail nem kerül a fuvarra', async () => {
    mockRules = [{ match: /LOWER\(email\)=LOWER\(\$2\)/, rows: [] }];
    await call('orderChatCreate', ADMIN, [{ draft: Object.assign({}, READY, { client_id: null, email_sofer: 'idegen@masik.ro', nume_sofer: 'Idegen' }) }]);
    const payload = mockComCreate.mock.calls[0][2][0];
    expect(payload.email_sofer).toBeNull();
    expect(payload.sofer_type).toBeNull();
  });
});

describe('segédek', () => {
  test('sanitizeDraft: érvénytelen dátum, ismeretlen stop-típus, rendszám-normalizálás', () => {
    const d = h._sanitizeDraft({
      stops: [{ kind: 'pickup', loc: 'A', data: '2026-02-30' }, { kind: 'x', loc: 'B' }, { kind: 'delivery', loc: 'C', data: '2026-10-14T08:30' }],
      load_type: 'ltl', rendszam_camion: 'b 104 vlr', pret: '1 250,5',
    });
    expect(d.stops).toHaveLength(2);
    expect(d.stops[0].data).toBeNull();
    expect(d.stops[1].data).toBe('2026-10-14T08:30');
    expect(d.load_type).toBe('LTL');
    expect(d.rendszam_camion).toBe('B104VLR');
    expect(d.pret).toBe(1250.5);
  });
  test('_today Bukarest szerint', () => {
    expect(h._today(new Date('2026-10-07T22:30:00Z'))).toEqual({ ymd: '2026-10-08', weekday: 'Thursday' });
  });
  test('belső segédek nem RPC-k', () => {
    expect(Object.keys(h).sort()).toEqual(['orderChatCreate', 'orderChatTurn']);
  });
});

describe('tanulás', () => {
  test('mentés után a cím / felrakó→megrendelő / áru / sofőr-becenév bekerül a memóriába', async () => {
    const puts = [];
    mockRules = [
      { match: /INSERT INTO order_chat_memory/, fn: (sql, p) => { puts.push([p[1], p[2], JSON.parse(p[3])]); return { rows: [] }; } },
    ];
    await h._learnFromDraft(7, {
      client: 'Bilka Steel SRL', client_id: 11, load_type: 'FTL',
      stops: [{ kind: 'pickup', loc: 'Str. Zizinului 110, Brașov', firma: 'Bilka Steel' }, { kind: 'delivery', loc: 'Bicske', firma: 'X Kft' }],
      driver_raw: 'Peti', email_sofer: 'peto@x.ro', nume_sofer: 'Pető-Lőrincz Imre',
    });
    const kinds = puts.map((x) => x[0] + ':' + x[1]);
    expect(kinds).toEqual(expect.arrayContaining(['firma_addr:bilka steel', 'pickup_client:bilka steel', 'client_cargo:id:11', 'driver_alias:peti']));
    expect(kinds).not.toContain('firma_addr:x kft'); // csak városnév → nem tanuljuk
    expect(puts.every((x) => mockDbQuery.mock.calls.some((c) => c[1][0] === 7))).toBe(true);
  });

  test('tanult adatok felhasználása: megrendelő, teljes cím, áru-típus, becenév', async () => {
    const mem = {
      'pickup_client:bilka steel': { client: 'Bilka Steel SRL', client_id: 11 },
      'firma_addr:bilka steel': { loc: 'Str. Zizinului 110, Brașov' },
      'client_cargo:id:11': { load_type: 'FTL' },
      'driver_alias:peti': { email: 'peto@x.ro' },
    };
    mockRules = [
      { match: /FROM order_chat_memory/, fn: (sql, p) => { const v = mem[p[1] + ':' + p[2]]; return { rows: v ? [{ value: v }] : [] }; } },
      { match: /FROM clients WHERE id=\$1 AND company_id=\$2/, rows: [{ id: 11, denumire: 'Bilka Steel SRL' }] },
      { match: /LOWER\(email\)=LOWER\(\$2\)/, rows: [{ email: 'peto@x.ro', nume: 'Pető-Lőrincz Imre' }] },
    ];
    const r = await h._resolveDraft(7, h._sanitizeDraft({
      stops: [{ kind: 'pickup', loc: 'Brasov', firma: 'Bilka Steel', data: '2026-10-12' }, { kind: 'delivery', loc: 'Bicske, HU', data: '2026-10-13' }],
      driver_name: 'Peti',
    }), { estimateRoute: false });
    expect(r.draft.client).toBe('Bilka Steel SRL');
    expect(r.draft.client_id).toBe(11);
    expect(r.draft.learned_client).toBe(true);
    expect(r.draft.stops[0].loc).toBe('Str. Zizinului 110, Brașov');
    expect(r.draft.stops[0].learned).toBe(true);
    expect(r.draft.load_type).toBe('FTL');
    expect(r.draft.email_sofer).toBe('peto@x.ro');
    expect(r.draft.learned_driver).toBe(true);
    expect(r.missing).toEqual([]);
    // minden memória-lekérdezés a cégre szűrt
    mockDbQuery.mock.calls.filter((c) => /order_chat_memory/.test(c[0])).forEach((c) => expect(c[1][0]).toBe(7));
  });

  test('a tanult cím nem írja felül a más városra mutató címet', async () => {
    mockRules = [{ match: /FROM order_chat_memory/, fn: (sql, p) => ({ rows: p[1] === 'firma_addr' ? [{ value: { loc: 'Str. X 1, Brașov' } }] : [] }) }];
    const r = await h._resolveDraft(7, h._sanitizeDraft({ client: 'C', stops: [{ kind: 'pickup', loc: 'Cluj', firma: 'Bilka', data: '2026-10-12' }] }), { estimateRoute: false });
    expect(r.draft.stops[0].loc).toBe('Cluj');
  });

  test('hiányzó memória-tábla → nincs hiba', async () => {
    mockRules = [{ match: /order_chat_memory/, fn: () => { throw new Error('relation does not exist'); } }];
    const r = await h._resolveDraft(7, h._sanitizeDraft({ stops: [{ kind: 'pickup', loc: 'Brasov', firma: 'B', data: '2026-10-12' }] }), { estimateRoute: false });
    expect(r.missing).toContain('client');
  });
});

describe('szerkesztés fuvarszámmal', () => {
  const ORDER_ROW = { j: {
    id: 'CMD-MT181GD5NBL', fuvar_no: 'CMD-2026-0042', status: 'Alocat', client: 'Bilka Steel SRL', client_id: 11,
    load_type: 'FTL', pret: '1500', km: 0, email_sofer: 'peto@x.ro', nume_sofer: 'Pető-Lőrincz Imre',
    rendszam_camion: 'B104VLR', rendszam_remorca: 'CJ36VSN',
  } };
  const STOPS = [
    { kind: 'pickup', loc: 'Brașov, RO', firma: 'Bilka', data: '2026-10-12' },
    { kind: 'delivery', loc: 'Bicske, HU', firma: 'X', data: '2026-10-13' },
  ];
  function editRules(extra) {
    return (extra || []).concat([
      { match: /SELECT to_jsonb\(o\) AS j FROM orders/, rows: [ORDER_ROW] },
      { match: /FROM order_stops/, rows: STOPS },
      { match: /FROM clients WHERE id=\$1 AND company_id=\$2/, rows: [{ id: 11, denumire: 'Bilka Steel SRL' }] },
      { match: /LOWER\(email\)=LOWER\(\$2\)/, rows: [{ email: 'peto@x.ro', nume: 'Pető-Lőrincz Imre' }] },
      { match: /FROM vehicles WHERE company_id=\$1 AND tip=\$2/, fn: (sql, p) => ({ rows: [{ rendszam: p[2] }] }) },
    ]);
  }

  test('csak a fuvarszám → betölti a fuvart AI-hívás nélkül, cégre szűrve', async () => {
    mockRules = editRules();
    const r = await call('orderChatTurn', ADMIN, [{ messages: [{ role: 'user', text: 'cmd-2026-0042' }], draft: {}, lang: 'hu' }]);
    expect(r.ok).toBe(true);
    expect(mockExtract).not.toHaveBeenCalled();
    expect(r.draft.edit_order_id).toBe('CMD-MT181GD5NBL');
    expect(r.draft.edit_fuvar_no).toBe('CMD-2026-0042');
    expect(r.draft.stops).toHaveLength(2);
    expect(r.draft.email_sofer).toBe('peto@x.ro');
    expect(r.draft.pret).toBe(1500);
    expect(r.ready).toBe(true);
    expect(r.reply).toMatch(/CMD-2026-0042/);
    const q = mockDbQuery.mock.calls.find((c) => /SELECT to_jsonb\(o\) AS j FROM orders/.test(c[0]));
    expect(q[1]).toEqual([7, 'CMD-2026-0042']);
    expect(q[0]).toMatch(/company_id=\$1/);
    expect(q[0]).toMatch(/<> 'Anulat'/);
  });

  test('ismeretlen / másik cég fuvara → „nem találom", nincs adat', async () => {
    mockRules = [{ match: /SELECT to_jsonb\(o\) AS j FROM orders/, rows: [] }];
    const r = await call('orderChatTurn', ADMIN, [{ messages: [{ role: 'user', text: 'CMD-2026-9999' }], draft: {}, lang: 'ro' }]);
    expect(r.ok).toBe(true);
    expect(r.draft.edit_order_id).toBeNull();
    expect(r.reply).toMatch(/Nu găsesc/);
    expect(mockExtract).not.toHaveBeenCalled();
  });

  test('fuvarszám + javítás egy üzenetben → az AI a betöltött fuvaron dolgozik', async () => {
    mockRules = editRules();
    mockExtract.mockImplementation(async ({ parts }) => {
      expect(parts[0].text).toMatch(/Bicske/); // a betöltött fuvar az előző vázlat
      return { model: 'm', json: { reply: 'Kész.', draft: { client: 'Bilka Steel SRL', stops: [STOPS[0], Object.assign({}, STOPS[1], { data: '2026-10-15' })], load_type: 'FTL', pret: 1500, driver_name: 'Pető-Lőrincz Imre', rendszam_camion: 'B104VLR', rendszam_remorca: 'CJ36VSN' }, questions: [] } };
    });
    const r = await call('orderChatTurn', ADMIN, [{ messages: [{ role: 'user', text: 'CMD-2026-0042 a lerakás csütörtökön lesz' }], draft: {}, lang: 'hu' }]);
    expect(r.ok).toBe(true);
    expect(r.draft.edit_order_id).toBe('CMD-MT181GD5NBL');
    expect(r.draft.stops[1].data).toBe('2026-10-15');
  });

  test('mentés szerkesztés-módban → comUpdate (nem comCreate), változatlan sofőr/rendszám nem megy', async () => {
    mockRules = editRules([
      { match: /SELECT status, email_sofer, rendszam_camion/, rows: [{ status: 'Alocat', email_sofer: 'peto@x.ro', rendszam_camion: 'B104VLR', rendszam_remorca: 'CJ36VSN', fuvar_no: 'CMD-2026-0042' }] },
    ]);
    const draft = h._sanitizeDraft({
      edit_order_id: 'CMD-MT181GD5NBL', edit_fuvar_no: 'CMD-2026-0042', client: 'Bilka Steel SRL', client_id: 11,
      stops: [STOPS[0], Object.assign({}, STOPS[1], { data: '2026-10-15' })], load_type: 'FTL', pret: 1500,
      email_sofer: 'peto@x.ro', nume_sofer: 'Pető-Lőrincz Imre', driver_name: 'Pető-Lőrincz Imre',
      rendszam_camion: 'B104VLR', rendszam_remorca: 'CJ36VSN',
    });
    const r = await call('orderChatCreate', ADMIN, [{ draft }]);
    expect(r).toEqual({ ok: true, id: 'CMD-MT181GD5NBL', fuvar_no: 'CMD-2026-0042', updated: true });
    expect(mockComCreate).not.toHaveBeenCalled();
    const [, , args] = mockComUpdate.mock.calls[0];
    expect(args[0]).toBe('CMD-MT181GD5NBL');
    expect(args[1].data_descarcare).toBe('2026-10-15');
    expect(args[1].stops).toHaveLength(2);
    expect(args[1]).not.toHaveProperty('email_sofer');
    expect(args[1]).not.toHaveProperty('rendszam_camion');
  });

  test('szerkesztés: idegen / törölt fuvar mentése elutasítva', async () => {
    mockRules = [{ match: /SELECT status, email_sofer, rendszam_camion/, rows: [] }];
    const draft = h._sanitizeDraft({ edit_order_id: 'CMD-MASIKCEG01', client: 'C', stops: STOPS, load_type: 'FTL' });
    const r = await call('orderChatCreate', ADMIN, [{ draft }]);
    expect(r.ok).toBe(false);
    expect(mockComUpdate).not.toHaveBeenCalled();
  });

  test('szerkesztés: új sofőr → Disponibil fuvar Alocat-ra lép (status átadva)', async () => {
    mockRules = editRules([
      { match: /SELECT status, email_sofer, rendszam_camion/, rows: [{ status: 'Disponibil', email_sofer: null, rendszam_camion: null, rendszam_remorca: null }] },
    ]);
    const draft = h._sanitizeDraft({ edit_order_id: 'CMD-MT181GD5NBL', client: 'Bilka Steel SRL', stops: STOPS, load_type: 'FTL',
      email_sofer: 'peto@x.ro', nume_sofer: 'Pető-Lőrincz Imre', driver_name: 'Pető-Lőrincz Imre' });
    await call('orderChatCreate', ADMIN, [{ draft }]);
    const p = mockComUpdate.mock.calls[0][2][1];
    expect(p.email_sofer).toBe('peto@x.ro');
    expect(p.sofer_type).toBe('Intern');
    expect(p.status).toBe('Disponibil');
  });
});
