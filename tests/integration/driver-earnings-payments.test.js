// ============================================================
//  driver_earnings + driver_payments — új kártyás sofőr-elszámolás
//  Kapuk: Sofer NEM éri el, Admin/Manager igen.
//  A járandóság totálja szerver-oldalon számolódik quantity × unit_amount
//  szerint (a klienstől kapott total-t nem hisszük el). A kifizetéskor a
//  BNR-árfolyam a fetchBnrEurRon-ból kerül a rekordba, és az amount_ron
//  is menti az azonos időpontos ekvivalensét. Multi-tenant kapu: a sofőr
//  a cégbe kell tartozzon (cross-tenant védelem).
// ============================================================
jest.mock('../../db', () => require('../helpers/db-mock').pool);
jest.mock('../../lib/audit', () => ({ record: jest.fn(), fromReq: jest.fn() }));
jest.mock('../../services/bnr', () => ({ fetchBnrEurRon: jest.fn() }));

const request = require('supertest');
const express = require('express');
const { reset, rows } = require('../helpers/db-mock');
const { setUser, sessionMiddleware, fixtures } = require('../helpers/session-mock');
const { fetchBnrEurRon } = require('../../services/bnr');

const app = express();
app.use(express.json());
app.use(sessionMiddleware);
app.use(require('../../routes/execute'));

beforeEach(() => { reset(); fetchBnrEurRon.mockReset(); });

// ═════════════════════════════════════════════
//  earningCreate
// ═════════════════════════════════════════════
describe('earningCreate', () => {
  test('Sofer → Acces interzis', async () => {
    setUser(fixtures.sofer);
    const res = await request(app).post('/api/execute').send({
      functionName: 'earningCreate',
      arguments: [{ email_sofer: 'x@ceg.hu', quantity: 1, unit_amount: 10 }],
    });
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/interzis/i);
  });

  test('üres email → hibaüzenet', async () => {
    setUser(fixtures.admin);
    const res = await request(app).post('/api/execute').send({
      functionName: 'earningCreate',
      arguments: [{ quantity: 1, unit_amount: 10 }],
    });
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/Selecteaza/i);
  });

  test('cross-tenant: idegen sofőr → 0 sor, elutasítás', async () => {
    setUser(fixtures.admin);
    const pool = require('../../db');
    pool.query.mockResolvedValueOnce(rows([])); // users lekérdezés üres
    const res = await request(app).post('/api/execute').send({
      functionName: 'earningCreate',
      arguments: [{ email_sofer: 'kulso@masikceg.hu', quantity: 1, unit_amount: 100 }],
    });
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/nu a fost gasit/i);
    // Ellenőrzés: a user-lekérdezés company_id-szűrt
    const sql = pool.query.mock.calls[0][0];
    const params = pool.query.mock.calls[0][1];
    expect(sql).toMatch(/FROM users/i);
    expect(sql).toMatch(/company_id=\$2/i);
    expect(params[1]).toBe(fixtures.admin.company_id);
  });

  test('érvénytelen quantity/unit → hiba', async () => {
    setUser(fixtures.admin);
    const pool = require('../../db');
    pool.query.mockResolvedValueOnce(rows([{ ok: 1 }])); // sofőr létezik
    const res = await request(app).post('/api/execute').send({
      functionName: 'earningCreate',
      arguments: [{ email_sofer: 'sofer@ceg.hu', quantity: 0, unit_amount: 10 }],
    });
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/Cantitate/i);
  });

  test('sikeres felvitel: total szerver-oldalon számolódik (qty × unit); ismeretlen kind → other', async () => {
    setUser(fixtures.admin);
    const pool = require('../../db');
    pool.query
      .mockResolvedValueOnce(rows([{ ok: 1 }]))          // sofőr létezik
      .mockResolvedValueOnce(rows([{ id: 77 }]));        // INSERT
    const res = await request(app).post('/api/execute').send({
      functionName: 'earningCreate',
      arguments: [{
        email_sofer: 'sofer@ceg.hu',
        earning_date: '2026-01-05',
        kind: 'hackerkind',                  // ismeretlen → othert kap
        label: '6 nap diurna DE-i fuvarra',
        quantity: 6, unit_amount: 70,        // 6 × 70 = 420
        currency: 'EUR',
        note: 'peldakent',
      }],
    });
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.id).toBe(77);
    expect(res.body.result.total).toBe(420);
    expect(res.body.result.currency).toBe('EUR');

    const insertSql = pool.query.mock.calls[1][0];
    const insertParams = pool.query.mock.calls[1][1];
    expect(insertSql).toMatch(/INSERT INTO driver_earnings/i);
    // Rendezés: company_id, email, date, kind, label, qty, unit, total, currency, note, created_by
    expect(insertParams[0]).toBe(fixtures.admin.company_id);
    expect(insertParams[3]).toBe('other');   // ismeretlen kind → other
    expect(insertParams[5]).toBe(6);          // quantity
    expect(insertParams[6]).toBe(70);         // unit
    expect(insertParams[7]).toBe(420);        // TOTAL a szervertől
    expect(insertParams[8]).toBe('EUR');
    expect(insertParams[10]).toBe(fixtures.admin.email);
  });
});

// ═════════════════════════════════════════════
//  paymentCreate
// ═════════════════════════════════════════════
describe('paymentCreate', () => {
  test('Manager mehet, Sofer nem', async () => {
    setUser(fixtures.sofer);
    const res = await request(app).post('/api/execute').send({
      functionName: 'paymentCreate',
      arguments: [{ email_sofer: 'x@ceg.hu', amount: 100, currency: 'EUR' }],
    });
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/interzis/i);
  });

  test('BNR-árfolyam mentődik + EUR → RON konverzió az amount_ron-ba', async () => {
    setUser(fixtures.admin);
    fetchBnrEurRon.mockResolvedValueOnce(5.0567);
    const pool = require('../../db');
    pool.query
      .mockResolvedValueOnce(rows([{ ok: 1 }]))       // sofőr létezik
      .mockResolvedValueOnce(rows([{ id: 9 }]));      // INSERT
    const res = await request(app).post('/api/execute').send({
      functionName: 'paymentCreate',
      arguments: [{
        email_sofer: 'sofer@ceg.hu',
        paid_at: '2026-09-01',
        amount: 100, currency: 'eur',   // kisbetűs → normalizálva EUR
        method: 'cash',
      }],
    });
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.bnr_rate).toBe(5.0567);
    expect(res.body.result.amount_ron).toBe(505.67);   // 100 × 5.0567 = 505.67

    const insertSql = pool.query.mock.calls[1][0];
    const insertParams = pool.query.mock.calls[1][1];
    expect(insertSql).toMatch(/INSERT INTO driver_payments/i);
    // company_id, email, paid_at, amount, currency, bnr_rate, amount_ron, method, note, created_by
    expect(insertParams[3]).toBe(100);
    expect(insertParams[4]).toBe('EUR');
    expect(insertParams[5]).toBe(5.0567);
    expect(insertParams[6]).toBe(505.67);
    expect(insertParams[7]).toBe('cash');
  });

  test('RON kifizetés: amount_ron = amount (BNR nélkül is menti)', async () => {
    setUser(fixtures.admin);
    fetchBnrEurRon.mockResolvedValueOnce(null); // BNR nem elérhető
    const pool = require('../../db');
    pool.query
      .mockResolvedValueOnce(rows([{ ok: 1 }]))       // sofőr létezik
      .mockResolvedValueOnce(rows([{ id: 10 }]));     // INSERT
    const res = await request(app).post('/api/execute').send({
      functionName: 'paymentCreate',
      arguments: [{
        email_sofer: 'sofer@ceg.hu',
        amount: 1234.56, currency: 'RON', method: 'bank',
      }],
    });
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.bnr_rate).toBe(null);
    expect(res.body.result.amount_ron).toBe(1234.56);
  });

  test('ismeretlen method → cash-re esik vissza (fehérlista)', async () => {
    setUser(fixtures.admin);
    fetchBnrEurRon.mockResolvedValueOnce(5.05);
    const pool = require('../../db');
    pool.query
      .mockResolvedValueOnce(rows([{ ok: 1 }]))
      .mockResolvedValueOnce(rows([{ id: 11 }]));
    const res = await request(app).post('/api/execute').send({
      functionName: 'paymentCreate',
      arguments: [{
        email_sofer: 'sofer@ceg.hu',
        amount: 50, currency: 'EUR', method: 'HACKED',
      }],
    });
    expect(res.body.result.ok).toBe(true);
    const insertParams = pool.query.mock.calls[1][1];
    expect(insertParams[7]).toBe('cash');
  });
});

// ═════════════════════════════════════════════
//  getDriverBalance
// ═════════════════════════════════════════════
describe('getDriverBalance', () => {
  test('Sofer NEM éri el', async () => {
    setUser(fixtures.sofer);
    const res = await request(app).post('/api/execute').send({
      functionName: 'getDriverBalance',
      arguments: [{ email: 'sofer@ceg.hu' }],
    });
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/interzis/i);
  });

  test('EUR járandóság + részleges EUR kifizetés = hátralék EUR-ban', async () => {
    setUser(fixtures.admin);
    fetchBnrEurRon.mockResolvedValueOnce(5.05);
    const pool = require('../../db');
    // 1) sofőr létezik (nume)
    // 2) earnings valuta-bontás
    // 3) payments valuta-bontás
    pool.query
      .mockResolvedValueOnce(rows([{ nume: 'Peto' }]))
      .mockResolvedValueOnce(rows([
        { currency: 'EUR', total: 500, db: 5 },
        { currency: 'RON', total: 0, db: 0 },
      ]))
      .mockResolvedValueOnce(rows([
        { currency: 'EUR', total: 200, total_ron: 1010, db: 1 },
      ]));
    const res = await request(app).post('/api/execute').send({
      functionName: 'getDriverBalance',
      arguments: [{ email: 'sofer@ceg.hu' }],
    });
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.earned.eur).toBe(500);
    expect(res.body.result.paid.eur).toBe(200);
    expect(res.body.result.balance.eur).toBe(300);
    expect(res.body.result.balance.ron).toBe(0);
    // Kombinált RON = 300 EUR × 5.05 + 0 RON = 1515
    expect(res.body.result.balance.ron_all).toBe(1515);
    expect(res.body.result.bnr_rate).toBe(5.05);
  });
});

// ═════════════════════════════════════════════
//  List + Delete (multi-tenant védelem)
// ═════════════════════════════════════════════
describe('list & delete cross-tenant', () => {
  test('earningList: company_id-szűrt WHERE', async () => {
    setUser(fixtures.admin);
    const pool = require('../../db');
    pool.query.mockResolvedValueOnce(rows([]));
    await request(app).post('/api/execute').send({
      functionName: 'earningList',
      arguments: [{ email: 'sofer@ceg.hu', from: '2026-01-01', to: '2026-12-31' }],
    });
    const sql = pool.query.mock.calls[0][0];
    const params = pool.query.mock.calls[0][1];
    expect(sql).toMatch(/FROM driver_earnings/i);
    expect(sql).toMatch(/company_id = \$1/i);
    expect(params[0]).toBe(fixtures.admin.company_id);
  });

  test('paymentDelete: idegen id → 0 sor → hiba', async () => {
    setUser(fixtures.admin);
    const pool = require('../../db');
    pool.query.mockResolvedValueOnce({ rowCount: 0 });
    const res = await request(app).post('/api/execute').send({
      functionName: 'paymentDelete',
      arguments: [{ id: 999 }],
    });
    expect(res.body.result.ok).toBe(false);
    const sql = pool.query.mock.calls[0][0];
    const params = pool.query.mock.calls[0][1];
    expect(sql).toMatch(/DELETE FROM driver_payments/i);
    expect(sql).toMatch(/company_id=\$2/i);
    expect(params[1]).toBe(fixtures.admin.company_id);
  });
});
