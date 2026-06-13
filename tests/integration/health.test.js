// ============================================================
//  routes/health — liveness/readiness végpontok (mockolt DB)
// ============================================================
jest.mock('../../db', () => require('../helpers/db-mock').pool);

const request = require('supertest');
const express = require('express');
const { reset, rows } = require('../helpers/db-mock');
const pool = require('../../db');

const app = express();
app.use(require('../../routes/health'));

beforeEach(() => reset());

describe('health-check', () => {
  test('GET /healthz → 200, status:up (DB-t nem kérdezi)', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.status).toBe('up');
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('GET /readyz DB elérhető → 200, db:up', async () => {
    pool.query.mockResolvedValueOnce(rows([{ ok: 1 }]));
    const res = await request(app).get('/readyz');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.db).toBe('up');
  });

  test('GET /readyz DB hiba → 503, db:down', async () => {
    pool.query.mockRejectedValueOnce(new Error('connection refused'));
    const res = await request(app).get('/readyz');
    expect(res.status).toBe(503);
    expect(res.body.ok).toBe(false);
    expect(res.body.db).toBe('down');
  });
});
