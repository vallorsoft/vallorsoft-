jest.mock('../../db', () => require('../helpers/db-mock').pool);
jest.mock('../../services/push', () => ({ sendPushToRole: jest.fn().mockResolvedValue(true) }));
const { pool, rows, reset } = require('../helpers/db-mock');
const ae = require('../../lib/stopAutoEvents');
const h = require('../../handlers/stopAutoEvents');

const NOW = Date.parse('2026-11-05T12:00:00Z');
const T = (s) => '2026-11-05T' + s + ':00Z';
const sec = (s) => Math.floor(Date.parse(T(s)) / 1000);
const stop = (o) => Object.assign({ id: 1, kind: 'pickup', arrived_at: null, done_at: null, match_status: 'auto',
  gps_arrived_at: T('06:00'), gps_left_at: T('07:30') }, o);

describe('planAutoFill — mikor tölti ki a rendszer a sofőr helyett', () => {
  const last = sec('11:00');
  test('biztos felismerés, elment a kamion → érkezés + kész', () => {
    const p = ae.planAutoFill([stop()], last, NOW);
    expect(p).toEqual([{ id: 1, kind: 'pickup', arrive: T('06:00').replace('Z', '.000Z'), done: T('07:30').replace('Z', '.000Z'), filled: 'both' }]);
  });
  test('csak javaslat (nem biztos) → semmi', () => {
    expect(ae.planAutoFill([stop({ match_status: 'suggested' })], last, NOW)).toEqual([]);
  });
  test('a kamion még ott áll (nincs utána GPS) → semmi', () => {
    expect(ae.planAutoFill([stop({ gps_left_at: T('10:55') })], last, NOW)).toEqual([]);
  });
  test('a sofőr az érkezést megnyomta → csak a kész', () => {
    const p = ae.planAutoFill([stop({ arrived_at: T('06:05') })], last, NOW);
    expect(p[0].filled).toBe('done'); expect(p[0].arrive).toBeNull();
  });
  test('sorrend: az előző állomás nincs kész és nem tölthető → a későbbit sem', () => {
    const p = ae.planAutoFill([stop({ match_status: 'unmatched' }), stop({ id: 2, kind: 'delivery', gps_arrived_at: T('09:00'), gps_left_at: T('10:00') })], last, NOW);
    expect(p).toEqual([]);
  });
  test('több állomás sorban, a sofőr által kész állomás horgony', () => {
    const p = ae.planAutoFill([
      stop({ arrived_at: T('05:50'), done_at: T('07:40') }),
      stop({ id: 2, kind: 'delivery', gps_arrived_at: T('09:00'), gps_left_at: T('10:00') }),
    ], last, NOW);
    expect(p.map((x) => x.id)).toEqual([2]);
  });
  test('a GPS-állás az előző kész ELŐTT kezdődik → nem hihető', () => {
    const p = ae.planAutoFill([stop({ done_at: T('09:30') }), stop({ id: 2, kind: 'delivery', gps_arrived_at: T('08:00'), gps_left_at: T('09:00') })], last, NOW);
    expect(p).toEqual([]);
  });
  test('egy későbbi gombnyomás felső korlát', () => {
    const p = ae.planAutoFill([stop(), stop({ id: 2, kind: 'delivery', arrived_at: T('07:00'), match_status: 'unmatched', gps_arrived_at: null, gps_left_at: null })], last, NOW);
    expect(p).toEqual([]);
  });
  test('túl friss távozás (< 15 perc) → még vár', () => {
    expect(ae.planAutoFill([stop({ gps_left_at: T('11:50') })], sec('11:59') + 3600, NOW)).toEqual([]);
  });
});

describe('dwellNear — térképes javítás', () => {
  test('a kijelölt hely körüli leghosszabb állás', () => {
    const pts = [];
    for (let i = 0; i < 30; i++) pts.push([1000 + i * 60, 46.0, 23.0]);
    for (let i = 0; i < 10; i++) pts.push([3000 + i * 60, 46.2, 23.2]);
    const d = ae.dwellNear(pts, 46.0005, 23.0005, 400);
    expect(d.from).toBe(1000); expect(d.to).toBe(1000 + 29 * 60);
  });
  test('nincs pont a közelben → null', () => {
    expect(ae.dwellNear([[1, 46, 23], [100, 46, 23]], 47, 24, 400)).toBeNull();
  });
});

describe('handlers/stopAutoEvents — csak a sofőr, csak a saját', () => {
  const resMock = () => { const r = { json: jest.fn() }; return r; };
  const req = (u) => ({ session: { user: u }, ip: '1.1.1.1', headers: {} });
  const drv = { pozicio: 'Sofer', company_id: 7, email: 'a@b.ro', nume: 'A' };
  beforeEach(() => reset());

  test('nem sofőr → tiltva', async () => {
    const res = resMock();
    await h.getMyAutoStopEvents(req({ pozicio: 'Manager', company_id: 7 }), res);
    expect(res.json.mock.calls[0][0].result.ok).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });
  test('lista: cégre + sofőr e-mailre szűrt', async () => {
    pool.query.mockResolvedValueOnce(rows([{ id: 5 }]));
    const res = resMock();
    await h.getMyAutoStopEvents(req(drv), res);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/LOWER\(o\.email_sofer\) = LOWER\(\$2\)/);
    expect(params).toEqual([7, 'a@b.ro']);
    expect(res.json.mock.calls[0][0].result.items).toHaveLength(1);
  });
  test('rendben: csak a saját, még nyitott tételek', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 5 }], rowCount: 1 });
    pool.query.mockResolvedValue(rows([]));
    const res = resMock();
    await h.ackAutoStopEvents(req(drv), res, [{ ids: [5, 'x'] }]);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/auto_ack_at IS NULL/);
    expect(params).toEqual([[5], 7, 'a@b.ro']);
    expect(res.json.mock.calls[0][0].result.acked).toBe(1);
  });
  test('idő-javítás: idegen / már átnézett állomás → hiba', async () => {
    pool.query.mockResolvedValueOnce(rows([]));
    const res = resMock();
    await h.correctAutoStopTime(req(drv), res, [{ id: 9, done_at: new Date().toISOString() }]);
    expect(res.json.mock.calls[0][0].result.ok).toBe(false);
  });
  test('idő-javítás: a kész nem lehet az érkezés előtt', async () => {
    pool.query.mockResolvedValueOnce(rows([{ id: 9, order_id: 'X', auto_filled: 'both', arrived_at: null }]));
    const res = resMock();
    const now = Date.now();
    await h.correctAutoStopTime(req(drv), res, [{ id: 9, arrived_at: new Date(now - 3600e3).toISOString(), done_at: new Date(now - 7200e3).toISOString() }]);
    expect(res.json.mock.calls[0][0].result.ok).toBe(false);
  });
  test('térképes javítás: nincs állás a kijelölt helyen → hiba, nincs írás', async () => {
    pool.query.mockResolvedValueOnce(rows([{ id: 9, order_id: 'X', auto_filled: 'both', rendszam_camion: 'B1X', done_at: new Date().toISOString() }]));
    pool.query.mockResolvedValueOnce(rows([{ points_json: JSON.stringify([[1, 46, 23], [500, 46, 23]]) }]));
    const res = resMock();
    await h.correctAutoStopMap(req(drv), res, [{ id: 9, lat: 47, lng: 24 }]);
    expect(res.json.mock.calls[0][0].result.ok).toBe(false);
    expect(pool.query.mock.calls.every((c) => !/^\s*UPDATE/.test(c[0]))).toBe(true);
  });
});
