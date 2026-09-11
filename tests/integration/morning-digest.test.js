// ============================================================
//  morningDigest — Reggeli összefoglaló beállítás CRUD
//    getMorningDigest  — Admin/Manager olvashatja
//    saveMorningDigest — CSAK Admin írhatja (Manager elutasítva)
//  Migráció-toleráns: hiányzó digest_* oszlop (42703) esetén értelmes
//  fallback, nem crash.
// ============================================================
jest.mock('../../db', () => require('../helpers/db-mock').pool);
jest.mock('../../lib/audit', () => ({
  record: jest.fn(),
  fromReq: jest.fn(),
}));

const request = require('supertest');
const express = require('express');
const { pool, rows, reset } = require('../helpers/db-mock');
const { setUser, sessionMiddleware, fixtures } = require('../helpers/session-mock');
const audit = require('../../lib/audit');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(sessionMiddleware);
app.use(require('../../routes/execute'));

function call(fn, args) {
  return request(app).post('/api/execute').send({ functionName: fn, arguments: args });
}

const CID = 1;
const ADMIN = { ...fixtures.admin, company_id: CID };
const MANAGER = { ...fixtures.manager, company_id: CID };
const SOFER = { ...fixtures.sofer, company_id: CID };

beforeEach(() => { reset(); audit.fromReq.mockReset(); });

// ═══ getMorningDigest ════════════════════════════════════════
describe('getMorningDigest', () => {
  test('Sofer nem éri el', async () => {
    setUser(SOFER);
    const res = await call('getMorningDigest', []);
    expect(res.body.result.ok).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('Manager olvashatja (nem csak Admin)', async () => {
    setUser(MANAGER);
    pool.query.mockResolvedValueOnce(rows([{
      enabled: true, time: '08:30:00', recipients: ['x@ceg.ro'], last_sent_at: '2026-09-10T05:30:00Z',
    }]));
    const res = await call('getMorningDigest', []);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.enabled).toBe(true);
    expect(res.body.result.time).toBe('08:30'); // HH:MM:SS -> HH:MM
    expect(res.body.result.recipients).toEqual(['x@ceg.ro']);
  });

  test('cég nem található → hiba', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([]));
    const res = await call('getMorningDigest', []);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/nu a fost gasita/i);
  });

  test('company_id-szűrt SELECT paraméterezve', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([{ enabled: false, time: '07:00:00', recipients: [], last_sent_at: null }]));
    await call('getMorningDigest', []);
    const [sql, params] = pool.query.mock.calls[0];
    expect(String(sql)).toMatch(/FROM companies WHERE id=\$1/);
    expect(params).toEqual([CID]);
  });

  test('alap (üres) állapot: enabled=false, time=07:00, recipients=[]', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([{ enabled: false, time: '07:00:00', recipients: [], last_sent_at: null }]));
    const res = await call('getMorningDigest', []);
    expect(res.body.result).toMatchObject({ ok: true, enabled: false, time: '07:00', recipients: [] });
  });

  test('migráció-hiány (42703) → csendes fallback, NEM crash', async () => {
    setUser(ADMIN);
    const err = new Error('column "digest_enabled" does not exist');
    err.code = '42703';
    pool.query.mockRejectedValueOnce(err);
    const res = await call('getMorningDigest', []);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.enabled).toBe(false);
    expect(res.body.result.migration_pending).toBe(true);
  });

  test('egyéb DB-hiba → generikus szerver-hiba (nincs stack-szivárgás)', async () => {
    setUser(ADMIN);
    pool.query.mockRejectedValueOnce(new Error('connection refused'));
    const res = await call('getMorningDigest', []);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toBe('Eroare de server');
    expect(res.body.result.err).not.toMatch(/connection refused/);
  });

  test('recipients tömb nem-tömb esetén [] fallback', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([{ enabled: false, time: '07:00:00', recipients: 'not-an-array', last_sent_at: null }]));
    const res = await call('getMorningDigest', []);
    expect(res.body.result.recipients).toEqual([]);
  });
});

// ═══ saveMorningDigest ═══════════════════════════════════════
describe('saveMorningDigest', () => {
  test('Manager NEM módosíthatja (csak Admin)', async () => {
    setUser(MANAGER);
    const res = await call('saveMorningDigest', [{ enabled: true, time: '08:00', recipients: [] }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/Doar administratorul/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('Sofer NEM módosíthatja', async () => {
    setUser(SOFER);
    const res = await call('saveMorningDigest', [{ enabled: true }]);
    expect(res.body.result.ok).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('Admin sikeresen menthet', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([]));
    const res = await call('saveMorningDigest', [{ enabled: true, time: '08:30', recipients: ['x@ceg.ro'] }]);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.enabled).toBe(true);
    expect(res.body.result.time).toBe('08:30');
    expect(res.body.result.recipients).toEqual(['x@ceg.ro']);
    const [sql, params] = pool.query.mock.calls[0];
    expect(String(sql)).toMatch(/UPDATE companies SET digest_enabled=\$1, digest_time=\$2::time, digest_recipients=\$3/);
    expect(params).toEqual([true, '08:30', JSON.stringify(['x@ceg.ro']), CID]);
    expect(audit.fromReq).toHaveBeenCalledWith(
      expect.anything(), 'company.morning_digest.set', 'company', String(CID),
      expect.objectContaining({ enabled: true, time: '08:30', recipients_count: 1 })
    );
  });

  test('érvénytelen time-formátum → 07:00 alapértékre esik (nem dob hibát)', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([]));
    const res = await call('saveMorningDigest', [{ enabled: true, time: 'nem-ido', recipients: [] }]);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.time).toBe('07:00');
  });

  test('hiányzó time mező → 07:00 alapérték', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([]));
    const res = await call('saveMorningDigest', [{ enabled: false }]);
    expect(res.body.result.time).toBe('07:00');
  });

  test('érvénytelen e-mail címek kiszűrve, csak a valósak mennek át', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([]));
    const res = await call('saveMorningDigest', [{
      enabled: true, time: '07:00',
      recipients: ['valid@ceg.ro', 'nem-email', '', '   ', 'masik@x.com'],
    }]);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.recipients).toEqual(['valid@ceg.ro', 'masik@x.com']);
  });

  test('duplikált e-mailek (case-insensitive) kiszűrve', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([]));
    const res = await call('saveMorningDigest', [{
      enabled: true, time: '07:00',
      recipients: ['X@Ceg.ro', 'x@ceg.ro', 'X@CEG.RO'],
    }]);
    expect(res.body.result.recipients).toEqual(['x@ceg.ro']);
  });

  test('max 20 címzett — a 21+ kimarad', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([]));
    const many = Array.from({ length: 30 }, (_, i) => `u${i}@ceg.ro`);
    const res = await call('saveMorningDigest', [{ enabled: true, time: '07:00', recipients: many }]);
    expect(res.body.result.recipients.length).toBe(20);
  });

  test('recipients nem-tömb bemenet → üres tömbként kezelve (nem dob hibát)', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([]));
    const res = await call('saveMorningDigest', [{ enabled: true, time: '07:00', recipients: 'not-array' }]);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.recipients).toEqual([]);
  });

  test('migráció-hiány (42703) → értelmes hibaüzenet', async () => {
    setUser(ADMIN);
    const err = new Error('column "digest_enabled" does not exist');
    err.code = '42703';
    pool.query.mockRejectedValueOnce(err);
    const res = await call('saveMorningDigest', [{ enabled: true, time: '07:00', recipients: [] }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/repornește serverul/i);
  });

  test('egyéb DB-hiba → generikus szerver-hiba, audit NEM fut', async () => {
    setUser(ADMIN);
    pool.query.mockRejectedValueOnce(new Error('connection refused'));
    const res = await call('saveMorningDigest', [{ enabled: true, time: '07:00', recipients: [] }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toBe('Eroare de server');
    expect(audit.fromReq).not.toHaveBeenCalled();
  });

  test('enabled mező coerce-olva boolean-ra (truthy string is true lesz)', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([]));
    const res = await call('saveMorningDigest', [{ enabled: 'yes', time: '07:00', recipients: [] }]);
    expect(res.body.result.enabled).toBe(true);
    const [, params] = pool.query.mock.calls[0];
    expect(params[0]).toBe(true);
  });
});
