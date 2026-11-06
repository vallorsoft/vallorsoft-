// Elfelejtett állomás-gomb keresése: nappal óránként, este szünet, éjfél után egyszer
jest.mock('../../db', () => require('../helpers/db-mock').pool);
const { pool, rows, reset } = require('../helpers/db-mock');
const runner = require('../../lib/stopMatchRunner');

describe('PRESS_DUE_SQL — óránkénti keresés a nyitott állomásokra', () => {
  const q = runner.PRESS_DUE_SQL;
  test('csak a sofőr által le nem zárt állomás, a dátumától kezdve, ablakon belül', () => {
    expect(q).toMatch(/ps\.done_at IS NULL/);
    expect(q).toMatch(/<= \(\$6::timestamptz AT TIME ZONE 'Europe\/Bucharest'\)::date/);
    expect(q).toMatch(/>= \(\$6::timestamptz AT TIME ZONE 'Europe\/Bucharest'\)::date - \$5::int/);
    expect(q).toMatch(/ps\.company_id = o\.company_id/);
    expect(q).toMatch(/COALESCE\(o\.email_sofer,''\) <> ''/);
    expect(q).toMatch(/ms\.auto_events/);
  });
  test('nappal 8–19 között óránként, éjjel csak az éjfél utáni egy futás', () => {
    expect(runner.PRESS_DAY_FROM).toBe(8);
    expect(runner.PRESS_DAY_TO).toBe(19);
    expect(q).toMatch(/>= 8\s+AND EXTRACT\(HOUR FROM \$6::timestamptz AT TIME ZONE 'Europe\/Bucharest'\) < 19\s+AND st\.attempted_at < \$6::timestamptz - INTERVAL '55 minutes'/);
    expect(q).toMatch(/< 8\s+AND st\.attempted_at < \(date_trunc\('day'/);
  });
});

describe('pickQueue — a „most" és az ablak paraméterként megy', () => {
  beforeEach(() => reset());
  test('a lekérdezés tartalmazza a gomb-keresést, és átadja az időt', async () => {
    pool.query.mockResolvedValueOnce(rows([]));
    const now = new Date('2026-11-06T09:10:00Z');
    await runner.pickQueue(30, now);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain(runner.PRESS_DUE_SQL);
    expect(params[0]).toBe(30);
    expect(params[4]).toBe(runner.PRESS_WINDOW_DAYS);
    expect(params[5]).toBe(now);
  });
});
