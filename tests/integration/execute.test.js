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
    expect(res.body.result.err).toMatch(/necunoscut/i);
  });

  // A regisztráció meghívókóddal NEM igényelhet bejelentkezést — a
  // register.html a /api/execute-on hívja az authRegister-t (publikus
  // whitelist); a requireLogin korábban 401-gyel blokkolta.
  test('authRegister bejelentkezés nélkül is hívható (publikus)', async () => {
    setUser(null);
    const { rows } = require('../helpers/db-mock');
    const pool = require('../../db');
    pool.query
      // invite lekérés a kód alapján
      .mockResolvedValueOnce(rows([{ id: 1, pozicio: 'Sofer', email: null, status: 'Aktiv', company_id: 7 }]))
      // létező user ellenőrzés — nincs ilyen email
      .mockResolvedValueOnce(rows([]))
      // user INSERT
      .mockResolvedValueOnce(rows([]))
      // invite státusz UPDATE
      .mockResolvedValueOnce(rows([]));
    const res = await request(app).post('/api/execute').send({
      functionName: 'authRegister',
      arguments: [{ nume: 'Teszt Elek', email: 'teszt@pelda.hu', tel: '', jelszo: 'Titok123_', kod: 'VS-ABC123' }]
    });
    expect(res.status).toBe(200);
    expect(res.body.result.ok).toBe(true);
  });

  test('authRegister visszavont kóddal → hiba', async () => {
    setUser(null);
    const { rows } = require('../helpers/db-mock');
    const pool = require('../../db');
    pool.query.mockResolvedValueOnce(rows([{ id: 2, pozicio: 'Sofer', email: null, status: 'Visszavonva', company_id: 7 }]));
    const res = await request(app).post('/api/execute').send({
      functionName: 'authRegister',
      arguments: [{ nume: 'Teszt Elek', email: 'teszt2@pelda.hu', tel: '', jelszo: 'Titok123_', kod: 'VS-DEAD01' }]
    });
    expect(res.status).toBe(200);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/retras/i);
  });
});
