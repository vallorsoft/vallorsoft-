// ============================================================
//  POST /api/execute — generikus RPC dispatcher (mockolt DB)
// ============================================================
jest.mock('../../db', () => require('../helpers/db-mock').pool);

const request = require('supertest');
const express = require('express');
const { reset } = require('../helpers/db-mock');
const { setUser, sessionMiddleware, fixtures } = require('../helpers/session-mock');

const app = express();
app.use(express.json());
app.use(sessionMiddleware);
app.use(require('../../routes/execute'));

beforeEach(() => reset());

describe('POST /api/execute', () => {
  test('bejelentkezés nélkül → 401', async () => {
    setUser(null);
    const res = await request(app).post('/api/execute').send({ functionName: 'akarmi' });
    expect(res.status).toBe(401);
  });

  test('ismeretlen functionName → { result: { ok:false } }', async () => {
    setUser(fixtures.admin);
    const res = await request(app).post('/api/execute').send({ functionName: 'nincsIlyenFunkcio' });
    expect(res.status).toBe(200);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/Ismeretlen funkcio/i);
  });
});
