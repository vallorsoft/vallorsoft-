// ============================================================
//  Unit-teszt — chat-tool `border.add`: határátlépés utólagos felvétele
//  az AI-chatből (időzóna, jövőbeli időpont tiltása, handler-hívás, visszavonás).
// ============================================================
jest.mock('../../db', () => ({ query: async () => ({ rows: [] }) }));
jest.mock('../../lib/featureEnabled', () => ({ featureEnabled: async () => true }));
jest.mock('../../lib/audit', () => ({ fromReq: jest.fn(async () => {}) }));
const mockCreate = jest.fn((req, res) => res.json({ result: { ok: true, id: 77, waybills_recalc: 1 } }));
const mockDelete = jest.fn((req, res) => res.json({ result: { ok: true } }));
jest.mock('../../handlers/documents', () => ({
  borderCrossingCreate: (...a) => mockCreate(...a),
  borderCrossingDelete: (...a) => mockDelete(...a),
}));

const tools = require('../../lib/chatTools');
const core = require('../../lib/chatTools/core');

const ADMIN = { id: 3, company_id: 7, pozicio: 'Admin', email: 'a@x.ro' };
const ctx = (u, lang) => ({ req: { session: { user: u || ADMIN }, headers: {}, ip: '1.1.1.1' }, cid: 7, uid: 3, lang: lang || 'hu', now: new Date() });
const tool = () => core.get('border.add');

test('regisztrálva, írás, a meglévő handlert hívja', () => {
  expect(tools).toBeTruthy();
  const t = tool();
  expect(t.kind).toBe('write');
  expect(typeof t.undo).toBe('function');
  expect(t.params.direction.values).toEqual(['Iesire', 'Intrare']);
});

test('check: helyi (bukaresti) idő → UTC, nyári és téli időszámítás', async () => {
  const a = { driver: { email: 's@x.ro', name: 'Gondos' }, direction: 'Iesire', date: '2026-07-10', time: '18.30' };
  expect(await tool().check(ctx(), a)).toBeNull();
  expect(a.at).toBe('2026-07-10T15:30:00.000Z');   // EEST = UTC+3
  expect(a.time).toBe('18:30');
  const b = { driver: a.driver, direction: 'Intrare', date: '2026-01-10', time: '7' };
  expect(await tool().check(ctx(), b)).toBeNull();
  expect(b.at).toBe('2026-01-10T05:00:00.000Z');   // EET = UTC+2
});

test('check: hiányzó/hibás óra → visszakérdez; jövőbeli → hiba', async () => {
  const bad = await tool().check(ctx(), { date: '2026-01-10', time: '25:00' });
  expect(bad.ask).toBeTruthy();
  const fut = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const r = await tool().check(ctx(), { date: fut, time: '10:00' });
  expect(r.err).toBeTruthy();
});

test('run → borderCrossingCreate a feloldott adatokkal; undo → borderCrossingDelete', async () => {
  const a = { driver: { email: 's@x.ro', name: 'Gondos' }, direction: 'Iesire', date: '2026-07-10', time: '18:30', place: 'Nădlac' };
  await tool().check(ctx(), a);
  const r = await tool().run(ctx(), a);
  expect(r.ok).toBe(true);
  expect(r.entity_id).toBe(77);
  expect(mockCreate.mock.calls[0][2][0]).toEqual({ email: 's@x.ro', tip: 'Iesire', at: '2026-07-10T15:30:00.000Z', locatie: 'Nădlac' });
  const u = await tool().undo(ctx(), {}, { id: 77 });
  expect(u.ok).toBe(true);
  expect(mockDelete.mock.calls[0][2][0]).toEqual({ id: 77 });
});

test('sofőr nem használhatja', async () => {
  expect(await core.canUse({ session: { user: { id: 9, company_id: 7, pozicio: 'Sofer' } } }, tool(), {})).toBe(false);
});
