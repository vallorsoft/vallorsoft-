// ============================================================
//  gpsDailyTrack — Napi GPS útvonal (breadcrumb) lekérdezés
//    listVehiclesWithTrack   — a cég 7 napos breadcrumb-bal rendelkező
//                              rendszámai (jármű-választóhoz)
//    getVehicleDailyTrack    — egy jármű adott napi pozíció-sorozata
//  Admin/Manager, company_id-szűrt. Migráció-toleráns (42P01).
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
const ADMIN = { ...fixtures.admin, company_id: CID };
const MANAGER = { ...fixtures.manager, company_id: CID };
const SOFER = { ...fixtures.sofer, company_id: CID };

beforeEach(() => reset());

// ═══ listVehiclesWithTrack ═══════════════════════════════════
describe('listVehiclesWithTrack', () => {
  test('Sofer nem éri el', async () => {
    setUser(SOFER);
    const res = await call('listVehiclesWithTrack', []);
    expect(res.body.result.ok).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('Manager elérheti', async () => {
    setUser(MANAGER);
    pool.query.mockResolvedValueOnce(rows([
      { rendszam: 'B104VLR', points_7d: 42, last_at: '2026-09-11T05:00:00Z', marca: 'Mercedes', model: 'Actros' },
    ]));
    const res = await call('listVehiclesWithTrack', []);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.vehicles).toHaveLength(1);
    expect(res.body.result.vehicles[0].rendszam).toBe('B104VLR');
  });

  test('company_id-szűrt lekérdezés', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([]));
    await call('listVehiclesWithTrack', []);
    const [sql, params] = pool.query.mock.calls[0];
    expect(String(sql)).toMatch(/WHERE g\.company_id = \$1/);
    expect(params).toEqual([CID]);
  });

  test('7 napos ablak a lekérdezésben', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([]));
    await call('listVehiclesWithTrack', []);
    const [sql] = pool.query.mock.calls[0];
    expect(String(sql)).toMatch(/INTERVAL '7 days'/);
  });

  test('üres eredmény → üres tömb (nem hiba)', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([]));
    const res = await call('listVehiclesWithTrack', []);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.vehicles).toEqual([]);
  });

  test('migráció-hiány (42P01) → csendes üres lista, migration_pending jelző', async () => {
    setUser(ADMIN);
    const err = new Error('relation "gps_daily_positions" does not exist');
    err.code = '42P01';
    pool.query.mockRejectedValueOnce(err);
    const res = await call('listVehiclesWithTrack', []);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.vehicles).toEqual([]);
    expect(res.body.result.migration_pending).toBe(true);
  });

  test('egyéb DB-hiba → generikus szerver-hiba', async () => {
    setUser(ADMIN);
    pool.query.mockRejectedValueOnce(new Error('connection refused'));
    const res = await call('listVehiclesWithTrack', []);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toBe('Eroare de server');
  });
});

// ═══ getVehicleDailyTrack ════════════════════════════════════
describe('getVehicleDailyTrack', () => {
  test('Sofer nem éri el', async () => {
    setUser(SOFER);
    const res = await call('getVehicleDailyTrack', [{ rendszam: 'B104VLR', date: '2026-09-10' }]);
    expect(res.body.result.ok).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('hiányzó rendszám → hiba, nincs DB-hívás', async () => {
    setUser(ADMIN);
    const res = await call('getVehicleDailyTrack', [{ date: '2026-09-10' }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/Nr\. .nmatriculare lips/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('érvénytelen dátum-formátum → hiba, nincs DB-hívás', async () => {
    setUser(ADMIN);
    const res = await call('getVehicleDailyTrack', [{ rendszam: 'B104VLR', date: '2026/09/10' }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/Data invalid/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('hiányzó dátum → hiba', async () => {
    setUser(ADMIN);
    const res = await call('getVehicleDailyTrack', [{ rendszam: 'B104VLR' }]);
    expect(res.body.result.ok).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('sikeres lekérdezés — pontok időrendben', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([
      { lat: 46.77, lng: 23.59, speed_kmh: 62, ignition: true, recorded_at: '2026-09-10T06:00:00Z' },
      { lat: 46.80, lng: 23.65, speed_kmh: 58, ignition: true, recorded_at: '2026-09-10T06:10:00Z' },
    ]));
    const res = await call('getVehicleDailyTrack', [{ rendszam: 'B104VLR', date: '2026-09-10' }]);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.points).toHaveLength(2);
    expect(res.body.result.count).toBe(2);
  });

  test('company_id + rendszám + Europe/Bucharest napi ablak paraméterezve', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([]));
    await call('getVehicleDailyTrack', [{ rendszam: 'B104VLR', date: '2026-09-10' }]);
    const [sql, params] = pool.query.mock.calls[0];
    expect(String(sql)).toMatch(/WHERE company_id = \$1 AND rendszam = \$2/);
    expect(String(sql)).toMatch(/Europe\/Bucharest/);
    expect(params).toEqual([CID, 'B104VLR', '2026-09-10']);
  });

  test('max 500 pontos korlát a lekérdezésben (DoS-védelem)', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([]));
    await call('getVehicleDailyTrack', [{ rendszam: 'B104VLR', date: '2026-09-10' }]);
    const [sql] = pool.query.mock.calls[0];
    expect(String(sql)).toMatch(/LIMIT 500/);
  });

  test('nincs adat az adott napra → üres tömb', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([]));
    const res = await call('getVehicleDailyTrack', [{ rendszam: 'B104VLR', date: '2026-01-01' }]);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.points).toEqual([]);
    expect(res.body.result.count).toBe(0);
  });

  test('migráció-hiány (42P01) → csendes üres lista', async () => {
    setUser(ADMIN);
    const err = new Error('relation "gps_daily_positions" does not exist');
    err.code = '42P01';
    pool.query.mockRejectedValueOnce(err);
    const res = await call('getVehicleDailyTrack', [{ rendszam: 'B104VLR', date: '2026-09-10' }]);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.points).toEqual([]);
    expect(res.body.result.migration_pending).toBe(true);
  });

  test('Manager is elérheti', async () => {
    setUser(MANAGER);
    pool.query.mockResolvedValueOnce(rows([]));
    const res = await call('getVehicleDailyTrack', [{ rendszam: 'B104VLR', date: '2026-09-10' }]);
    expect(res.body.result.ok).toBe(true);
  });

  test('cross-tenant: más cég rendszáma nem szivárog (company_id a WHERE-ben)', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([{ lat: 1, lng: 1, speed_kmh: 0, ignition: null, recorded_at: '2026-09-10T00:00:00Z' }]));
    await call('getVehicleDailyTrack', [{ rendszam: 'IDEGEN', date: '2026-09-10' }]);
    const [, params] = pool.query.mock.calls[0];
    // A company_id MINDIG a session cégazonosítója, sose kliens-megadott
    expect(params[0]).toBe(CID);
  });
});
