// ============================================================
//  getLastVehicleReadings — hó-végi GPS snapshot pre-fill
//
//  Az RPC pre-fill logikája: ha van `gps_month_end_snapshots` sor
//  a járműre ÉS a snapshot `snapped_at` ÚJABB, mint az utolsó
//  menetlevél érkezése (fallback indulása), akkor a snapshot
//  mileage + fuel_level felülírja a menetlevél záró értékeit.
//  Egyébként (nincs snapshot / snapshot régebbi / hiányzó fuel)
//  a régi logika (utolsó menetlevél cant_sfarsit / km_sfarsit).
//
//  A hónap-határon átívelő menetlevél (pl. jún. 28 → júl. 3)
//  garantáltan nem csorbul: a jún. 30-i snapshot idősebb mint a
//  júl. 3-i érkezés → a menetlevél záró értéke nyer.
// ============================================================
jest.mock('../../db', () => require('../helpers/db-mock').pool);

const request = require('supertest');
const express = require('express');
const { pool, rows, reset } = require('../helpers/db-mock');
const { setUser, sessionMiddleware, fixtures } = require('../helpers/session-mock');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(sessionMiddleware);
app.use(require('../../routes/execute'));

function call(fn, args) {
  return request(app).post('/api/execute').send({ functionName: fn, arguments: args });
}

const CID = 1;
const SOFER = { ...fixtures.sofer, company_id: CID };

beforeEach(() => reset());

describe('getLastVehicleReadings — snapshot pre-fill', () => {
  test('nincs snapshot → utolsó menetlevél záró értékei', async () => {
    setUser(SOFER);
    // 1) fuvarlevelek fuel/km/last_arr sub-selectek
    pool.query
      .mockResolvedValueOnce(rows([{ fuel: 620, km: 100500, last_arr: '2026-07-03T14:00:00Z' }]))
      // 2) gps_month_end_snapshots — üres
      .mockResolvedValueOnce(rows([]));
    const res = await call('getLastVehicleReadings', ['B123ABC']);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.km).toBe(100500);
    expect(res.body.result.fuel).toBe(620);
    // level = fuel (visszafelé kompatibilis alias)
    expect(res.body.result.level).toBe(620);
  });

  test('snapshot ÚJABB mint az utolsó menetlevél → snapshot nyer', async () => {
    setUser(SOFER);
    pool.query
      // utolsó menetlevél: jún. 25 (régebbi mint a snapshot)
      .mockResolvedValueOnce(rows([{ fuel: 500, km: 99800, last_arr: '2026-06-25T10:00:00Z' }]))
      // snapshot: jún. 30 23:59 (újabb)
      .mockResolvedValueOnce(rows([{
        mileage: '100000.0', fuel_level: '580.5',
        snapped_at: '2026-06-30T21:59:00Z'
      }]));
    const res = await call('getLastVehicleReadings', ['B123ABC']);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.km).toBe(100000);
    expect(res.body.result.fuel).toBe(580.5);
  });

  test('snapshot RÉGEBBI mint az utolsó menetlevél (átívelő eset jún 28 → júl 3) → menetlevél nyer', async () => {
    setUser(SOFER);
    pool.query
      // utolsó menetlevél érkezése: júl. 3 (átívelő menetlevél, újabb mint a jún. 30 snapshot)
      .mockResolvedValueOnce(rows([{ fuel: 620, km: 100500, last_arr: '2026-07-03T14:00:00Z' }]))
      // snapshot: jún. 30 23:59 (RÉGEBBI)
      .mockResolvedValueOnce(rows([{
        mileage: '100000.0', fuel_level: '580.0',
        snapped_at: '2026-06-30T21:59:00Z'
      }]));
    const res = await call('getLastVehicleReadings', ['B123ABC']);
    expect(res.body.result.ok).toBe(true);
    // A júl. 3-i menetlevél záró értéke marad — a snapshot nem csorbítja
    expect(res.body.result.km).toBe(100500);
    expect(res.body.result.fuel).toBe(620);
  });

  test('snapshot van, de nincs korábbi menetlevél → snapshot pre-fill', async () => {
    setUser(SOFER);
    pool.query
      .mockResolvedValueOnce(rows([{ fuel: null, km: null, last_arr: null }]))
      .mockResolvedValueOnce(rows([{
        mileage: '75000.0', fuel_level: '450.0',
        snapped_at: '2026-06-30T21:59:00Z'
      }]));
    const res = await call('getLastVehicleReadings', ['B123ABC']);
    expect(res.body.result.km).toBe(75000);
    expect(res.body.result.fuel).toBe(450);
  });

  test('snapshot csak mileage-t tartalmaz (a GPS nem mér fuel-t) → fuel a menetlevélből', async () => {
    setUser(SOFER);
    pool.query
      .mockResolvedValueOnce(rows([{ fuel: 500, km: 99800, last_arr: '2026-06-25T10:00:00Z' }]))
      .mockResolvedValueOnce(rows([{
        mileage: '100000.0', fuel_level: null,
        snapped_at: '2026-06-30T21:59:00Z'
      }]));
    const res = await call('getLastVehicleReadings', ['B123ABC']);
    // km a snapshotból (újabb), fuel az utolsó menetlevélből
    expect(res.body.result.km).toBe(100000);
    expect(res.body.result.fuel).toBe(500);
  });

  test('snapshot-tábla lekérdezés dob (pl. migráció nélkül) → régi viselkedés', async () => {
    setUser(SOFER);
    pool.query
      .mockResolvedValueOnce(rows([{ fuel: 500, km: 99800, last_arr: '2026-06-25T10:00:00Z' }]))
      .mockRejectedValueOnce(new Error('relation "gps_month_end_snapshots" does not exist'));
    const res = await call('getLastVehicleReadings', ['B123ABC']);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.km).toBe(99800);
    expect(res.body.result.fuel).toBe(500);
  });

  test('nem-authentikált / rossz szerep → ok:false', async () => {
    setUser(null);
    const res = await call('getLastVehicleReadings', ['B123']);
    expect(res.status).toBe(401);
  });

  test('üres rendszám → semmi lekérdezés, üres válasz', async () => {
    setUser(SOFER);
    const res = await call('getLastVehicleReadings', ['']);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.km).toBeNull();
    expect(res.body.result.fuel).toBeNull();
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('snapshot lekérdezés cégre + normalizált rendszámra szűrt', async () => {
    setUser(SOFER);
    pool.query
      .mockResolvedValueOnce(rows([{ fuel: null, km: null, last_arr: null }]))
      .mockResolvedValueOnce(rows([]));
    await call('getLastVehicleReadings', ['b 123-abc']);
    // A 2. hívás a snapshot-tábla — paraméterek: [company_id, normalizált plate]
    expect(pool.query.mock.calls[1][1][0]).toBe(CID);
    expect(pool.query.mock.calls[1][1][1]).toBe('B123ABC');
    const snapSql = String(pool.query.mock.calls[1][0]);
    expect(snapSql).toMatch(/gps_month_end_snapshots/);
    expect(snapSql).toMatch(/ORDER BY year DESC, month DESC/);
  });
});
