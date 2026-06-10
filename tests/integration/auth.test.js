// ============================================================
//  POST /api/login — auth route (mockolt DB)
// ============================================================
jest.mock('../../db', () => require('../helpers/db-mock').pool);

const express = require('supertest');
const bcrypt = require('bcrypt');
const app = require('express')();
const { pool, rows, reset } = require('../helpers/db-mock');

app.use(require('express').json());
app.use(require('../../routes/auth'));

beforeEach(() => reset());

describe('POST /api/login', () => {
  test('hiányzó email/jelszó → hibaüzenet', async () => {
    const res = await express(app).post('/api/login').send({});
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/kotelezo/i);
    // DB-t meg sem kérdezzük ilyenkor
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('ismeretlen email → "Hibas email vagy jelszo"', async () => {
    pool.query.mockResolvedValueOnce(rows([])); // users SELECT → 0 sor
    const res = await express(app).post('/api/login').send({ email: 'nincs@ceg.hu', password: 'akarmi' });
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/Hibas email vagy jelszo/i);
  });

  test('rossz jelszó → "Hibas email vagy jelszo"', async () => {
    const hash = bcrypt.hashSync('helyes-jelszo', 10);
    pool.query.mockResolvedValueOnce(rows([{
      id: 1, nume: 'X', email: 'a@b.hu', tel: '', pozicio: 'Sofer',
      password_hash: hash, company_id: 1, pozicio_dev: false,
      totp_secret: null, totp_enabled: false,
    }]));
    const res = await express(app).post('/api/login').send({ email: 'a@b.hu', password: 'rossz-jelszo' });
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/Hibas email vagy jelszo/i);
  });
});
