// Útvonal-eltérés szakaszonként: a valós állomások között volt-e rövidebb kamionos út,
// a tankolás / pihenő / parkoló miatti kitérőket leszámítva.
jest.mock('../../db', () => require('../helpers/db-mock').pool);
const { pool } = require('../helpers/db-mock');
const rd = require('../../lib/routeDeviation');
const est = require('../../lib/routeEstimate');

const rows = (r) => ({ rows: r, rowCount: r.length });

// Egyenes vonalú haladás (lat-irányban) percenkénti pontokkal
function drive(p, t, a, b, mins, kmh) {
  for (let i = 1; i <= mins; i++) { const f = i / mins; p.push([t + i * 60, a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, kmh || 70]); }
  return t + mins * 60;
}
function stand(p, t, at, mins) { for (let i = 1; i <= mins; i++) p.push([t + i * 60, at[0], at[1], 0]); return t + mins * 60; }

describe('judgeSegment', () => {
  test('a tűrés max(1 km, 3%)', () => {
    expect(rd.judgeSegment(100, 102.9, 0)).toMatchObject({ status: 'ok', extra_km: 0, tol_km: 3 });
    expect(rd.judgeSegment(100, 104, 0)).toMatchObject({ status: 'deviation', extra_km: 4 });
    expect(rd.judgeSegment(20, 21.5, 0)).toMatchObject({ status: 'deviation', tol_km: 1 });
  });
  test('a kényszerű kitérő leszámítva → rendben', () => {
    expect(rd.judgeSegment(100, 110, 9)).toMatchObject({ status: 'ok', excused_km: 9, adj_km: 101 });
  });
  test('rövidebb a tervnél → rendben, nincs többlet', () => {
    expect(rd.judgeSegment(100, 92, 0)).toMatchObject({ status: 'ok', extra_km: 0, diff_km: -8 });
  });
  test('hiányzó adat → no_data', () => {
    expect(rd.judgeSegment(null, 10, 0).status).toBe('no_data');
    expect(rd.judgeSegment(0, 10, 0).status).toBe('no_data');
  });
});

describe('excursions', () => {
  const plan = [[46.0, 24.0], [46.5, 24.0]];          // észak felé egyenes
  const T = 1_800_000_000;
  test('letérés tankolásra (állással) → kényszerű, a kitérő km leszámítható', () => {
    const p = [[T, 46.0, 24.0, 70]];
    let t = drive(p, T, [46.0, 24.0], [46.2, 24.0], 20);
    t = drive(p, t, [46.2, 24.0], [46.2, 24.05], 5, 40);      // ~3.9 km kelet
    t = stand(p, t, [46.2, 24.05], 15);                       // 15 perc állás
    t = drive(p, t, [46.2, 24.05], [46.21, 24.0], 5, 40);     // vissza
    drive(p, t, [46.21, 24.0], [46.5, 24.0], 30);
    const ex = rd.excursions(p, T, T + 99999, plan, []);
    expect(ex).toHaveLength(1);
    expect(ex[0]).toMatchObject({ forced: true, reason: 'parking' });
    expect(ex[0].excused_km).toBeGreaterThan(4);
    expect(ex[0].excused_km).toBeLessThan(10);
  });
  test('ha a futam alatt tankolás volt → oka „fuel"', () => {
    const p = [[T, 46.0, 24.0, 70]];
    let t = drive(p, T, [46.0, 24.0], [46.2, 24.0], 20);
    const t0 = t;
    t = drive(p, t, [46.2, 24.0], [46.2, 24.05], 5, 40);
    t = drive(p, t, [46.2, 24.05], [46.21, 24.0], 5, 40);
    drive(p, t, [46.21, 24.0], [46.5, 24.0], 30);
    const ex = rd.excursions(p, T, T + 99999, plan, [{ t: t0 + 300 }]);
    expect(ex[0]).toMatchObject({ forced: true, reason: 'fuel' });
  });
  test('megállás nélküli kerülő → nem kényszerű, nem számoljuk le', () => {
    const p = [[T, 46.0, 24.0, 70]];
    let t = drive(p, T, [46.0, 24.0], [46.2, 24.0], 20);
    t = drive(p, t, [46.2, 24.0], [46.3, 24.15], 15);
    t = drive(p, t, [46.3, 24.15], [46.4, 24.0], 15);
    drive(p, t, [46.4, 24.0], [46.5, 24.0], 10);
    const ex = rd.excursions(p, T, T + 99999, plan, []);
    expect(ex).toHaveLength(1);
    expect(ex[0]).toMatchObject({ forced: false, excused_km: 0 });
  });
  test('hosszú rossz út egy rövid megállással: a leszámítás felülről korlátos', () => {
    const p = [[T, 46.0, 24.0, 70]];
    let t = drive(p, T, [46.0, 24.0], [46.05, 24.0], 5);
    t = drive(p, t, [46.05, 24.0], [46.05, 24.03], 3, 40);   // ~2.3 km kelet
    t = drive(p, t, [46.05, 24.03], [46.45, 24.03], 60);     // végig 2.3 km-re a tervtől (párhuzamos út)
    t = stand(p, t, [46.45, 24.03], 12);
    t = drive(p, t, [46.45, 24.03], [46.45, 24.0], 3, 40);
    drive(p, t, [46.45, 24.0], [46.5, 24.0], 5);
    const ex = rd.excursions(p, T, T + 99999, plan, []);
    expect(ex[0].forced).toBe(true);
    expect(ex[0].excused_km).toBeLessThanOrEqual(2 * ex[0].max_off_km + 2 + 0.1);
  });
});

describe('summarizeSegments', () => {
  test('bármelyik szakasz eltér → az út eltéréses; a no_data szakasz nem számít', () => {
    const s = rd.summarizeSegments([
      { status: 'ok', extra_km: 0, excused_km: 3 },
      { status: 'deviation', extra_km: 12.4, excused_km: 0, extra_h: 0.2, extra_l: 3.7, extra_toll: 1.5 },
      { status: 'no_data' }]);
    expect(s).toMatchObject({ status: 'deviation', evaluated: 2, total: 3, deviation: 1, extra_km: 12.4, excused_km: 3, extra_toll: 1.5 });
    expect(rd.summarizeSegments([{ status: 'no_data' }]).status).toBeNull();
  });
});

describe('checkOrder — szakaszonként', () => {
  beforeEach(() => { pool.query.mockReset(); jest.spyOn(est, 'requireHere').mockResolvedValue('K'); });
  afterEach(() => { jest.restoreAllMocks(); });

  test('a nyers km több, de a többlet egy tankolás kitérője → rendben; a szakasz-részletek mentve', async () => {
    const T = Date.parse('2026-10-01T08:00:00Z') / 1000;
    const p = [[T, 46.0, 24.0, 0]];
    let t = drive(p, T, [46.0, 24.0], [46.2, 24.0], 20);
    t = drive(p, t, [46.2, 24.0], [46.2, 24.06], 6, 40);
    t = stand(p, t, [46.2, 24.06], 20);
    t = drive(p, t, [46.2, 24.06], [46.21, 24.0], 6, 40);
    t = drive(p, t, [46.21, 24.0], [46.5, 24.0], 30);
    const tEnd = t;
    const ae = require('../../lib/stopAutoEvents');
    jest.spyOn(ae, 'loadPoints').mockResolvedValue(p);
    const rc = require('../../lib/routeChain');
    jest.spyOn(rc, 'routeChain').mockResolvedValue({ km: 56, durationSeconds: 3000, polyline: [[46.0, 24.0], [46.5, 24.0]],
      legs: [{ km: 56, m: 55600, sec: 3000, empty: false }], loaded_km: 56, empty_km: 0, source: 'here-truck' });
    const stop = (o) => Object.assign({ loc: 'X', match_status: 'auto', needs_manual: false, arrived_at: null, done_at: null }, o);
    const STOPS = [
      stop({ id: 1, kind: 'pickup', actual_lat: 46.0, actual_lng: 24.0, gps_arrived_at: new Date((T - 3600) * 1000).toISOString(), gps_left_at: new Date(T * 1000).toISOString() }),
      stop({ id: 2, kind: 'delivery', actual_lat: 46.5, actual_lng: 24.0, gps_arrived_at: new Date(tEnd * 1000).toISOString(), gps_left_at: new Date((tEnd + 3600) * 1000).toISOString() })];
    pool.query.mockResolvedValueOnce(rows([{ id: 'O1', rendszam_camion: 'B1X' }]))
      .mockResolvedValueOnce(rows(STOPS))
      .mockResolvedValue(rows([]));
    const r = await rd.checkOrder(7, 'O1');
    expect(r.status).toBe('ok');
    expect(r.actual_km).toBeGreaterThan(56 + 3);                  // nyersen több a tűrésnél
    const save = pool.query.mock.calls.find((x) => /INSERT INTO order_route_deviation/.test(x[0]));
    const det = JSON.parse(save[1][12]);
    expect(det.v).toBe(rd.CALC_VERSION);
    expect(det.segments).toHaveLength(1);
    expect(det.segments[0]).toMatchObject({ status: 'ok', planned_km: 55.6 });
    expect(det.segments[0].detours[0]).toMatchObject({ reason: 'parking' });
    expect(save[1][13]).toBe(0);                                   // extra_km
  });

  test('ugyanez kitérő-állás nélkül (kerülő) → eltérés, többlet-km + üzemanyag', async () => {
    const T = Date.parse('2026-10-01T08:00:00Z') / 1000;
    const p = [[T, 46.0, 24.0, 0]];
    let t = drive(p, T, [46.0, 24.0], [46.2, 24.0], 20);
    t = drive(p, t, [46.2, 24.0], [46.3, 24.2], 20);
    t = drive(p, t, [46.3, 24.2], [46.4, 24.0], 20);
    t = drive(p, t, [46.4, 24.0], [46.5, 24.0], 10);
    const tEnd = t;
    jest.spyOn(require('../../lib/stopAutoEvents'), 'loadPoints').mockResolvedValue(p);
    jest.spyOn(require('../../lib/routeChain'), 'routeChain').mockResolvedValue({ km: 56, durationSeconds: 3000, polyline: [[46.0, 24.0], [46.5, 24.0]],
      legs: [{ km: 56, m: 55600, sec: 3000, empty: false }], loaded_km: 56, empty_km: 0, source: 'here-truck' });
    jest.spyOn(require('../../lib/tollEstimate'), 'countryForPoint').mockResolvedValue('HU');
    const stop = (o) => Object.assign({ loc: 'X', match_status: 'auto', needs_manual: false, arrived_at: null, done_at: null }, o);
    pool.query.mockResolvedValueOnce(rows([{ id: 'O1', rendszam_camion: 'B1X' }]))
      .mockResolvedValueOnce(rows([
        stop({ id: 1, kind: 'pickup', actual_lat: 46.0, actual_lng: 24.0, gps_arrived_at: new Date((T - 3600) * 1000).toISOString(), gps_left_at: new Date(T * 1000).toISOString() }),
        stop({ id: 2, kind: 'delivery', actual_lat: 46.5, actual_lng: 24.0, gps_arrived_at: new Date(tEnd * 1000).toISOString(), gps_left_at: new Date((tEnd + 3600) * 1000).toISOString() })]))
      .mockImplementation(async (sql) => (/FROM vehicles/.test(String(sql)) ? rows([{ fuel_per_100km: 32 }]) : rows([])));
    const r = await rd.checkOrder(7, 'O1');
    expect(r.status).toBe('deviation');
    expect(r.extra_km).toBeGreaterThan(10);
    const save = pool.query.mock.calls.find((x) => /INSERT INTO order_route_deviation/.test(x[0]));
    const seg = JSON.parse(save[1][12]).segments[0];
    expect(seg.status).toBe('deviation');
    expect(seg.extra_l).toBeCloseTo(seg.extra_km * 0.32, 0);
    expect(seg.extra_toll).toBeCloseTo(seg.extra_km * 0.28, 0);    // HU €/km
    expect(seg.detours).toEqual([]);
  });

  test('régi sor (nincs extra_km) → a driverBoard/summarize a nyers különbséget veszi', () => {
    const b = rd.driverBoard([{ email_sofer: 'a@x', planned_km: 100, actual_km: 120, diff_km: 20, status: 'deviation', detail: {} }]);
    expect(b.drivers[0].extra_km).toBe(20);
    const b2 = rd.driverBoard([{ email_sofer: 'a@x', planned_km: 100, actual_km: 120, diff_km: 20, extra_km: '7.5', status: 'deviation', detail: {} }]);
    expect(b2.drivers[0].extra_km).toBe(7.5);
  });
});
