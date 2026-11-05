// Tényleges címek heti újraellenőrzése: 150 pont alatt hetente, 10 után kézi megerősítés
jest.mock('../../db', () => require('../helpers/db-mock').pool);
const { pool, rows, reset } = require('../helpers/db-mock');
const runner = require('../../lib/stopMatchRunner');

describe('heti újraellenőrzés — beállítások', () => {
  test('alapértékek: 150 pont, 10 próbálkozás, hetente', () => {
    expect(runner.RECHECK_TARGET).toBe(150);
    expect(runner.RECHECK_MAX).toBe(10);
    expect(runner.RECHECK_DAYS).toBe(7);
  });
  test('a számláló-léptetés csak a nem eldöntött, cél alatti, nem kézi állomásokra hat', () => {
    const q = runner.RECHECK_BUMP_SQL;
    expect(q).toMatch(/match_status IN \('auto','suggested','unmatched'\)/);
    expect(q).toMatch(/COALESCE\(match_score, 0\) < \$4/);
    expect(q).toMatch(/needs_manual = false AND recheck_count < \$3/);
    expect(q).toMatch(/needs_manual = \(recheck_count \+ 1 >= \$3\)/);
    expect(q).toMatch(/WHEN recheck_count \+ 1 >= \$3 AND match_status = 'auto' THEN 'suggested'/);
    expect(q).toMatch(/company_id = \$2/);
  });
});

describe('_moved — a hely érdemben változott-e', () => {
  test('új hely / eltűnt hely / távolság', () => {
    expect(runner._moved({ actual_lat: null, actual_lng: null }, null)).toBe(false);
    expect(runner._moved({ actual_lat: null, actual_lng: null }, { lat: 46, lng: 23 })).toBe(true);
    expect(runner._moved({ actual_lat: 46, actual_lng: 23 }, null)).toBe(true);
    expect(runner._moved({ actual_lat: 46, actual_lng: 23 }, { lat: 46.0002, lng: 23 })).toBe(false);   // ~22 m
    expect(runner._moved({ actual_lat: 46, actual_lng: 23 }, { lat: 46.001, lng: 23 })).toBe(true);     // ~111 m
  });
});

describe('matchOrder — újraellenőrzéskor a számláló lép, adat nélkül is', () => {
  beforeEach(() => reset());
  test('recheck=true → léptetés a cégre szűrve, a beállított küszöbökkel', async () => {
    pool.query
      .mockResolvedValueOnce(rows([{ id: 'A', status: 'Finalizat', rendszam_camion: 'B1X', data_incarcare: '2026-10-01', data_descarcare: '2026-10-01' }]))
      .mockResolvedValueOnce(rows([{ id: 1, kind: 'pickup', loc: 'Arad', data: '2026-10-01', match_status: 'suggested' }]))
      .mockResolvedValueOnce(rows([]))          // léptetés
      .mockResolvedValue(rows([]));             // GPS-napok: nincs → no_gps
    const r = await runner.matchOrder(7, 'A', { recheck: true });
    expect(r.status).toBe('no_gps');
    const bump = pool.query.mock.calls[2];
    expect(bump[0]).toBe(runner.RECHECK_BUMP_SQL);
    expect(bump[1]).toEqual(['A', 7, 10, 150, 7]);
  });
  test('normál futásnál nincs léptetés', async () => {
    pool.query
      .mockResolvedValueOnce(rows([{ id: 'A', status: 'Finalizat', rendszam_camion: 'B1X', data_incarcare: '2026-10-01' }]))
      .mockResolvedValueOnce(rows([{ id: 1, kind: 'pickup', loc: 'Arad', data: '2026-10-01' }]))
      .mockResolvedValue(rows([]));
    await runner.matchOrder(7, 'A');
    expect(pool.query.mock.calls.some((c) => c[0] === runner.RECHECK_BUMP_SQL)).toBe(false);
  });
  test('próbafuttatás (dryRun) semmit nem léptet', async () => {
    pool.query
      .mockResolvedValueOnce(rows([{ id: 'A', status: 'Finalizat', rendszam_camion: 'B1X', data_incarcare: '2026-10-01' }]))
      .mockResolvedValueOnce(rows([{ id: 1, kind: 'pickup', loc: 'Arad', data: '2026-10-01' }]))
      .mockResolvedValue(rows([]));
    await runner.matchOrder(7, 'A', { recheck: true, dryRun: true });
    expect(pool.query.mock.calls.some((c) => c[0] === runner.RECHECK_BUMP_SQL)).toBe(false);
  });
});

describe('pickQueue — esedékes újraellenőrzés', () => {
  beforeEach(() => reset());
  test('a heti újraellenőrzés a sorban, recheck jelzéssel', async () => {
    pool.query.mockResolvedValueOnce(rows([{ id: 'A', company_id: 7, recheck: true }]));
    const q = await runner.pickQueue(30);
    expect(q[0].recheck).toBe(true);
    const [sql, params] = pool.query.mock.calls[0];
    expect(params).toEqual([30, 10, 150, 7]);
    expect(sql).toMatch(/COALESCE\(rs\.recheck_at, rs\.matched_at\) < NOW\(\) - \(\$4::int/);
    expect(sql).toMatch(/rs\.needs_manual = false AND rs\.recheck_count < \$2/);
  });
});

describe('invalidateRoutes — a hely változásakor az útvonal újraszámolandó', () => {
  beforeEach(() => reset());
  test('a fuvar útvonal-eltérése törlődik, a menetlevél-út aláírása nullázódik — cégre szűrve', async () => {
    pool.query.mockResolvedValue(rows([]));
    await runner.invalidateRoutes(7, 'A');
    expect(pool.query.mock.calls[0][0]).toMatch(/DELETE FROM order_route_deviation WHERE order_id=\$1 AND company_id=\$2/);
    expect(pool.query.mock.calls[0][1]).toEqual(['A', 7]);
    expect(pool.query.mock.calls[1][0]).toMatch(/UPDATE waybill_route_check SET sig = NULL/);
    expect(pool.query.mock.calls[1][1]).toEqual([7, 'A']);
  });
});
