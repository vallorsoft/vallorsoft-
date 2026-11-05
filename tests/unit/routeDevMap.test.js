// Útvonal-eltérés térképes nézet: letérés-számítás, mutatók, összesítés, RPC-kapuk
jest.mock('../../db', () => require('../helpers/db-mock').pool);
jest.mock('../../lib/audit', () => ({ fromReq: jest.fn() }));
jest.mock('../../lib/featureEnabled', () => ({ featureEnabled: jest.fn().mockResolvedValue(true) }));
const { pool, rows, reset } = require('../helpers/db-mock');
const rd = require('../../lib/routeDeviation');

// Kelet felé haladó egyenes terv 46.0 szélességen
const PLAN = [[46.0, 23.0], [46.0, 23.5], [46.0, 24.0]];

describe('distToLineKm', () => {
  test('a vonalon 0, ~11 km-re északra ~11', () => {
    expect(rd.distToLineKm(46.0, 23.2, PLAN)).toBeLessThan(0.01);
    const d = rd.distToLineKm(46.1, 23.2, PLAN);
    expect(d).toBeGreaterThan(10.9); expect(d).toBeLessThan(11.2);
  });
  test('üres vonal → null', () => expect(rd.distToLineKm(46, 23, [])).toBeNull());
});

describe('trackStats', () => {
  // 0–30. perc: a terven; 30–60.: kitérő 5 km-re északra; 60–90.: vissza a tervre; közben 20 perces megállás
  function track() {
    const pts = []; let t = 1000;
    for (let i = 0; i <= 30; i++) pts.push([t + i * 60, 46.0, 23.0 + i * 0.01, 70, 1]);
    t += 31 * 60;
    for (let i = 0; i < 30; i++) pts.push([t + i * 60, 46.045, 23.3 + i * 0.01, 70, 1]);
    t += 30 * 60;
    for (let i = 0; i < 20; i++) pts.push([t + i * 60, 46.0, 23.6, 0, 0]);       // 20 perc állás
    t += 20 * 60;
    for (let i = 0; i <= 30; i++) pts.push([t + i * 60, 46.0, 23.6 + i * 0.01, 75, 1]);
    return pts;
  }
  test('letért szakasz pirosra, mutatók', () => {
    const tr = track();
    const s = rd.trackStats(tr, tr[0][0], tr[tr.length - 1][0], PLAN, 800);
    expect(s.off.length).toBe(1);                       // egy összefüggő kitérő
    expect(s.max_off_km).toBeGreaterThan(4.5); expect(s.max_off_km).toBeLessThan(5.5);
    expect(s.off_km).toBeGreaterThan(15);
    expect(s.off_pct).toBeGreaterThan(10); expect(s.off_pct).toBeLessThan(60);
    expect(s.stops).toBe(1);
    expect(s.stop_h).toBeGreaterThan(0.25);
    expect(s.max_kmh).toBe(75);
    expect(s.duration_h).toBeGreaterThan(1.8);
    expect(s.drive_h).toBeLessThan(s.duration_h);
    expect(s.points.length).toBeGreaterThan(10);
  });
  test('terv nélkül nincs letérés-adat, de a menet-mutatók megvannak', () => {
    const tr = track();
    const s = rd.trackStats(tr, tr[0][0], tr[tr.length - 1][0], [], 800);
    expect(s.off).toEqual([]); expect(s.max_off_km).toBeNull(); expect(s.stops).toBe(1);
  });
  test('ritkítás a pontszám-korlátig', () => {
    const tr = track();
    const s = rd.trackStats(tr, tr[0][0], tr[tr.length - 1][0], PLAN, 20);
    expect(s.points.length).toBeLessThanOrEqual(22);
  });
  test('üres ablak', () => expect(rd.trackStats(track(), 1, 2, PLAN).points).toEqual([]));
});

describe('summarize', () => {
  test('többlet-km csak az eltéréseseknél, megtakarítás a rövidebbeknél', () => {
    const s = rd.summarize([
      { status: 'deviation', planned_km: 300, actual_km: 340, diff_km: 40, stats: { off_km: 20, drive_h: 5, stops: 2 } },
      { status: 'ok', planned_km: 200, actual_km: 190, diff_km: -10, stats: { off_km: 0, drive_h: 3, stops: 1 } },
      { status: 'ok', planned_km: 100, actual_km: 103, diff_km: 3, stats: null },
      { status: 'not_checked', planned_km: null, actual_km: null, diff_km: null },
    ]);
    expect(s.orders).toBe(4); expect(s.checked).toBe(3); expect(s.deviation).toBe(1); expect(s.not_checked).toBe(1);
    expect(s.planned_km).toBe(600); expect(s.actual_km).toBe(633); expect(s.diff_km).toBe(33); expect(s.diff_pct).toBe(5.5);
    expect(s.extra_km).toBe(40); expect(s.saved_km).toBe(10); expect(s.off_km).toBe(20); expect(s.drive_h).toBe(8); expect(s.stops).toBe(3);
  });
});

describe('handlers.routeDeviationMap', () => {
  const h = require('../../handlers/stopMatch');
  const call = (u, arg) => new Promise((ok) => h.routeDeviationMap({ session: { user: u }, headers: {} }, { json: (b) => ok(b.result) }, [arg || {}]));
  const MGR = { pozicio: 'Manager', company_id: 7 };
  beforeEach(() => reset());

  test('sofőr nem éri el', async () => {
    const r = await call({ pozicio: 'Sofer', company_id: 7 }, { order_id: 'A' });
    expect(r.ok).toBe(false); expect(pool.query).not.toHaveBeenCalled();
  });

  test('egy fuvar: cégre szűrt, terv + valós út', async () => {
    const from = '2026-10-01T06:00:00Z', to = '2026-10-01T09:00:00Z';
    pool.query.mockResolvedValueOnce(rows([{ id: 'A', fuvar_no: 'CMD-2026-0001', rendszam_camion: 'B1X', status: 'Finalizat',
      planned_km: '300', actual_km: '340', diff_km: '40', diff_pct: '13.3', dev_status: 'deviation', source: 'here', km_source: 'odo',
      from_at: from, to_at: to, planned_geo: PLAN, detail: { waypoints: [{ lat: 46, lng: 23, kind: 'pickup' }, { lat: 46, lng: 24, kind: 'delivery' }] } }]));
    const t0 = Date.parse(from) / 1000, pts = [];
    for (let i = 0; i < 50; i++) pts.push([t0 + i * 120, 46.0, 23 + i * 0.02, 70, 1]);
    pool.query.mockResolvedValueOnce(rows([{ points_json: JSON.stringify(pts) }]));
    const r = await call(MGR, { order_id: 'A' });
    expect(r.ok).toBe(true); expect(r.mode).toBe('order');
    expect(pool.query.mock.calls[0][1]).toEqual(['A', 7]);
    const it = r.items[0];
    expect(it.status).toBe('deviation'); expect(it.planned_km).toBe(300); expect(it.planned.length).toBe(3);
    expect(it.actual.length).toBeGreaterThan(5); expect(it.stats.off_km).toBe(0);
    expect(r.summary.extra_km).toBe(40);
  });

  test('idegen / nem létező fuvar → hiba', async () => {
    pool.query.mockResolvedValueOnce(rows([]));
    const r = await call(MGR, { order_id: 'Z' });
    expect(r.ok).toBe(false);
  });

  test('menetlevél: a cég menetlevele, a fuvarjai sorban', async () => {
    pool.query.mockResolvedValueOnce(rows([{ id: 'W1', numar_fisa: 'MT-2026-0003', order_ids: ['A', 'B'] }]));
    pool.query.mockResolvedValueOnce(rows([{ id: 'A', status: 'Finalizat', dev_status: 'ok', planned_km: 100, actual_km: 98, diff_km: -2 }]));
    pool.query.mockResolvedValueOnce(rows([{ id: 'B', status: 'Finalizat', dev_status: 'deviation', planned_km: 50, actual_km: 70, diff_km: 20 }]));
    const r = await call(MGR, { waybill_id: 'W1' });
    expect(r.ok).toBe(true); expect(r.mode).toBe('waybill');
    expect(pool.query.mock.calls[0][1]).toEqual(['W1', 7]);
    expect(r.items.map((x) => x.order_id)).toEqual(['A', 'B']);
    expect(r.summary.extra_km).toBe(20); expect(r.summary.saved_km).toBe(2);
    expect(r.meta.numar_fisa).toBe('MT-2026-0003');
  });

  test('idegen menetlevél → hiba', async () => {
    pool.query.mockResolvedValueOnce(rows([]));
    const r = await call(MGR, { waybill_id: 'W9' });
    expect(r.ok).toBe(false);
  });

  test('időszak: dátum + státusz szűrő, cégre szűrt', async () => {
    pool.query.mockResolvedValueOnce(rows([{ order_id: 'A' }]));
    pool.query.mockResolvedValueOnce(rows([{ id: 'A', status: 'Finalizat', dev_status: 'deviation', planned_km: 10, actual_km: 30, diff_km: 20 }]));
    const r = await call(MGR, { from: '2026-10-01', to: '2026-10-31', status: 'deviation' });
    expect(r.ok).toBe(true); expect(r.mode).toBe('period');
    expect(pool.query.mock.calls[0][1]).toEqual([7, '2026-10-01', '2026-10-31', 'deviation', 41]);
  });
});
