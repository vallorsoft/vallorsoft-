// ============================================================
//  Unit-teszt — lib/chatTools/people.js (3. kör: beérkező kérések,
//  menetlevél, munkatársak). DB + handlerek mockolva.
// ============================================================
let mockRules = [];
const mockDbQuery = jest.fn(async (sql, params) => {
  for (const r of mockRules) if (r.match.test(sql)) return r.fn ? r.fn(sql, params) : { rows: r.rows || [] };
  return { rows: [] };
});
jest.mock('../../db', () => ({ query: (...a) => mockDbQuery(...a) }));
jest.mock('../../lib/featureEnabled', () => ({ featureEnabled: async () => true }));
jest.mock('../../lib/audit', () => ({ fromReq: jest.fn(async () => {}) }));
jest.mock('../../handlers/permissions', () => ({ hasPerm: async () => true }));
const mockApprove = jest.fn(async () => ({ status: 200, body: { ok: true, order_id: 'CMDNEW', fuvar_no: 'CMD-2026-0100', status: 'Disponibil' } }));
const mockReject = jest.fn(async () => ({ status: 200, body: { ok: true } }));
jest.mock('../../routes/inbound-orders', () => ({ approveInbound: (...a) => mockApprove(...a), rejectInbound: (...a) => mockReject(...a) }));
const mockUsers = {
  userSetBlocked: jest.fn((req, res) => res.json({ result: { ok: true } })),
  userUpdate: jest.fn((req, res) => res.json({ result: { ok: true } })),
  userDelete: jest.fn((req, res) => res.json({ result: { ok: true } })),
};
jest.mock('../../handlers/users', () => ({
  userSetBlocked: (...a) => mockUsers.userSetBlocked(...a), userUpdate: (...a) => mockUsers.userUpdate(...a), userDelete: (...a) => mockUsers.userDelete(...a),
}));
const WB = { id: 'FUV-1', numar_fisa: 'MT-2026-0012', nume_sofer: 'Ion', numar_camion: 'B1AAA', numar_remorca: 'B2BBB', km_inceput: 1000, km_sfarsit: 1500,
  cant_inceput: 100, cant_sfarsit: 80, diurna_externa: 2, diurna_interna: 1, alte_mentiuni: 'x', alimentari: [{ litru: 50 }], achizitii: [], puncte: [{ tip: 'Plecare' }] };
const mockDocs = {
  getFuvarlevelDetail: jest.fn((req, res) => res.json({ result: { ok: true, fuv: WB } })),
  fuvarlevelUpdate: jest.fn((req, res) => res.json({ result: { ok: true } })),
};
jest.mock('../../handlers/documents', () => ({
  getFuvarlevelDetail: (...a) => mockDocs.getFuvarlevelDetail(...a), fuvarlevelUpdate: (...a) => mockDocs.fuvarlevelUpdate(...a),
}));

const tools = require('../../lib/chatTools');
const router = require('../../lib/chatRouter');
const ops = require('../../lib/chatOps');

const ADMIN = { id: 3, company_id: 7, pozicio: 'Admin', email: 'a@x.ro' };
const MANAGER = { id: 4, company_id: 7, pozicio: 'Manager', email: 'm@x.ro' };
const req = (u) => ({ session: { user: Object.assign({}, u) }, headers: {}, ip: '1.1.1.1' });
const NOW = new Date(2026, 9, 8, 12, 0, 0);
const ctxOf = (u) => router.makeCtx(req(u), 'hu', 'teszt', [], {}, NOW);
const tokOf = (html) => /data-tok="([^"]+)"/.exec(html)[1].replace(/&amp;/g, '&');

const USERS = [
  { id: 10, nume: 'Kiss Péter', email: 'kiss@x.ro', tel: '1', pozicio: 'Sofer', blocked: false },
  { id: 11, nume: 'Nagy Anna', email: 'anna@x.ro', tel: '2', pozicio: 'Manager', blocked: false },
];

beforeEach(() => {
  mockRules = [
    { match: /FROM inbound_orders\s+WHERE company_id = \$1 AND status NOT IN/, rows: [{ id: 12, source: 'portal', status: 'new', extracted: { client: 'Bilka', loc_incarcare: 'Brașov', loc_descarcare: 'Budapest', pret: 900 } }] },
    { match: /FROM inbound_orders WHERE company_id = \$1 AND id = \$2/, fn: (sql, p) => ({ rows: p[1] === 12 ? [{ id: 12, source: 'portal', status: 'new', extracted: { client: 'Bilka' } }] : [] }) },
    { match: /FROM users\s+WHERE company_id = \$1 AND COALESCE\(pozicio_dev,false\) = false ORDER BY nume/, rows: USERS },
    { match: /FROM users\s+WHERE company_id = \$1 AND LOWER\(email\) = \$2/, fn: (sql, p) => ({ rows: USERS.filter((u) => u.email === p[1]) }) },
    { match: /FROM fuvarlevelek f WHERE/, rows: [WB] },
    { match: /SELECT \* FROM fuvarlevelek WHERE id = \$1/, rows: [WB] },
    { match: /INSERT INTO chat_action_log/, rows: [{ id: 1 }] },
    { match: /chat_learned_intents/, rows: [] },
  ];
  Object.values(mockUsers).forEach((f) => f.mockClear());
  Object.values(mockDocs).forEach((f) => f.mockClear());
  mockApprove.mockClear(); mockReject.mockClear();
});

describe('beérkező megrendelések', () => {
  test('egyetlen függő kérés → szám nélkül is jóváhagyható; a közös approveInbound fut', async () => {
    const r = await tools.prepare(ctxOf(ADMIN), { tool: 'inbound.approve', args: {} });
    expect(r.html).toContain('#12');
    expect(mockApprove).not.toHaveBeenCalled();
    const x = await ops.executeAction(req(ADMIN), tokOf(r.html), {}, 'hu');
    expect(x.ok).toBe(true);
    expect(mockApprove).toHaveBeenCalledWith(expect.anything(), 12, null);
    expect(x.reply).toContain('CMD-2026-0100');
  });
  test('ismeretlen szám → hiba, nincs írás', async () => {
    const r = await tools.prepare(ctxOf(ADMIN), { tool: 'inbound.approve', args: { request: '#999' } });
    expect(r.html || '').not.toContain('data-tok=');
  });
  test('elvetés a közös rejectInbound-dal', async () => {
    const r = await tools.prepare(ctxOf(ADMIN), { tool: 'inbound.reject', args: { request: 'Bilka' } });
    const x = await ops.executeAction(req(ADMIN), tokOf(r.html), {}, 'hu');
    expect(x.ok).toBe(true);
    expect(mockReject).toHaveBeenCalledWith(expect.anything(), 12);
  });
});

describe('munkatársak', () => {
  test('letiltás veszélyes művelet: IGEN nélkül nem fut, utána userSetBlocked(email,true)', async () => {
    const r = await tools.prepare(ctxOf(ADMIN), { tool: 'user.block', args: { user: 'Kiss' } });
    const tok = tokOf(r.html);
    expect((await ops.executeAction(req(ADMIN), tok, { input: 'nem' }, 'hu')).ok).toBe(false);
    expect(mockUsers.userSetBlocked).not.toHaveBeenCalled();
    const x = await ops.executeAction(req(ADMIN), tok, { input: 'igen' }, 'hu');
    expect(x.ok).toBe(true);
    expect(mockUsers.userSetBlocked).toHaveBeenCalledWith(expect.anything(), expect.anything(), ['kiss@x.ro', true]);
  });
  test('Manager nem tilthat le managert', async () => {
    const r = await tools.prepare(ctxOf(MANAGER), { tool: 'user.block', args: { user: 'anna@x.ro' } });
    expect(r.html || '').not.toContain('data-tok=');
    expect(r.reply).toMatch(/sofőrt/);
  });
  test('módosítás csak a megadott mezőt küldi', async () => {
    const r = await tools.prepare(ctxOf(ADMIN), { tool: 'user.update', args: { user: 'Kiss Péter', phone: '0740123456' } });
    const x = await ops.executeAction(req(ADMIN), tokOf(r.html), {}, 'hu');
    expect(x.ok).toBe(true);
    expect(mockUsers.userUpdate).toHaveBeenCalledWith(expect.anything(), expect.anything(), ['kiss@x.ro', { tel: '0740123456' }]);
  });
});

describe('menetlevél módosítása', () => {
  test('a többi adat (tankolások, pontok, diurna) megmarad, csak a záró km változik', async () => {
    const r = await tools.prepare(ctxOf(ADMIN), { tool: 'waybill.update', args: { waybill: 'MT-2026-0012', km_end: '1600' } });
    expect(r.html).toContain('1600');
    const x = await ops.executeAction(req(ADMIN), tokOf(r.html), {}, 'hu');
    expect(x.ok).toBe(true);
    const [, , args] = mockDocs.fuvarlevelUpdate.mock.calls[0];
    expect(args[0]).toBe('FUV-1');
    expect(args[1]).toMatchObject({ km_inceput: 1000, km_sfarsit: 1600, alimentari: WB.alimentari, puncte: WB.puncte, diurna_externa: 2, numar_camion: 'B1AAA' });
  });
  test('záró km < kezdő km → hiba', async () => {
    const r = await tools.prepare(ctxOf(ADMIN), { tool: 'waybill.update', args: { waybill: 'MT-2026-0012', km_end: '500' } });
    expect(r.html || '').not.toContain('data-tok=');
  });
});
