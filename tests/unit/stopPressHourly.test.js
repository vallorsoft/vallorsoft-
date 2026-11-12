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
  test('nappal 5–23 között 25 percenként, éjjel csak az éjfél utáni egy futás', () => {
    expect(runner.PRESS_DAY_FROM).toBe(5);
    expect(runner.PRESS_DAY_TO).toBe(23);
    expect(q).toMatch(/>= 5\s+AND EXTRACT\(HOUR FROM \$6::timestamptz AT TIME ZONE 'Europe\/Bucharest'\) < 23\s+AND st\.attempted_at < \$6::timestamptz - INTERVAL '24 minutes'/);
    expect(runner.PRESS_EVERY_MIN).toBe(24);
    expect(q).toMatch(/< 5\s+AND st\.attempted_at < \(date_trunc\('day'/);
  });
});

describe('PRESS_DUE_SQL — nappal csak új GPS-adattal fut újra', () => {
  const q = runner.PRESS_DUE_SQL;
  const g = runner.PRESS_NEW_GPS_SQL;
  test('a nappali ágban az új-GPS feltétel benne van, az éjjeliben nincs', () => {
    const day = q.slice(q.indexOf("INTERVAL '24 minutes'"), q.indexOf('OR (EXTRACT(HOUR'));
    expect(day).toContain(g);
    const night = q.slice(q.indexOf('OR (EXTRACT(HOUR'));
    expect(night).not.toContain('gps_track_days');
  });
  test('ugyanaz a cég és kamion, a fuvar ablakán belül, a legutóbbi ellenőrzés óta jött pont', () => {
    expect(g).toMatch(/gd\.company_id = o\.company_id/);
    expect(g).toMatch(/REGEXP_REPLACE\(COALESCE\(gd\.rendszam/);
    expect(g).toMatch(/REGEXP_REPLACE\(COALESCE\(o\.rendszam_camion/);
    expect(g).toMatch(/gd\.day >= .* - \(\$5::int \+ 3\)/);
    expect(g).toMatch(/COALESCE\(gd\.points_at, gd\.updated_at\) > st\.attempted_at/);
  });
});

describe('pickQueue — igazságos sorrend', () => {
  beforeEach(() => reset());
  test('a legrégebben ellenőrzött fuvar kerül előre (a requeued után)', async () => {
    pool.query.mockResolvedValueOnce(rows([]));
    await runner.pickQueue(10, new Date());
    const [sql] = pool.query.mock.calls[0];
    expect(sql).toMatch(/ORDER BY st\.requeued DESC NULLS LAST, st\.attempted_at ASC NULLS FIRST/);
  });
});

describe('roundSize — a kör mérete a sorhoz igazodik', () => {
  const { _roundSize } = require('../../services/scheduler');
  test('rövid sornál az alap, hosszúnál a sor hossza, felül a maximum', () => {
    expect(_roundSize(3, 15, 80)).toBe(15);
    expect(_roundSize(40, 15, 80)).toBe(40);
    expect(_roundSize(500, 15, 80)).toBe(80);
    expect(_roundSize(undefined, 15, 80)).toBe(15);
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
