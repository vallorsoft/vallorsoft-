// handlers/gpsTrack.js — GPS útvonal-előzmény lekérdezés (Admin/Manager, company_id-szűrt)
jest.mock('../../db', () => require('../helpers/db-mock').pool);

const request = require('supertest');
const express = require('express');
const { pool, rows, reset } = require('../helpers/db-mock');
const { setUser, sessionMiddleware, fixtures } = require('../helpers/session-mock');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(sessionMiddleware);
app.use(require('../../routes/execute'));
const call = (fn, args) => request(app).post('/api/execute').send({ functionName: fn, arguments: args });

const CID = 1;
const ADMIN = { ...fixtures.admin, company_id: CID };
const SOFER = { ...fixtures.sofer, company_id: CID };

beforeEach(() => {
  reset();
  global.fetch = jest.fn(async () => { throw new Error('offline'); });   // reverse geocode → null
});

describe('gpsTrackVehicles', () => {
  test('Sofer nem éri el', async () => {
    setUser(SOFER);
    const r = await call('gpsTrackVehicles', []);
    expect(r.body.result.ok).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });
  test('párosított járművek + mentett napok száma, cégre szűrve', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([{ rendszam: 'B104VLR', marca: 'Mercedes' }]))
      .mockResolvedValueOnce(rows([{ rendszam: 'B104VLR', days: 12, first_day: '2026-10-01', last_day: '2026-10-12' }]));
    const r = await call('gpsTrackVehicles', []);
    expect(r.body.result.ok).toBe(true);
    expect(r.body.result.vehicles[0].days).toBe(12);
    expect(pool.query.mock.calls[0][1]).toEqual([CID]);
  });
});

describe('gpsTrackRange', () => {
  test('érvénytelen / túl hosszú időszak', async () => {
    setUser(ADMIN);
    let r = await call('gpsTrackRange', [{ rendszam: 'B104VLR', from: '2026-10-10', to: '2026-10-01' }]);
    expect(r.body.result.ok).toBe(false);
    r = await call('gpsTrackRange', [{ rendszam: 'B104VLR', from: '2026-08-01', to: '2026-09-15' }]);
    expect(r.body.result.ok).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });
  test('más cég járműve / nem párosított → elutasítva', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([{ rendszam: 'CJ01ABC', object_id: '9' }]));
    const r = await call('gpsTrackRange', [{ rendszam: 'B104VLR', from: '2026-10-01', to: '2026-10-02' }]);
    expect(r.body.result.ok).toBe(false);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
  test('illesztett nap: úton mért km, menetek, összesítő', async () => {
    setUser(ADMIN);
    const t0 = Date.parse('2026-10-01T05:00:00Z') / 1000;
    const pts = [];
    for (let i = 0; i <= 10; i++) pts.push([t0 + i * 60, 45.0, 25.0, 0, 0, 1000, 50]);
    for (let i = 1; i <= 60; i++) pts.push([t0 + 600 + i * 60, 45.0 + i * 0.0015, 25.0, 60, 1, 1000 + i, 50 + i * 0.3]);
    for (let i = 1; i <= 10; i++) pts.push([t0 + 4200 + i * 60, 45.09, 25.0, 0, 0, 1060, 68]);
    pool.query
      .mockResolvedValueOnce(rows([{ rendszam: 'B 104 VLR', object_id: '7' }]))
      .mockResolvedValueOnce(rows([{ company_id: CID, rendszam: 'B 104 VLR', day: '2026-10-01', points_json: JSON.stringify(pts),
        point_count: pts.length, complete: true, segments: [{ p: '_ibE_ibE', k: 'm' }], km_road: 61.2, km_raw: 60, match_source: 'osrm',
        matched_count: pts.length, matched_at: '2026-10-02T00:00:00Z' }]));
    const r = await call('gpsTrackRange', [{ rendszam: 'b104vlr', from: '2026-10-01', to: '2026-10-01' }]);
    const res = r.body.result;
    expect(res.ok).toBe(true);
    expect(res.days).toHaveLength(1);
    expect(res.days[0].matched).toBe(true);
    expect(res.days[0].trips).toHaveLength(1);
    expect(res.totals.km_road).toBeCloseTo(61.2);
    expect(res.totals.km_odo).toBeCloseTo(60);
    expect(res.totals.fuel).toBeCloseTo(18);
    expect(res.totals.avg_l100).toBeCloseTo(30);
    expect(pool.query.mock.calls[1][1]).toEqual([CID, 'B 104 VLR', '2026-10-01', '2026-10-01']);
  });
});
