// ============================================================
//  earningPaymentGroupCreate + Get/List/Delete
//  Csoportos kifizetés — több earning + több payment egy csoportban;
//  vegyes valuta (EUR + RON); a BNR-t szerver-oldal auto-tölti ha nincs
//  bnr_rate a payment sorban. Multi-tenant + cross-tenant védelem.
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

// ─────────────────────────────────────────────
//  earningPaymentGroupCreate — szerep + validáció
// ─────────────────────────────────────────────
describe('earningPaymentGroupCreate', () => {
  test('Sofer → Acces interzis', async () => {
    setUser(fixtures.sofer);
    const pool = require('../../db');
    const client = { query: jest.fn(), release: jest.fn() };
    pool.connect = jest.fn().mockResolvedValue(client);
    const res = await request(app).post('/api/execute').send({
      functionName: 'earningPaymentGroupCreate',
      arguments: [{ email_sofer: 'x@ceg.hu', earning_ids: [1], payments: [{ amount: 10, currency: 'RON' }] }],
    });
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/interzis/i);
    expect(client.release).toHaveBeenCalled();
  });

  test('üres email → hibaüzenet', async () => {
    setUser(fixtures.admin);
    const pool = require('../../db');
    const client = { query: jest.fn(), release: jest.fn() };
    pool.connect = jest.fn().mockResolvedValue(client);
    const res = await request(app).post('/api/execute').send({
      functionName: 'earningPaymentGroupCreate',
      arguments: [{ earning_ids: [1], payments: [{ amount: 10, currency: 'RON' }] }],
    });
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/Selecteaza un sofer/i);
    expect(client.release).toHaveBeenCalled();
  });

  test('üres earning_ids → hiba', async () => {
    setUser(fixtures.admin);
    const pool = require('../../db');
    const client = { query: jest.fn(), release: jest.fn() };
    pool.connect = jest.fn().mockResolvedValue(client);
    const res = await request(app).post('/api/execute').send({
      functionName: 'earningPaymentGroupCreate',
      arguments: [{ email_sofer: 'x@ceg.hu', earning_ids: [], payments: [{ amount: 10, currency: 'RON' }] }],
    });
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/cel putin un drept/i);
  });

  test('üres payments → hiba', async () => {
    setUser(fixtures.admin);
    const pool = require('../../db');
    const client = { query: jest.fn(), release: jest.fn() };
    pool.connect = jest.fn().mockResolvedValue(client);
    const res = await request(app).post('/api/execute').send({
      functionName: 'earningPaymentGroupCreate',
      arguments: [{ email_sofer: 'x@ceg.hu', earning_ids: [1], payments: [] }],
    });
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/cel putin o modalitate/i);
  });

  test('érvénytelen összeg → hiba', async () => {
    setUser(fixtures.admin);
    const pool = require('../../db');
    const client = { query: jest.fn(), release: jest.fn() };
    pool.connect = jest.fn().mockResolvedValue(client);
    const res = await request(app).post('/api/execute').send({
      functionName: 'earningPaymentGroupCreate',
      arguments: [{
        email_sofer: 'x@ceg.hu', earning_ids: [1],
        payments: [{ amount: 0, currency: 'RON' }],
      }],
    });
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/Suma invalida/i);
  });

  test('cross-tenant: idegen cég sofőre → elutasítva', async () => {
    setUser(fixtures.admin);   // company_id = 1
    const pool = require('../../db');
    const client = { query: jest.fn(), release: jest.fn() };
    pool.connect = jest.fn().mockResolvedValue(client);
    client.query.mockResolvedValueOnce(rows([])); // users SELECT üres → nem talált
    const res = await request(app).post('/api/execute').send({
      functionName: 'earningPaymentGroupCreate',
      arguments: [{
        email_sofer: 'idegen@masceg.hu', earning_ids: [1],
        payments: [{ amount: 100, currency: 'RON' }],
      }],
    });
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/nu a fost gasit/i);
    // A users SELECT company_id=$2-re szűrt
    const q0 = client.query.mock.calls[0];
    expect(q0[0]).toMatch(/company_id=\$2/i);
    expect(q0[1]).toEqual(['idegen@masceg.hu', 1]);
    expect(client.release).toHaveBeenCalled();
  });

  test('cross-tenant: earning nem tartozik a sofőrhöz → elutasítva', async () => {
    setUser(fixtures.admin);
    const pool = require('../../db');
    const client = { query: jest.fn(), release: jest.fn() };
    pool.connect = jest.fn().mockResolvedValue(client);
    client.query
      .mockResolvedValueOnce(rows([{ '?column?': 1 }]))   // sofőr létezik
      .mockResolvedValueOnce(rows([{ id: 5 }]));           // csak 1 earning talált a 2-ből
    const res = await request(app).post('/api/execute').send({
      functionName: 'earningPaymentGroupCreate',
      arguments: [{
        email_sofer: 'x@ceg.hu', earning_ids: [5, 999],
        payments: [{ amount: 100, currency: 'RON' }],
      }],
    });
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/nu apartin/i);
    // Az earnings SELECT company_id-szűrt
    const eSel = client.query.mock.calls[1];
    expect(eSel[0]).toMatch(/company_id\s*=\s*\$2/i);
  });

  test('sikeres létrehozás: 2 earning + 2 payment (EUR + RON), BNR auto-fetch', async () => {
    setUser(fixtures.admin);
    fetchBnrEurRon.mockResolvedValue(5.20);
    const pool = require('../../db');
    const client = { query: jest.fn(), release: jest.fn() };
    pool.connect = jest.fn().mockResolvedValue(client);
    client.query
      .mockResolvedValueOnce(rows([{ '?column?': 1 }]))       // 1) users SELECT
      .mockResolvedValueOnce(rows([{ id: 5 }, { id: 6 }]))    // 2) earnings SELECT
      .mockResolvedValueOnce(rows([]))                         // 3) conflict SELECT — 0 sor
      .mockResolvedValueOnce(rows([]))                         // 4) BEGIN
      .mockResolvedValueOnce(rows([{ id: 42 }]))              // 5) INSERT groups
      .mockResolvedValueOnce(rows([]))                         // 6) INSERT group_items #1
      .mockResolvedValueOnce(rows([]))                         // 7) INSERT group_items #2
      .mockResolvedValueOnce(rows([{ id: 101 }]))             // 8) INSERT payment #1
      .mockResolvedValueOnce(rows([{ id: 102 }]))             // 9) INSERT payment #2
      .mockResolvedValueOnce(rows([]));                        // 10) COMMIT

    const res = await request(app).post('/api/execute').send({
      functionName: 'earningPaymentGroupCreate',
      arguments: [{
        email_sofer: 'x@ceg.hu',
        earning_ids: [5, 6, 5],       // duplikátum kiszűrve
        payments: [
          { amount: 1620, currency: 'EUR', method: 'bank', note: 'utalás' },
          { amount: 1900, currency: 'RON', method: 'cash' },
        ],
        paid_at: '2026-09-08',
        note: 'Csoportos szeptember',
      }],
    });
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.group_id).toBe(42);
    expect(res.body.result.payment_ids).toEqual([101, 102]);

    // BEGIN → INSERT groups → 2× INSERT items → 2× INSERT payments → COMMIT
    expect(client.query.mock.calls[3][0]).toBe('BEGIN');
    expect(client.query.mock.calls[4][0]).toMatch(/INSERT INTO driver_payment_groups/i);
    expect(client.query.mock.calls[5][0]).toMatch(/INSERT INTO driver_payment_group_items/i);
    expect(client.query.mock.calls[6][0]).toMatch(/INSERT INTO driver_payment_group_items/i);
    expect(client.query.mock.calls[7][0]).toMatch(/INSERT INTO driver_payments/i);
    // EUR fizetés amount_ron = 1620 × 5.20 = 8424
    expect(client.query.mock.calls[7][1]).toContain(8424);
    // RON fizetés amount_ron = 1900
    expect(client.query.mock.calls[8][1]).toContain(1900);
    expect(client.query.mock.calls[9][0]).toBe('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });

  test('migráció-hiány → diagnosztikus hibaüzenet + ROLLBACK', async () => {
    setUser(fixtures.admin);
    fetchBnrEurRon.mockResolvedValue(5.20);
    const pool = require('../../db');
    const client = { query: jest.fn(), release: jest.fn() };
    pool.connect = jest.fn().mockResolvedValue(client);
    client.query
      .mockResolvedValueOnce(rows([{ '?column?': 1 }]))       // users SELECT
      .mockResolvedValueOnce(rows([{ id: 5 }]))                // earnings SELECT
      .mockResolvedValueOnce(rows([]))                         // conflict SELECT üres
      .mockResolvedValueOnce(rows([]))                         // BEGIN
      .mockRejectedValueOnce(new Error('relation "driver_payment_groups" does not exist'))
      .mockResolvedValueOnce(rows([]));                        // ROLLBACK

    const res = await request(app).post('/api/execute').send({
      functionName: 'earningPaymentGroupCreate',
      arguments: [{
        email_sofer: 'x@ceg.hu', earning_ids: [5],
        payments: [{ amount: 100, currency: 'RON' }],
      }],
    });
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/Tabelele.*grup de plati lipsesc/i);
    expect(client.release).toHaveBeenCalled();
  });

  test('conflict: earning már másik csoportban → elutasítva', async () => {
    setUser(fixtures.admin);
    const pool = require('../../db');
    const client = { query: jest.fn(), release: jest.fn() };
    pool.connect = jest.fn().mockResolvedValue(client);
    client.query
      .mockResolvedValueOnce(rows([{ '?column?': 1 }]))       // users SELECT
      .mockResolvedValueOnce(rows([{ id: 5 }]))                // earnings SELECT
      .mockResolvedValueOnce(rows([{ earning_id: 5 }]));       // conflict SELECT — 1 sor
    const res = await request(app).post('/api/execute').send({
      functionName: 'earningPaymentGroupCreate',
      arguments: [{
        email_sofer: 'x@ceg.hu', earning_ids: [5],
        payments: [{ amount: 100, currency: 'RON' }],
      }],
    });
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/deja incluse/i);
    expect(client.release).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────
//  earningPaymentGroupGet — read
// ─────────────────────────────────────────────
describe('earningPaymentGroupGet', () => {
  test('Sofer → Acces interzis', async () => {
    setUser(fixtures.sofer);
    const res = await request(app).post('/api/execute').send({
      functionName: 'earningPaymentGroupGet', arguments: [{ id: 42 }],
    });
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/interzis/i);
  });

  test('ismeretlen csoport → hibaüzenet', async () => {
    setUser(fixtures.admin);
    const pool = require('../../db');
    pool.query.mockResolvedValueOnce(rows([]));
    const res = await request(app).post('/api/execute').send({
      functionName: 'earningPaymentGroupGet', arguments: [{ id: 999 }],
    });
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/gasit/i);
  });

  test('érvénytelen ID → hibaüzenet', async () => {
    setUser(fixtures.admin);
    const res = await request(app).post('/api/execute').send({
      functionName: 'earningPaymentGroupGet', arguments: [{ id: 'abc' }],
    });
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/ID invalid/i);
  });
});

// ─────────────────────────────────────────────
//  earningPaymentGroupDelete
// ─────────────────────────────────────────────
describe('earningPaymentGroupDelete', () => {
  test('Sofer → Acces interzis', async () => {
    setUser(fixtures.sofer);
    const res = await request(app).post('/api/execute').send({
      functionName: 'earningPaymentGroupDelete', arguments: [{ id: 42 }],
    });
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/interzis/i);
  });

  test('idegen cég csoportja → nem törli (rowCount=0)', async () => {
    setUser(fixtures.admin);
    const pool = require('../../db');
    pool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const res = await request(app).post('/api/execute').send({
      functionName: 'earningPaymentGroupDelete', arguments: [{ id: 42 }],
    });
    expect(res.body.result.ok).toBe(false);
  });
});
