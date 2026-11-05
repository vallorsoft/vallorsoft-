// mapsProvider.geocode — a „nem található" cache 3 nap után lejár (átmeneti hiba ne rögzüljön örökre)
jest.mock('../../db', () => require('../helpers/db-mock').pool);
const { pool, rows, reset } = require('../helpers/db-mock');
const maps = require('../../lib/mapsProvider');

describe('geocode — negatív cache lejárata', () => {
  const realFetch = global.fetch;
  beforeEach(() => reset());
  afterEach(() => { global.fetch = realFetch; });

  test('friss „nem található" → nem hív ki, hibát ad', async () => {
    pool.query.mockResolvedValueOnce(rows([{ lat: null, lng: null, created_at: new Date() }]));
    global.fetch = jest.fn();
    await expect(maps.geocode(null, 'Miskolc')).rejects.toThrow();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('3 napnál régebbi „nem található" → törli és újra lekéri', async () => {
    pool.query.mockResolvedValueOnce(rows([{ lat: null, lng: null, created_at: new Date(Date.now() - 4 * 86400e3) }]));
    pool.query.mockResolvedValue(rows([]));
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ features: [{ geometry: { coordinates: [20.7784, 48.1035] }, properties: { name: 'Miskolc' } }] }) });
    const g = await maps.geocode(null, 'Miskolc');
    expect(Math.round(g.lat * 100) / 100).toBe(48.1);
    expect(pool.query.mock.calls.some((c) => /DELETE FROM geo_cache/.test(c[0]))).toBe(true);
  });
});
