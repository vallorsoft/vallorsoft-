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
jest.mock('../../handlers/orders', () => ({ comCreate: (...a) => mockComCreate(...a) }));

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
  mockDbQuery.mockClear(); mockExtract.mockReset(); mockAnaf.mockReset(); mockComCreate.mockClear();
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
