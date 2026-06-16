// ============================================================
//  routes/ordersRest.js — quick-status (mockolt DB).
//  Regressziós őr a 2026-06-13 javításra: a lista státusz-dropdownja
//  Parkolt/Raktarban-t is kínál → a route-nak el kell fogadnia ezeket
//  (korábban „Status invalid"-ot dobott).
// ============================================================
jest.mock('../../db', () => require('../helpers/db-mock').pool);

const request = require('supertest');
const express = require('express');
const { reset, rows } = require('../helpers/db-mock');
const { setUser, sessionMiddleware, fixtures } = require('../helpers/session-mock');
const pool = require('../../db');

const app = express();
app.use(express.json());
app.use(sessionMiddleware);
app.use(require('../../routes/ordersRest'));

beforeEach(() => reset());

describe('POST /api/orders/:id/quick-status', () => {
  test('érvénytelen státusz → ok:false, DB-t nem hívja', async () => {
    setUser(fixtures.admin);
    const res = await request(app).post('/api/orders/CMD-1/quick-status').send({ status: 'Bla' });
    expect(res.body.ok).toBe(false);
    expect(res.body.err).toMatch(/invalid/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('Sofőr nem hívhatja → 403', async () => {
    setUser(fixtures.sofer);
    const res = await request(app).post('/api/orders/CMD-1/quick-status').send({ status: 'Alocat' });
    expect(res.status).toBe(403);
  });

  test('Raktarban most elfogadott státusz (regresszió) → ok:true', async () => {
    setUser(fixtures.manager);
    pool.query.mockResolvedValueOnce(rows([{ status: 'Alocat' }])); // Anulat-guard SELECT (nem anulált)
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });    // fő UPDATE (Raktarban → nincs raktár-feloldás)
    const res = await request(app).post('/api/orders/CMD-1/quick-status').send({ status: 'Raktarban' });
    expect(res.body.ok).toBe(true);
  });

  test('Disponibil → ok:true + Raktarban-feloldás fut (3. query)', async () => {
    setUser(fixtures.admin);
    pool.query.mockResolvedValue(rows([]));                         // raktár-feloldás default
    pool.query.mockResolvedValueOnce(rows([{ status: 'Alocat' }])); // Anulat-guard SELECT
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });    // fő UPDATE
    const res = await request(app).post('/api/orders/CMD-1/quick-status').send({ status: 'Disponibil' });
    expect(res.body.ok).toBe(true);
    expect(pool.query.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  test('anulált fuvar nem támasztható fel → ok:false', async () => {
    setUser(fixtures.admin);
    pool.query.mockResolvedValueOnce(rows([{ status: 'Anulat' }])); // guard SELECT → Anulat
    const res = await request(app).post('/api/orders/CMD-1/quick-status').send({ status: 'Alocat' });
    expect(res.body.ok).toBe(false);
    expect(res.body.err).toMatch(/anulat/i);
  });

  test('nem talált fuvar (rowCount 0) → ok:false', async () => {
    setUser(fixtures.admin);
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app).post('/api/orders/CMD-1/quick-status').send({ status: 'Alocat' });
    expect(res.body.ok).toBe(false);
  });
});
