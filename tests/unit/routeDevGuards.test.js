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

  test('a kamion közben más fuvart csinált → no_data / overlap, a fuvarszámokkal', async () => {
    pool.query.mockResolvedValueOnce(rows([ORDER]))
      .mockResolvedValueOnce(rows(STOPS))
      .mockResolvedValueOnce(rows([{ id: 'O2', fuvar_no: 'CMD-2026-0054' }]))
      .mockResolvedValue(rows([]));
    const r = await rd.checkOrder(7, 'O1');
    expect(r).toMatchObject({ status: 'no_data', reason: 'overlap' });
    expect(savedDetail().overlap).toEqual([{ id: 'O2', fuvar_no: 'CMD-2026-0054' }]);
    const q = pool.query.mock.calls[2];
    expect(q[0]).toMatch(/o\.id <> \$2/);
    expect(q[1].slice(0, 3)).toEqual([7, 'O1', 'B104VLR']);
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
