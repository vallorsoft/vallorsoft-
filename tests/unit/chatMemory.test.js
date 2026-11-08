// ============================================================
//  Unit-teszt — lib/chatMemory.js (a 💬 AI-chat tanuló memóriája)
//  A DB mockolva: a lekérdezés paraméterezett és cégre szűrt;
//  migráció hiányában nem dob.
// ============================================================
const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...a) => mockQuery(...a) }));
const { memGet, memPut, memDel } = require('../../lib/chatMemory');

beforeEach(() => mockQuery.mockReset());

describe('memGet', () => {
  test('üres kulcs → null, nincs DB-hívás', async () => {
    expect(await memGet(7, 'firma_addr', '')).toBeNull();
    expect(await memGet(7, 'firma_addr', null)).toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
  });
  test('cégre + fajtára + kulcsra szűr, paraméterezve', async () => {
    mockQuery.mockResolvedValue({ rows: [{ value: { loc: 'Arad' } }] });
    expect(await memGet(7, 'firma_addr', 'bilka')).toEqual({ loc: 'Arad' });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/company_id=\$1 AND kind=\$2 AND key_norm=\$3/);
    expect(params).toEqual([7, 'firma_addr', 'bilka']);
  });
  test('nincs találat → null', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    expect(await memGet(7, 'x', 'k')).toBeNull();
  });
  test('hiányzó tábla (migráció) → null, nem dob', async () => {
    mockQuery.mockRejectedValue(new Error('relation "order_chat_memory" does not exist'));
    await expect(memGet(7, 'x', 'k')).resolves.toBeNull();
  });
  test('rosszindulatú kulcs is csak paraméterként megy', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const evil = "x'; DROP TABLE users; --";
    await memGet(7, 'x', evil);
    expect(mockQuery.mock.calls[0][0]).not.toContain('DROP');
    expect(mockQuery.mock.calls[0][1][2]).toBe(evil);
  });
});

describe('memPut', () => {
  test('upsert JSON-értékkel, cégre kötve', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await memPut(7, 'firma_addr', 'bilka', { loc: 'Arad', locs: ['Arad', 'Brașov'] });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/ON CONFLICT \(company_id, kind, key_norm\)/);
    expect(params[0]).toBe(7);
    expect(JSON.parse(params[3])).toEqual({ loc: 'Arad', locs: ['Arad', 'Brașov'] });
  });
  test('üres vagy 200 karakternél hosszabb kulcs → nem ír', async () => {
    await memPut(7, 'x', '', { a: 1 });
    await memPut(7, 'x', 'a'.repeat(201), { a: 1 });
    expect(mockQuery).not.toHaveBeenCalled();
  });
  test('300 elemű lista is egyben menthető', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const locs = Array.from({ length: 300 }, (_, i) => 'Str. ' + i + ', Arad');
    await memPut(7, 'firma_addr', 'spedit', { loc: locs[0], locs });
    expect(JSON.parse(mockQuery.mock.calls[0][1][3]).locs).toHaveLength(300);
  });
});

describe('memDel', () => {
  test('cégre szűrt törlés; üres kulcs → nincs hívás', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await memDel(7, 'driver_alias', '');
    expect(mockQuery).not.toHaveBeenCalled();
    await memDel(7, 'driver_alias', 'pisti');
    expect(mockQuery.mock.calls[0][0]).toMatch(/DELETE FROM order_chat_memory WHERE company_id=\$1/);
    expect(mockQuery.mock.calls[0][1]).toEqual([7, 'driver_alias', 'pisti']);
  });
});
