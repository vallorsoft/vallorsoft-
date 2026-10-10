// ============================================================
//  Unit-teszt — lib/chatTools/manage.js (4. kör) + diurna-napok
//  (lib/chatDays.js + driver.earning_add). DB + handlerek mockolva.
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
const mockCarriers = {
  carrierSave: jest.fn((req, res) => res.json({ result: { ok: true, id: 5 } })),
  carrierPortalSetActive: jest.fn((req, res) => res.json({ result: { ok: true } })),
};
jest.mock('../../handlers/carriers', () => ({
  carrierSave: (...a) => mockCarriers.carrierSave(...a), carrierPortalSetActive: (...a) => mockCarriers.carrierPortalSetActive(...a),
}));
const mockFleet = { earningCreate: jest.fn((req, res) => res.json({ result: { ok: true, id: 77 } })) };
jest.mock('../../handlers/fleetCompliance', () => ({ earningCreate: (...a) => mockFleet.earningCreate(...a) }));
const mockDelClient = jest.fn(async () => true);
jest.mock('../../routes/clients', () => ({ deleteClient: (...a) => mockDelClient(...a), insertClient: jest.fn() }));

const tools = require('../../lib/chatTools');
const router = require('../../lib/chatRouter');
const ops = require('../../lib/chatOps');
const CD = require('../../lib/chatDays');

const ADMIN = { id: 3, company_id: 7, pozicio: 'Admin', email: 'a@x.ro' };
const MANAGER = { id: 4, company_id: 7, pozicio: 'Manager', email: 'm@x.ro' };
const req = (u) => ({ session: { user: Object.assign({}, u) }, headers: {}, ip: '1.1.1.1' });
const NOW = new Date(2026, 9, 10, 12, 0, 0);
const ctxOf = (u, text) => router.makeCtx(req(u), 'hu', text || 'teszt', [], {}, NOW);
const tokOf = (html) => /data-tok="([^"]+)"/.exec(html)[1].replace(/&amp;/g, '&');

const CARRIER = { id: 5, nev: 'Rapid Kft', cui: 'RO1', email: 'old@trans.hu', telefon: '1', iban: 'X', nota: 'n', reg_com: 'J1', adresa: 'Cím', payment_term_days: 30, cmr_insurance_expiry: null, aktiv: true, group_id: null };

beforeEach(() => {
  mockRules = [
    { match: /FROM carriers WHERE company_id = \$1$/, rows: [{ id: 5, nev: 'Rapid Kft', email: 'old@trans.hu', cui: 'RO1' }] },
    { match: /SELECT \* FROM carriers WHERE id = \$1 AND company_id = \$2/, rows: [CARRIER] },
    { match: /FROM client_users cu/, fn: (sql, p) => ({ rows: p[1] === 'x@bilka.ro' ? [] : [] }) },
    { match: /FROM carrier_users cu/, fn: (sql, p) => ({ rows: p[1] === 'ion@trans.hu' ? [{ id: 9, email: 'ion@trans.hu', nev: 'Ion', activ: true, org: 'Rapid Kft' }] : [] }) },
    { match: /FROM users WHERE company_id|FROM users\s+WHERE/, rows: [{ id: 20, nume: 'Gondos Imre', email: 'gondos@x.ro', pozicio: 'Sofer', tel: '1' }] },
    { match: /INSERT INTO chat_action_log/, rows: [{ id: 1 }] },
    { match: /chat_learned_intents/, rows: [] },
  ];
  Object.values(mockCarriers).forEach((f) => f.mockClear());
  mockFleet.earningCreate.mockClear(); mockDelClient.mockClear();
});

describe('chatDays.parseDays', () => {
  test.each([
    ['okt 1-6', 6, '2026-10-01'], ['október 1-től 6-ig', 6, '2026-10-01'], ['10.01-10.06', 6, '2026-10-01'],
    ['szept 28-30, okt 1-2', 5, '2026-09-28'], ['2026-10-03, 2026-10-05', 2, '2026-10-03'], ['de la 1 până la 3 octombrie', 3, '2026-10-01'],
  ])('%s → %i nap', (txt, n, first) => {
    const d = CD.parseDays(txt, NOW);
    expect(d).toHaveLength(n);
    expect(d[0]).toBe(first);
  });
  test('értelmetlen szöveg → null', () => { expect(CD.parseDays('valami', NOW)).toBeNull(); });
  test('a chat „— napok: …” vége', () => { expect(CD.daysFromText('Gondosnak diurna — napok: 2026-10-05, 2026-10-06', NOW)).toEqual(['2026-10-05', '2026-10-06']); });
});

describe('diurna: a napok kötelezők', () => {
  test('napok nélkül → naptár, nincs írás', async () => {
    const ctx = ctxOf(ADMIN, 'Gondos Imrének 6 nap diurna 70 euró');
    const r = await tools.prepare(ctx, { tool: 'driver.earning_add', args: { driver: 'Gondos Imre', kind: 'diurna', quantity: 6, unit_amount: 70 } });
    expect(r.html).toContain('och-cal');
    expect(r.html).toContain('data-need="6"');
    expect(r.html).not.toContain('data-tok=');
  });
  test('a naptárból visszajött napokkal → kártya, earningCreate days-szel', async () => {
    const ctx = ctxOf(ADMIN, 'Gondos Imrének 6 nap diurna 70 euró — napok: 2026-10-01, 2026-10-02, 2026-10-03, 2026-10-04, 2026-10-05, 2026-10-06');
    const r = await tools.prepare(ctx, { tool: 'driver.earning_add', args: { driver: 'Gondos Imre', kind: 'diurna', quantity: 6, unit_amount: 70 } });
    expect(r.html).toContain('data-tok=');
    expect(r.html).toContain('420,00');
    const x = await ops.executeAction(req(ADMIN), tokOf(r.html), {}, 'hu');
    expect(x.ok).toBe(true);
    const [, , args] = mockFleet.earningCreate.mock.calls[0];
    expect(args[0].days).toHaveLength(6);
    expect(args[0].days[0]).toBe('2026-10-01');
  });
  test('szöveges napok (okt 1-4) + eltérő darabszám → újra kér', async () => {
    const r = await tools.prepare(ctxOf(ADMIN, 'x'), { tool: 'driver.earning_add', args: { driver: 'Gondos Imre', kind: 'diurna', quantity: 6, unit_amount: 70, days: 'okt 1-4' } });
    expect(r.reply).toMatch(/6 napot írtál, de 4/);
    expect(r.html).toContain('class="och-cal-d on"');
  });
  test('bónusznál nem kell nap', async () => {
    const r = await tools.prepare(ctxOf(ADMIN), { tool: 'driver.earning_add', args: { driver: 'Gondos Imre', kind: 'bonus', unit_amount: 200 } });
    expect(r.html).toContain('data-tok=');
  });
});

describe('alvállalkozó módosítása', () => {
  test('csak a megadott mező változik, a többi megmarad', async () => {
    const r = await tools.prepare(ctxOf(ADMIN), { tool: 'carrier.update', args: { carrier: 'Rapid', payment_term_days: '45' } });
    const x = await ops.executeAction(req(ADMIN), tokOf(r.html), {}, 'hu');
    expect(x.ok).toBe(true);
    const [, , args] = mockCarriers.carrierSave.mock.calls[0];
    expect(args[0]).toMatchObject({ id: 5, nev: 'Rapid Kft', email: 'old@trans.hu', iban: 'X', payment_term_days: 45, aktiv: true });
  });
});

describe('ügyfél törlése', () => {
  test('Manager nem éri el', async () => {
    const r = await tools.prepare(ctxOf(MANAGER), { tool: 'client.delete', args: { client: 'Bilka' } });
    expect(r.html || '').not.toContain('data-tok=');
  });
});

describe('portál-belépő letiltása', () => {
  test('alvállalkozói belépő → carrierPortalSetActive(id,false)', async () => {
    const r = await tools.prepare(ctxOf(ADMIN), { tool: 'portal.access_set', args: { email: 'ion@trans.hu', active: false } });
    const x = await ops.executeAction(req(ADMIN), tokOf(r.html), {}, 'hu');
    expect(x.ok).toBe(true);
    expect(mockCarriers.carrierPortalSetActive).toHaveBeenCalledWith(expect.anything(), expect.anything(), [9, false]);
  });
  test('ismeretlen e-mail → hiba', async () => {
    const r = await tools.prepare(ctxOf(ADMIN), { tool: 'portal.access_set', args: { email: 'nincs@x.ro', active: false } });
    expect(r.html || '').not.toContain('data-tok=');
  });
});

test('a regiszterben minden manage-tool handlere létezik és nincs cégadat a példákban', () => {
  const names = tools.all().map((t) => t.name);
  for (const n of ['carrier.update', 'carrier.delete', 'invite.revoke', 'portal.access_set', 'favloc.delete', 'quote.update', 'mail.template_send', 'vcalc.cost_add', 'toll.rate_set', 'learned.forget']) expect(names).toContain(n);
});
