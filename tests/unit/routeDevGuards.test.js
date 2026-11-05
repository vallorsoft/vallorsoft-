// Útvonal-eltérés: megbízhatatlan / átfedő fuvarból NEM számolunk hamis eltérést.
jest.mock('../../db', () => require('../helpers/db-mock').pool);
const { pool } = require('../helpers/db-mock');
const rd = require('../../lib/routeDeviation');
const est = require('../../lib/routeEstimate');

const rows = (r) => ({ rows: r, rowCount: r.length });
const ORDER = { id: 'O1', rendszam_camion: 'B104VLR' };
const stop = (o) => Object.assign({ kind: 'pickup', loc: 'Ploiesti', actual_lat: 44.9, actual_lng: 26.0,
  gps_arrived_at: '2026-10-01T06:00:00Z', gps_left_at: '2026-10-01T08:00:00Z', arrived_at: null, done_at: null,
  match_status: 'auto', needs_manual: false }, o);
const STOPS = [stop({ id: 1 }), stop({ id: 2, kind: 'delivery', actual_lat: 46.1, actual_lng: 24.3,
  gps_arrived_at: '2026-10-02T10:00:00Z', gps_left_at: '2026-10-02T12:00:00Z' })];

beforeEach(() => { pool.query.mockReset(); });
const savedDetail = () => {
  const c = pool.query.mock.calls.find((x) => /INSERT INTO order_route_deviation/.test(x[0]));
  return c ? JSON.parse(c[1][12]) : null;
};

describe('checkOrder védőkorlátok', () => {
  test('kézi megerősítésre váró állomás → no_data / unreliable, nincs HERE-hívás', async () => {
    const spy = jest.spyOn(est, 'estimateRoute');
    pool.query.mockResolvedValueOnce(rows([ORDER]))
      .mockResolvedValueOnce(rows([STOPS[0], Object.assign({}, STOPS[1], { match_status: 'suggested', needs_manual: true })]))
      .mockResolvedValue(rows([]));
    const r = await rd.checkOrder(7, 'O1');
    expect(r).toMatchObject({ status: 'no_data', reason: 'unreliable' });
    expect(savedDetail()).toMatchObject({ reason: 'unreliable', v: rd.CALC_VERSION });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  test('GPS-idő napokkal eltér a sofőr gombjától → no_data / time', async () => {
    pool.query.mockResolvedValueOnce(rows([ORDER]))
      .mockResolvedValueOnce(rows([STOPS[0], Object.assign({}, STOPS[1], { arrived_at: '2026-10-07T10:00:00Z' })]))
      .mockResolvedValue(rows([]));
    const r = await rd.checkOrder(7, 'O1');
    expect(r).toMatchObject({ status: 'no_data', reason: 'time' });
  });

  test('közben másik fuvar → az egész út egy tervbe fűzve, időrendben, mindkét fuvarra mentve', async () => {
    const rc = require('../../lib/routeChain');
    const spy = jest.spyOn(rc, 'routeChain').mockResolvedValue({ km: 2800, durationSeconds: 36000, polyline: [[44.9, 26], [46.1, 24.3]],
      legs: [], loaded_km: 2000, empty_km: 800, source: 'here-truck' });
    const gtm = require('../../lib/gpsTrack');
    const ae = require('../../lib/stopAutoEvents');
    const t0 = Date.parse('2026-10-01T08:00:00Z') / 1000;
    jest.spyOn(ae, 'loadPoints').mockResolvedValue([[t0 + 60, 44.9, 26, 0], [t0 + 86400 * 2, 46.1, 24.3, 0]]);
    jest.spyOn(gtm, 'odoDelta').mockReturnValue(2842);
    const O2 = [stop({ id: 3, loc: 'Arad', actual_lat: 46.17, actual_lng: 21.3,
      gps_arrived_at: '2026-10-01T20:00:00Z', gps_left_at: '2026-10-01T22:00:00Z' }),
    stop({ id: 4, kind: 'delivery', loc: 'Copsa', actual_lat: 46.1, actual_lng: 24.3,
      gps_arrived_at: '2026-10-03T10:00:00Z', gps_left_at: '2026-10-03T12:00:00Z' })];
    pool.query.mockResolvedValueOnce(rows([ORDER]))
      .mockResolvedValueOnce(rows(STOPS))
      .mockResolvedValueOnce(rows([{ id: 'O2', fuvar_no: 'CMD-2026-0054' }]))
      .mockResolvedValueOnce(rows(O2))
      .mockResolvedValue(rows([]));
    const r = await rd.checkOrder(7, 'O1');
    expect(r).toMatchObject({ status: 'ok', planned_km: 2800, actual_km: 2842, group: 2 });
    // 3. hívás: az átfedés-keresés a már bent lévő fuvarokat kizárja
    expect(pool.query.mock.calls[2][1].slice(0, 3)).toEqual([7, ['O1'], 'B104VLR']);
    // időrend: Ploiești → Arad → Copșa (O1 lerakó) → Copșa (O2 lerakó)
    expect(spy.mock.calls[0][1].map((w) => w.lat)).toEqual([44.9, 46.17, 46.1, 46.1]);
    const saves = pool.query.mock.calls.filter((x) => /INSERT INTO order_route_deviation/.test(x[0]));
    expect(saves.map((x) => x[1][0])).toEqual(['O1', 'O2']);
    expect(JSON.parse(saves[0][1][12])).toMatchObject({ group_key: 'O1|O2', empty_km: 800 });
    jest.restoreAllMocks();
  });

  test('a másik fuvar állomása bizonytalan → no_data / overlap', async () => {
    pool.query.mockResolvedValueOnce(rows([ORDER]))
      .mockResolvedValueOnce(rows(STOPS))
      .mockResolvedValueOnce(rows([{ id: 'O2', fuvar_no: 'CMD-2026-0054' }]))
      .mockResolvedValueOnce(rows([stop({ id: 3, match_status: 'unmatched' }), stop({ id: 4, kind: 'delivery' })]))
      .mockResolvedValue(rows([]));
    const r = await rd.checkOrder(7, 'O1');
    expect(r).toMatchObject({ status: 'no_data', reason: 'overlap' });
    expect(savedDetail().overlap).toEqual([{ id: 'O2', fuvar_no: 'CMD-2026-0054' }]);
  });

  test('driverBoard + summarize: az egy útba fűzött fuvarokat egyszer számolja', () => {
    const det = { group_key: 'O1|O2', stats: {} };
    const b = rd.driverBoard([
      { email_sofer: 'a@x', planned_km: 2800, actual_km: 2842, diff_km: 42, status: 'deviation', detail: det },
      { email_sofer: 'a@x', planned_km: 2800, actual_km: 2842, diff_km: 42, status: 'deviation', detail: det }]);
    expect(b.drivers[0]).toMatchObject({ orders: 1, planned_km: 2800 });
    const s = rd.summarize([{ status: 'ok', planned_km: 100, actual_km: 100, diff_km: 0, group_key: 'g' },
      { status: 'ok', planned_km: 100, actual_km: 100, diff_km: 0, group_key: 'g' }]);
    expect(s.planned_km).toBe(100);
  });

  test('_timeMismatch: csak ha mindkettő megvan és > 12 óra', () => {
    expect(rd._timeMismatch('2026-10-01T00:00:00Z', null)).toBe(false);
    expect(rd._timeMismatch('2026-10-01T00:00:00Z', '2026-10-01T11:00:00Z')).toBe(false);
    expect(rd._timeMismatch('2026-10-01T00:00:00Z', '2026-10-01T13:00:00Z')).toBe(true);
  });

  test('pickQueue: a régi számítási verziójú sorokat újraellenőrzi', async () => {
    pool.query.mockResolvedValueOnce(rows([]));
    await rd.pickQueue(20);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/detail->>'v'/);
    expect(params).toEqual([20, rd.CALC_VERSION]);
  });
});
