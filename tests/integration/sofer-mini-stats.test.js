// ============================================================
//  getMySoferStats — sofőr havi mini-statisztika + előző havi
//
//  A handler kettős FILTER-el egyetlen SELECT-ben adja vissza a
//  jelen ÉS az előző havi értékeket. Ellenőrizzük:
//   • szerep-kapu (csak Sofer),
//   • cég- + email-alapú horgony (LOWER),
//   • a válasz minden mezőt tartalmaz: lezart/lezart_prev, km/km_prev,
//     diurna_ext/_prev, diurna_int/_prev, tankolt_l/_prev.
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
const ADMIN = { ...fixtures.admin, company_id: CID };

beforeEach(() => reset());

describe('getMySoferStats — prev-month bővítés', () => {
  test('nem-sofőr elutasítva', async () => {
    setUser(ADMIN);
    const res = await call('getMySoferStats', []);
    expect(res.body.result.ok).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('sofőr: jelen és előző havi mezők visszaadva', async () => {
    setUser(SOFER);
    pool.query
      .mockResolvedValueOnce(rows([{ lezart: 7, lezart_prev: 12, aktiv: 2 }]))
      .mockResolvedValueOnce(rows([{
        menetlevelek: 5,
        km: '4200', km_prev: '3600',
        diurna_ext: 350, diurna_ext_prev: 420,
        diurna_int: 80,  diurna_int_prev: 60,
        tankolt_l: '1200', tankolt_l_prev: '980'
      }]));
    const res = await call('getMySoferStats', []);
    expect(res.body.result.ok).toBe(true);
    // jelen havi
    expect(res.body.result.lezart).toBe(7);
    expect(res.body.result.aktiv).toBe(2);
    expect(res.body.result.km).toBe('4200');
    expect(res.body.result.diurna_ext).toBe(350);
    expect(res.body.result.diurna_int).toBe(80);
    expect(res.body.result.tankolt_l).toBe('1200');
    // előző havi (*_prev)
    expect(res.body.result.lezart_prev).toBe(12);
    expect(res.body.result.km_prev).toBe('3600');
    expect(res.body.result.diurna_ext_prev).toBe(420);
    expect(res.body.result.diurna_int_prev).toBe(60);
    expect(res.body.result.tankolt_l_prev).toBe('980');
  });

  test('paraméterek: cég + saját email (lowercase)', async () => {
    setUser({ ...SOFER, email: 'JANI@CEG.HU' });
    pool.query
      .mockResolvedValueOnce(rows([{ lezart: 0, lezart_prev: 0, aktiv: 0 }]))
      .mockResolvedValueOnce(rows([{
        menetlevelek: 0, km: 0, km_prev: 0,
        diurna_ext: 0, diurna_ext_prev: 0,
        diurna_int: 0, diurna_int_prev: 0,
        tankolt_l: 0, tankolt_l_prev: 0
      }]));
    await call('getMySoferStats', []);
    // 1. lekérdezés: orders — [company_id, email]; a handler LOWER($2)-t hív
    // SQL-ben, a JS oldalon a nyers e-mailt továbbítja (a normalizálás DB-ben).
    expect(pool.query.mock.calls[0][1]).toEqual([CID, 'JANI@CEG.HU']);
    // 2. lekérdezés: fuvarlevelek — [email]
    expect(pool.query.mock.calls[1][1]).toEqual(['JANI@CEG.HU']);
    // A menetlevél-lekérdezés SQL-je BE tartalmazza a prev hónap horgonyt.
    const fuvSql = String(pool.query.mock.calls[1][0]);
    expect(fuvSql).toMatch(/km_prev/);
    expect(fuvSql).toMatch(/tankolt_l_prev/);
    expect(fuvSql).toMatch(/NOW\(\)\s*-\s*INTERVAL\s+'1 month'/);
  });

  test('nulla prev értékek is kiírásra kerülnek (nem törli a mezőt)', async () => {
    setUser(SOFER);
    pool.query
      .mockResolvedValueOnce(rows([{ lezart: 5, lezart_prev: 0, aktiv: 1 }]))
      .mockResolvedValueOnce(rows([{
        menetlevelek: 2, km: 100, km_prev: 0,
        diurna_ext: 50, diurna_ext_prev: 0,
        diurna_int: 10, diurna_int_prev: 0,
        tankolt_l: 40, tankolt_l_prev: 0
      }]));
    const res = await call('getMySoferStats', []);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.lezart_prev).toBe(0);
    expect(res.body.result.km_prev).toBe(0);
    expect(res.body.result.diurna_ext_prev).toBe(0);
    expect(res.body.result.diurna_int_prev).toBe(0);
    expect(res.body.result.tankolt_l_prev).toBe(0);
  });
});
