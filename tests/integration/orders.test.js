// ============================================================
//  Fuvar-handlerek a /api/execute-on át (mockolt DB).
//  Regressziós őr a 2026-06-13 javításokra:
//   - comUpdate státusz-whitelist + auto-léptetés + email-normalizálás
//   - getMySoferOrders cég/email szűrés + Parkolt/Raktarban láthatóság
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
app.use(require('../../routes/execute'));

function exec(fn, args) {
  return request(app).post('/api/execute').send({ functionName: fn, arguments: args || [] });
}

beforeEach(() => reset());

describe('comUpdate (fuvar szerkesztés)', () => {
  test('Sofőr nem módosíthat → ok:false, DB-t nem hívja', async () => {
    setUser(fixtures.sofer);
    const res = await exec('comUpdate', ['CMD-1', { client: 'X' }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/interzis|jogosult/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('érvénytelen státusz → ok:false (Status invalid), DB-t nem hívja', async () => {
    setUser(fixtures.admin);
    const res = await exec('comUpdate', ['CMD-1', { status: 'Nincs ilyen' }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/invalid/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('belső sofőr hozzárendelése Disponibil-ról → státusz Alocat-ra lép + email kisbetűs', async () => {
    setUser(fixtures.admin);
    pool.query.mockResolvedValue(rows([]));                       // default (pl. raktár-feloldás)
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });  // 1. = fő UPDATE
    const res = await exec('comUpdate', ['CMD-1', {
      status: 'Disponibil', sofer_type: 'Intern', email_sofer: 'Sofor@CEG.HU',
    }]);
    expect(res.body.result.ok).toBe(true);
    const values = pool.query.mock.calls[0][1];                  // a fő UPDATE értékei
    expect(values).toContain('Alocat');                          // Disponibil → Alocat auto-léptetés
    expect(values).toContain('sofor@ceg.hu');                    // trim+lowercase
    expect(values).not.toContain('Disponibil');
    expect(values).not.toContain('Sofor@CEG.HU');
  });

  test('Extern hozzárendelés Disponibil-ról → státusz Extern-re lép', async () => {
    setUser(fixtures.admin);
    pool.query.mockResolvedValue(rows([]));
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const res = await exec('comUpdate', ['CMD-1', { status: 'Disponibil', sofer_type: 'Extern' }]);
    expect(res.body.result.ok).toBe(true);
    expect(pool.query.mock.calls[0][1]).toContain('Extern');
  });

  test('nem talált fuvar (rowCount 0) → ok:false', async () => {
    setUser(fixtures.manager);
    pool.query.mockResolvedValue(rows([]));
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await exec('comUpdate', ['CMD-X', { client: 'Y' }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/gasit|talal|not/i);
  });
});

describe('getMySoferOrders (sofőr fuvarjai)', () => {
  test('a saját cég + email szerint szűr, és a Parkolt/Raktarban is a láthatóságban van', async () => {
    setUser(fixtures.sofer);
    pool.query.mockResolvedValueOnce(rows([{ id: 'CMD-1', status: 'Alocat' }]));
    const res = await exec('getMySoferOrders', []);
    expect(Array.isArray(res.body.result)).toBe(true);
    expect(res.body.result.length).toBe(1);
    const [sql, params] = pool.query.mock.calls[0];
    expect(params).toEqual([fixtures.sofer.company_id, fixtures.sofer.email]);
    expect(sql).toMatch(/company_id\s*=\s*\$1/i);
    expect(sql).toMatch(/email_sofer/i);
    expect(sql).toMatch(/Parkolt/);     // regresszió-őr: ne tűnjön el a leadott fuvar
    expect(sql).toMatch(/Raktarban/);
  });

  test('bejelentkezés nélkül üres lista', async () => {
    setUser(null);
    // requireLogin a /api/execute-on 401-et ad — getMySoferOrders nem publikus
    const res = await exec('getMySoferOrders', []);
    expect(res.status).toBe(401);
  });
});
