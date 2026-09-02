// ============================================================
//  Havi elszámolás-lap (getMonthlySettlementSheet + sendSettlementSheetEmail)
//  Kapuk: Sofer NEM éri el, Admin/Manager igen; company_id-szűrt;
//  a sofőr a cégbe kell tartozzon (cross-tenant védelem). Az e-mail
//  a KÖZÖS VallorSoft feladóról megy (services/email.sendClientEmail).
// ============================================================
jest.mock('../../db', () => require('../helpers/db-mock').pool);
jest.mock('../../lib/audit', () => ({ record: jest.fn(), fromReq: jest.fn() }));
jest.mock('../../services/bnr', () => ({ fetchBnrEurRon: jest.fn() }));
jest.mock('../../services/email', () => ({
  sendClientEmail: jest.fn(),
  // más helper-eket sem használjuk itt, de a modult a handler require-eli
}));

const request = require('supertest');
const express = require('express');
const { reset, rows } = require('../helpers/db-mock');
const { setUser, sessionMiddleware, fixtures } = require('../helpers/session-mock');
const { fetchBnrEurRon } = require('../../services/bnr');
const email = require('../../services/email');

const app = express();
app.use(express.json());
app.use(sessionMiddleware);
app.use(require('../../routes/execute'));

beforeEach(() => { reset(); fetchBnrEurRon.mockReset(); email.sendClientEmail.mockReset(); });

// ═════════════════════════════════════════════
//  getMonthlySettlementSheet
// ═════════════════════════════════════════════
describe('getMonthlySettlementSheet', () => {
  test('Sofer → Acces interzis', async () => {
    setUser(fixtures.sofer);
    const res = await request(app).post('/api/execute').send({
      functionName: 'getMonthlySettlementSheet',
      arguments: [{ email: 'x@ceg.hu', year: 2026, month: 8 }],
    });
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/interzis/i);
  });

  test('érvénytelen év / hónap → hiba', async () => {
    setUser(fixtures.admin);
    const bad = await request(app).post('/api/execute').send({
      functionName: 'getMonthlySettlementSheet',
      arguments: [{ email: 'sofer@ceg.hu', year: 1999, month: 8 }],
    });
    expect(bad.body.result.ok).toBe(false);
    expect(bad.body.result.err).toMatch(/An/i);

    const bad2 = await request(app).post('/api/execute').send({
      functionName: 'getMonthlySettlementSheet',
      arguments: [{ email: 'sofer@ceg.hu', year: 2026, month: 13 }],
    });
    expect(bad2.body.result.ok).toBe(false);
    expect(bad2.body.result.err).toMatch(/Lună/i);
  });

  test('cross-tenant: idegen sofőr → 0 sor, elutasítás', async () => {
    setUser(fixtures.admin);
    const pool = require('../../db');
    pool.query.mockResolvedValueOnce(rows([])); // users lekérdezés üres
    const res = await request(app).post('/api/execute').send({
      functionName: 'getMonthlySettlementSheet',
      arguments: [{ email: 'kulso@masikceg.hu', year: 2026, month: 8 }],
    });
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/nu a fost gasit/i);
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toMatch(/FROM users/i);
    expect(sql).toMatch(/company_id=\$2/i);
    expect(pool.query.mock.calls[0][1][1]).toBe(fixtures.admin.company_id);
  });

  test('sikeres válasz: időszak határai, összesítés valuta szerint, kombinált RON', async () => {
    setUser(fixtures.admin);
    fetchBnrEurRon.mockResolvedValueOnce(5.05);
    const pool = require('../../db');
    pool.query
      .mockResolvedValueOnce(rows([{ email: 'sofer@ceg.hu', nume: 'Peto', tel: '+40700111222' }])) // users
      .mockResolvedValueOnce(rows([{ nev: 'CegKft', cui: 'RO1', adresa: 'Str', telefon: '111', email_contact: 'a@b.ro' }])) // companies
      .mockResolvedValueOnce(rows([                                                                        // earnings
        { id: 1, earning_date: '2026-08-05', kind: 'bonus',   label: 'x', quantity: 1, unit_amount: 500, total_amount: 500, currency: 'EUR', note: null },
        { id: 2, earning_date: '2026-08-12', kind: 'diurna',  label: 'y', quantity: 6, unit_amount: 70,  total_amount: 420, currency: 'RON', note: null },
      ]))
      .mockResolvedValueOnce(rows([                                                                        // payments
        { id: 10, paid_at: '2026-08-20', method: 'cash', amount: 200, currency: 'EUR', bnr_rate: 5.05, amount_ron: 1010, note: null },
      ]));
    const res = await request(app).post('/api/execute').send({
      functionName: 'getMonthlySettlementSheet',
      arguments: [{ email: 'sofer@ceg.hu', year: 2026, month: 8 }],
    });
    expect(res.body.result.ok).toBe(true);
    // Időszak: 08. első és utolsó napja
    expect(res.body.result.period.from).toBe('2026-08-01');
    expect(res.body.result.period.to).toBe('2026-08-31');
    // Sofőr adatok
    expect(res.body.result.driver.nume).toBe('Peto');
    expect(res.body.result.driver.tel).toBe('+40700111222');
    // Cég
    expect(res.body.result.company.nev).toBe('CegKft');
    // Összesítés
    expect(res.body.result.totals.earned.eur).toBe(500);
    expect(res.body.result.totals.earned.ron).toBe(420);
    expect(res.body.result.totals.paid.eur).toBe(200);
    expect(res.body.result.totals.balance.eur).toBe(300);   // 500 − 200
    expect(res.body.result.totals.balance.ron).toBe(420);   // 420 − 0
    // Kombinált RON = 300 × 5.05 + 420 = 1935
    expect(res.body.result.totals.balance.ron_all).toBe(1935);
    expect(res.body.result.totals.bnr_rate).toBe(5.05);
    // Az earnings + payments query cégre szűrt
    const eSql = pool.query.mock.calls[2][0];
    const eParams = pool.query.mock.calls[2][1];
    expect(eSql).toMatch(/FROM driver_earnings/i);
    expect(eSql).toMatch(/company_id=\$1/i);
    expect(eParams[0]).toBe(fixtures.admin.company_id);
    expect(eParams[2]).toBe('2026-08-01');
    expect(eParams[3]).toBe('2026-08-31');
  });

  test('február utolsó napja szökőév-tudatos (2024-02-29)', async () => {
    setUser(fixtures.admin);
    fetchBnrEurRon.mockResolvedValueOnce(null);
    const pool = require('../../db');
    pool.query
      .mockResolvedValueOnce(rows([{ email: 'sofer@ceg.hu', nume: 'Peto', tel: null }]))
      .mockResolvedValueOnce(rows([{ nev: 'CegKft' }]))
      .mockResolvedValueOnce(rows([]))
      .mockResolvedValueOnce(rows([]));
    const res = await request(app).post('/api/execute').send({
      functionName: 'getMonthlySettlementSheet',
      arguments: [{ email: 'sofer@ceg.hu', year: 2024, month: 2 }],
    });
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.period.to).toBe('2024-02-29');
  });
});

// ═════════════════════════════════════════════
//  sendSettlementSheetEmail
// ═════════════════════════════════════════════
describe('sendSettlementSheetEmail', () => {
  test('Sofer → Acces interzis', async () => {
    setUser(fixtures.sofer);
    const res = await request(app).post('/api/execute').send({
      functionName: 'sendSettlementSheetEmail',
      arguments: [{ to: 'x@ceg.hu', html: '<div>abc</div>'.repeat(5), subject: 't' }],
    });
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/interzis/i);
  });

  test('érvénytelen címzett → hiba, nem hív e-mailt', async () => {
    setUser(fixtures.admin);
    const res = await request(app).post('/api/execute').send({
      functionName: 'sendSettlementSheetEmail',
      arguments: [{ to: 'nem_email', html: 'X'.repeat(30), subject: 't' }],
    });
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/invalid/i);
    expect(email.sendClientEmail).not.toHaveBeenCalled();
  });

  test('túl rövid html → hiba', async () => {
    setUser(fixtures.admin);
    const res = await request(app).post('/api/execute').send({
      functionName: 'sendSettlementSheetEmail',
      arguments: [{ to: 'sofer@ceg.hu', html: 'x', subject: 't' }],
    });
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/lipsește|prea mare/i);
  });

  test('cross-tenant védelem: címzett nem a cég sofőrje → hiba', async () => {
    setUser(fixtures.admin);
    const pool = require('../../db');
    pool.query.mockResolvedValueOnce(rows([])); // users lookup: nincs találat
    const res = await request(app).post('/api/execute').send({
      functionName: 'sendSettlementSheetEmail',
      arguments: [{ to: 'kulso@masik.hu', html: 'X'.repeat(30), subject: 't' }],
    });
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/[șs]ofer al firmei/i);
    expect(email.sendClientEmail).not.toHaveBeenCalled();
  });

  test('sikeres küldés: sendClientEmail hívva a cégazonosítóval + settlement mail-típussal', async () => {
    setUser(fixtures.admin);
    const pool = require('../../db');
    pool.query.mockResolvedValueOnce(rows([{ ok: 1 }])); // sofőr a cégben
    email.sendClientEmail.mockResolvedValueOnce({ ok: true, messageId: 'mid-1' });
    const res = await request(app).post('/api/execute').send({
      functionName: 'sendSettlementSheetEmail',
      arguments: [{ to: 'SOFER@CEG.HU', html: '<div>html body</div>'.repeat(3), subject: 'Decont test' }],
    });
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.messageId).toBe('mid-1');
    expect(email.sendClientEmail).toHaveBeenCalledTimes(1);
    const arg = email.sendClientEmail.mock.calls[0][0];
    expect(arg.to).toBe('sofer@ceg.hu');        // lowercase-normalizálva
    expect(arg.subject).toBe('Decont test');
    expect(arg.companyId).toBe(fixtures.admin.company_id);
    expect(arg.mailType).toBe('settlement');
  });

  test('e-mail-küldés hibája → átadja a hibaüzenetet a kliensnek', async () => {
    setUser(fixtures.admin);
    const pool = require('../../db');
    pool.query.mockResolvedValueOnce(rows([{ ok: 1 }]));
    email.sendClientEmail.mockResolvedValueOnce({ ok: false, error: 'Brevo down' });
    const res = await request(app).post('/api/execute').send({
      functionName: 'sendSettlementSheetEmail',
      arguments: [{ to: 'sofer@ceg.hu', html: '<div>abc</div>'.repeat(3), subject: 't' }],
    });
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toBe('Brevo down');
  });
});
