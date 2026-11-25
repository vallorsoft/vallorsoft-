// Unit-teszt — lib/clientByCui.js (ügyfél a CUI alapján, ANAF-felvétellel)
const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...a) => mockQuery(...a) }));
jest.mock('../../lib/audit', () => ({ fromReq: async () => {} }));
const mockAnaf = jest.fn();
jest.mock('../../services/clients', () => {
  const real = jest.requireActual('../../services/clients');
  return { normalizeCui: real.normalizeCui, validateCui: real.validateCui, anafLookup: (...a) => mockAnaf(...a) };
});
const lib = require('../../lib/clientByCui');

const VALID = 'RO47859317';   // érvényes ellenőrző számjeggyel
const AN = { found: true, cui: '47859317', name: 'VALLOR TEAM SRL', regCom: 'J2023000114142', address: 'Arcus', active: true };

beforeEach(() => { mockQuery.mockReset(); mockAnaf.mockReset(); });

test('érvénytelen CUI → nincs DB / ANAF hívás', async () => {
  const r = await lib.ensureClientByCui(1, '12345678');
  expect(r.invalid).toBe(true);
  expect(mockQuery).not.toHaveBeenCalled();
  expect(mockAnaf).not.toHaveBeenCalled();
});

test('meglévő ügyfél (a cégnél) → azt adja, nincs ANAF', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 7, denumire: 'Vallor Team', cui_cif: 'RO47859317' }] });
  const r = await lib.ensureClientByCui(3, VALID);
  expect(r).toEqual({ client: { id: 7, denumire: 'Vallor Team', cui_cif: 'RO47859317' }, created: false });
  expect(mockQuery.mock.calls[0][1]).toEqual([3, '47859317']);   // cégre szűrve, számjegyekkel
  expect(mockAnaf).not.toHaveBeenCalled();
});

test('nincs meg → ANAF + felvétel a céghez', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ id: 9, denumire: 'VALLOR TEAM SRL', cui_cif: '47859317' }] });
  mockAnaf.mockResolvedValue(AN);
  const r = await lib.ensureClientByCui(3, VALID, { req: {}, source: 'x' });
  expect(r.created).toBe(true);
  expect(r.client.id).toBe(9);
  const ins = mockQuery.mock.calls[1];
  expect(ins[0]).toMatch(/INSERT INTO clients/);
  expect(ins[1][0]).toBe(3);
  expect(ins[1][1]).toBe('VALLOR TEAM SRL');
});

test('ANAF nem találja → notFound, nincs beszúrás', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });
  mockAnaf.mockResolvedValue({ found: false });
  const r = await lib.ensureClientByCui(3, VALID);
  expect(r.notFound).toBe(true);
  expect(mockQuery).toHaveBeenCalledTimes(1);
});

test('ANAF hiba → err', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });
  mockAnaf.mockRejectedValue(new Error('ANAF timeout'));
  const r = await lib.ensureClientByCui(3, VALID);
  expect(r.err).toMatch(/timeout/);
  expect(r.client).toBeNull();
});
