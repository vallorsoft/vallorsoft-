// Útvonal-eltérés döntés + km-számítás, tanult rakodási idő, tanulás a sofőr javításaiból
jest.mock('../../db', () => require('../helpers/db-mock').pool);
jest.mock('../../services/push', () => ({ sendPushToRole: jest.fn().mockResolvedValue(true) }));
jest.mock('../../lib/audit', () => ({ fromReq: jest.fn() }));
jest.mock('../../lib/featureEnabled', () => ({ featureEnabled: jest.fn().mockResolvedValue(true) }));
jest.mock('../../lib/stopMatchRunner', () => ({
  recordFeedback: jest.fn().mockResolvedValue(), recordBadPlace: jest.fn().mockResolvedValue(),
  coordText: (a, b) => a + ', ' + b, reversePlace: jest.fn().mockResolvedValue(null),
  formatAddress: () => 'x', matchOrder: jest.fn(), learnPlace: jest.fn(),
}));
const { pool, rows, reset } = require('../helpers/db-mock');
const rd = require('../../lib/routeDeviation');
const sd = require('../../lib/siteDwell');
const runner = require('../../lib/stopMatchRunner');

describe('routeDeviation.judge — más út rendben, ha nem több a km', () => {
  test('kevesebb km → rendben', () => expect(rd.judge(500, 470).status).toBe('ok'));
  test('azonos km (tűrésen belül) → rendben', () => expect(rd.judge(500, 512).status).toBe('ok'));
  test('több km a tűrésen felül → eltérés, %-kal', () => {
    const j = rd.judge(500, 560);
    expect(j.status).toBe('deviation'); expect(j.diff_km).toBe(60); expect(j.diff_pct).toBe(12);
  });
  test('rövid út: az abszolút 5 km-es tűrés számít', () => {
    expect(rd.judge(40, 44).status).toBe('ok');
    expect(rd.judge(40, 46).status).toBe('deviation');
  });
  test('hiányzó adat → no_data', () => {
    expect(rd.judge(0, 10).status).toBe('no_data');
    expect(rd.judge(100, null).status).toBe('no_data');
  });
});

describe('routeDeviation.kmBetween', () => {
  const pts = [[100, 46.0, 23.0, 50, 1, 1000], [200, 46.1, 23.0, 50, 1, 1011], [300, 46.2, 23.0, 50, 1, 1022], [400, 46.3, 23.0, 0, 0, 1033]];
  test('km-óra különbség, ha van', () => expect(rd.kmBetween(pts, 150, 350)).toEqual({ km: 11, src: 'odo' }));
  test('km-óra nélkül a pontok távolsága', () => {
    const p2 = pts.map((p) => [p[0], p[1], p[2], p[3], p[4], null]);
    const r = rd.kmBetween(p2, 100, 400);
    expect(r.src).toBe('gps'); expect(r.km).toBeGreaterThan(33); expect(r.km).toBeLessThan(34);
  });
  test('nincs pont az ablakban → null', () => expect(rd.kmBetween(pts, 500, 600)).toBeNull());
});

describe('siteDwell.aggregate — tanult rakodási idő', () => {
  test('medián cégenként, a pihenő és a pillanatnyi megállás kimarad, min. 2 minta', () => {
    const m = sd.aggregate([
      { firma: 'Gamma Kft', kind: 'delivery', minutes: 40 },
      { firma: 'GAMMA KFT.', kind: 'delivery', minutes: 60 },
      { firma: 'Gamma Kft', kind: 'delivery', minutes: 600 },   // éjszakai pihenő → kimarad
      { firma: 'Gamma Kft', kind: 'delivery', minutes: 1 },     // pillanatnyi → kimarad
      { firma: 'Alfa SRL', kind: 'pickup', minutes: 30 },       // 1 minta → kimarad
    ]);
    expect(sd.lookup(m, 'delivery', 'gamma kft')).toEqual({ min: 50, n: 2 });
    expect(sd.lookup(m, 'pickup', 'Alfa SRL')).toBeNull();
    expect(sd.lookup(m, 'pickup', 'Gamma Kft')).toBeNull();     // fajtánként külön
  });
});

describe('handlers/stopAutoEvents — tanulás a sofőr döntéséből', () => {
  const h = require('../../handlers/stopAutoEvents');
  const drv = { pozicio: 'Sofer', company_id: 7, email: 'a@b.ro' };
  const call = (fn, arg) => new Promise((ok) => h[fn]({ session: { user: drv }, headers: {}, ip: '1' }, { json: (b) => ok(b.result) }, [arg]));
  beforeEach(() => { reset(); runner.recordFeedback.mockClear(); runner.recordBadPlace.mockClear(); });

  test('„Rendben" → a győztes jelek elfogadott visszajelzést kapnak', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });   // jóváhagyás előtti ellenőrzés
    pool.query.mockResolvedValueOnce({ rows: [{ id: 5, match_detail: { signals: [['city_name', 20], ['date', 10]] } }], rowCount: 1 });
    const r = await call('ackAutoStopEvents', { ids: [5] });
    expect(r.ok).toBe(true);
    expect(runner.recordFeedback).toHaveBeenCalledWith(7, [['city_name', 20], ['date', 10]], true);
  });

  test('térképes javítás máshová → elutasított jelek + rossz hely', async () => {
    const now = Date.now() / 1000;
    pool.query.mockResolvedValueOnce(rows([{ id: 9, order_id: 'X', auto_filled: 'both', rendszam_camion: 'B1X', firma: 'Gamma Kft',
      actual_lat: 47.0, actual_lng: 24.0, done_at: new Date().toISOString(), match_detail: { signals: [['city_dist', 18]] } }]));
    const pts = []; for (let i = 0; i < 20; i++) pts.push([Math.floor(now) - 3600 + i * 60, 46.0, 23.0, 0, 0]);
    pool.query.mockResolvedValueOnce(rows([{ points_json: JSON.stringify(pts) }]));
    pool.query.mockResolvedValue(rows([]));
    const r = await call('correctAutoStopMap', { id: 9, lat: 46.0, lng: 23.0 });
    expect(r.ok).toBe(true);
    expect(runner.recordFeedback).toHaveBeenCalledWith(7, [['city_dist', 18]], false);
    expect(runner.recordBadPlace).toHaveBeenCalledWith(7, 47.0, 24.0, 'Gamma Kft');
  });

  test('térképes javítás ugyanoda (csak az idő változik) → nincs „rossz hely"', async () => {
    const now = Date.now() / 1000;
    pool.query.mockResolvedValueOnce(rows([{ id: 9, order_id: 'X', auto_filled: 'both', rendszam_camion: 'B1X', firma: 'G',
      actual_lat: 46.0001, actual_lng: 23.0001, done_at: new Date().toISOString(), match_detail: { signals: [['city_dist', 18]] } }]));
    const pts = []; for (let i = 0; i < 20; i++) pts.push([Math.floor(now) - 3600 + i * 60, 46.0, 23.0, 0, 0]);
    pool.query.mockResolvedValueOnce(rows([{ points_json: JSON.stringify(pts) }]));
    pool.query.mockResolvedValue(rows([]));
    await call('correctAutoStopMap', { id: 9, lat: 46.0, lng: 23.0 });
    expect(runner.recordBadPlace).not.toHaveBeenCalled();
  });
});

describe('handlers/stopMatch — útvonal-eltérés lista', () => {
  const h = require('../../handlers/stopMatch');
  const call = (u, arg) => new Promise((ok) => h.routeDeviationList({ session: { user: u }, headers: {} }, { json: (b) => ok(b.result) }, [arg || {}]));
  beforeEach(() => reset());
  test('sofőr nem éri el', async () => {
    const r = await call({ pozicio: 'Sofer', company_id: 7 });
    expect(r.ok).toBe(false); expect(pool.query).not.toHaveBeenCalled();
  });
  test('cégre szűrt, státusz-szűrővel', async () => {
    pool.query.mockResolvedValueOnce(rows([{ order_id: 'A', status: 'deviation' }])).mockResolvedValueOnce(rows([{ status: 'deviation', n: 1 }]));
    const r = await call({ pozicio: 'Manager', company_id: 7 }, { status: 'deviation', from: '2026-10-01', to: '2026-10-31' });
    expect(r.ok).toBe(true); expect(r.counts.deviation).toBe(1);
    expect(pool.query.mock.calls[0][1]).toEqual([7, '2026-10-01', '2026-10-31', 'deviation']);
  });
});
