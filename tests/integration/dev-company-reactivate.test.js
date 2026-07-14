// ============================================================
//  devCompanyUpdate — trial-lejaratos ceg reaktivalasa
//  Regi bug: a developer cegkartya "🔓 Activare" gombja csak a
//  subscription_status-t allitotta 'active'-ra, a paid_until a
//  multban maradt -> a login-kapu (routes/auth.js) tovabb tiltotta
//  a belepest ("Abonamentul firmei a expirat …").
//  Javitas: ha reaktivalasnal (status='active') nincs explicit
//  paid_until megadva es a jelenlegi mult vagy NULL, akkor
//  auto-hosszabbitas NOW() + 30 nap + subscription_cancel_at
//  torlese (napi cancel-scheduler ne allitsa vissza).
// ============================================================
jest.mock('../../db', () => require('../helpers/db-mock').pool);

const request = require('supertest');
const express = require('express');
const { reset, rows } = require('../helpers/db-mock');
const { setUser, sessionMiddleware } = require('../helpers/session-mock');

const app = express();
app.use(express.json());
app.use(sessionMiddleware);
app.use(require('../../routes/execute'));

const dev = { id: 1, email: 'dev@vallor.soft', nume: 'Dev', pozicio: 'Admin', company_id: null, is_dev: true };
const nonDev = { id: 2, email: 'admin@ceg.hu', nume: 'Admin', pozicio: 'Admin', company_id: 1, is_dev: false };

beforeEach(() => reset());

describe('devCompanyUpdate — reaktivalas trial-lejarat utan', () => {
  test('nem-developer → Acces interzis', async () => {
    setUser(nonDev);
    const res = await request(app).post('/api/execute').send({
      functionName: 'devCompanyUpdate',
      arguments: [7, { subscription_status: 'active' }],
    });
    expect(res.status).toBe(200);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/interzis/i);
  });

  test('reaktivalas mult paid_until-lal → auto-hosszabbitas + cancel_at torles', async () => {
    setUser(dev);
    const pool = require('../../db');
    // 1) SELECT paid_until, subscription_cancel_at — trial regen lejart, cancel-lel
    const past = new Date(Date.now() - 3 * 86400000).toISOString();
    const cancelAt = new Date(Date.now() - 5 * 86400000).toISOString();
    pool.query
      .mockResolvedValueOnce(rows([{ paid_until: past, subscription_cancel_at: cancelAt }]))
      // 2) UPDATE companies
      .mockResolvedValueOnce(rows([]));

    const res = await request(app).post('/api/execute').send({
      functionName: 'devCompanyUpdate',
      arguments: [7, { subscription_status: 'active' }],
    });
    expect(res.status).toBe(200);
    expect(res.body.result.ok).toBe(true);

    // Az UPDATE SQL tartalmazza az auto-hosszabbitast es a cancel_at torlest.
    const updateCall = pool.query.mock.calls[1];
    const sql = updateCall[0];
    expect(sql).toMatch(/subscription_status=\$1/);
    expect(sql).toMatch(/paid_until=NOW\(\) \+ INTERVAL '30 days'/);
    expect(sql).toMatch(/trial_email_sent=false/);
    expect(sql).toMatch(/subscription_cancel_at=NULL/);
    expect(sql).toMatch(/cancel_lastday_notified=false/);
    expect(updateCall[1]).toEqual(['active', 7]);
  });

  test('reaktivalas NULL paid_until-lal → auto-hosszabbitas + cancel_at MINDIG torles', async () => {
    setUser(dev);
    const pool = require('../../db');
    pool.query
      .mockResolvedValueOnce(rows([{ paid_until: null }]))
      .mockResolvedValueOnce(rows([]));

    const res = await request(app).post('/api/execute').send({
      functionName: 'devCompanyUpdate',
      arguments: [7, { subscription_status: 'active' }],
    });
    expect(res.body.result.ok).toBe(true);
    const sql = pool.query.mock.calls[1][0];
    expect(sql).toMatch(/paid_until=NOW\(\) \+ INTERVAL '30 days'/);
    // Reaktivalasnal a cancel-jelzot MINDIG toroljuk (idempotens) — igy a napi
    // cancel-scheduler nem allitja vissza 'cancelled'-re.
    expect(sql).toMatch(/subscription_cancel_at=NULL/);
    expect(sql).toMatch(/cancel_lastday_notified=false/);
  });

  // ── A TÉNYLEGES BUG: a szerkesztő modál (saveCeg) MINDIG küld paid_until-t,
  //    üres mezőnél explicit null-t. Régen ez kihagyta a reaktiválás-blokkot
  //    (a `paid_until === undefined` feltétel miatt), így a cancel-jelző bent
  //    maradt → a scheduler visszaállította 'cancelled'-re. ──
  test('modál-út: status=active + explicit null paid_until → +30 nap + cancel_at torles', async () => {
    setUser(dev);
    const pool = require('../../db');
    // Cancelled ceg, lejart paid_until, cancel-jelzovel.
    const past = new Date(Date.now() - 10 * 86400000).toISOString();
    pool.query
      .mockResolvedValueOnce(rows([{ paid_until: past }]))   // SELECT paid_until
      .mockResolvedValueOnce(rows([]));                       // UPDATE

    const res = await request(app).post('/api/execute').send({
      functionName: 'devCompanyUpdate',
      arguments: [7, { subscription_status: 'active', paid_until: null }],
    });
    expect(res.body.result.ok).toBe(true);
    const sql = pool.query.mock.calls[1][0];
    expect(sql).toMatch(/paid_until=NOW\(\) \+ INTERVAL '30 days'/);
    expect(sql).toMatch(/subscription_cancel_at=NULL/);
    expect(sql).toMatch(/cancel_lastday_notified=false/);
    // A paid_until nem placeholderként ($) megy — NOW()+30 literál.
    expect(pool.query.mock.calls[1][1]).toEqual(['active', 7]);
  });

  test('modál-út: status=active + explicit MULT paid_until → +30 nap (nem a multat allitja)', async () => {
    setUser(dev);
    const pool = require('../../db');
    pool.query
      .mockResolvedValueOnce(rows([{ paid_until: null }]))   // SELECT (provided mult, de biztos ami biztos)
      .mockResolvedValueOnce(rows([]));

    const pastDate = '2020-01-01';
    const res = await request(app).post('/api/execute').send({
      functionName: 'devCompanyUpdate',
      arguments: [7, { subscription_status: 'active', paid_until: pastDate }],
    });
    expect(res.body.result.ok).toBe(true);
    const sql = pool.query.mock.calls[1][0];
    expect(sql).toMatch(/paid_until=NOW\(\) \+ INTERVAL '30 days'/);
    expect(sql).not.toMatch(/paid_until=\$/);
    expect(sql).toMatch(/subscription_cancel_at=NULL/);
  });

  test('reaktivalas JOVOBELI paid_until-lal → NEM ir felul', async () => {
    setUser(dev);
    const pool = require('../../db');
    const future = new Date(Date.now() + 20 * 86400000).toISOString();
    pool.query
      .mockResolvedValueOnce(rows([{ paid_until: future, subscription_cancel_at: null }]))
      .mockResolvedValueOnce(rows([]));

    const res = await request(app).post('/api/execute').send({
      functionName: 'devCompanyUpdate',
      arguments: [7, { subscription_status: 'active' }],
    });
    expect(res.body.result.ok).toBe(true);
    const sql = pool.query.mock.calls[1][0];
    // Fizetett meg → NE nyuljunk hozza.
    expect(sql).not.toMatch(/paid_until=/);
    expect(sql).not.toMatch(/trial_email_sent/);
  });

  test('explicit paid_until megadva → auto-hosszabbitas kimarad', async () => {
    setUser(dev);
    const pool = require('../../db');
    // NINCS SELECT — a status+paid_until egyutt megy, a kod nem kerdez le.
    pool.query.mockResolvedValueOnce(rows([]));

    const res = await request(app).post('/api/execute').send({
      functionName: 'devCompanyUpdate',
      arguments: [7, { subscription_status: 'active', paid_until: '2027-01-01' }],
    });
    expect(res.body.result.ok).toBe(true);
    // Egyetlen SQL-hivas: az UPDATE. Nincs elozetes SELECT.
    expect(pool.query.mock.calls.length).toBe(1);
    const [sql, vals] = pool.query.mock.calls[0];
    expect(sql).toMatch(/paid_until=\$2/);
    expect(sql).not.toMatch(/paid_until=NOW/);
    expect(vals).toEqual(['active', '2027-01-01', 7]);
  });

  test('blokkolas (status=inactive) → NEM nyul paid_until-hoz', async () => {
    setUser(dev);
    const pool = require('../../db');
    pool.query.mockResolvedValueOnce(rows([]));

    const res = await request(app).post('/api/execute').send({
      functionName: 'devCompanyUpdate',
      arguments: [7, { subscription_status: 'inactive' }],
    });
    expect(res.body.result.ok).toBe(true);
    expect(pool.query.mock.calls.length).toBe(1);
    const sql = pool.query.mock.calls[0][0];
    expect(sql).not.toMatch(/paid_until/);
    expect(sql).not.toMatch(/subscription_cancel_at/);
  });
});
