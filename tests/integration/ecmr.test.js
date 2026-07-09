// ============================================================
//  e-CMR (order_ecmr) — teljes életciklus
//
//  Handlerek: ecmrList (tenant-szűrt), ecmrGet (ownership),
//  ecmrCreate (order-ownership + INSERT), ecmrSign (party whitelist,
//  status-computed újraszámolás, IP-rögzítés).
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
const ADMIN = { ...fixtures.admin, company_id: CID };
const SOFER = { ...fixtures.sofer, company_id: CID };

beforeEach(() => reset());

// ─── ecmrList ────────────────────────────────────────────────
describe('ecmrList', () => {
  test('bármely belépett user hívhatja — company_id-szűrt', async () => {
    setUser(SOFER);
    pool.query.mockResolvedValueOnce(rows([{ id: 1, order_id: 100, status: 'draft' }]));
    const res = await call('ecmrList', []);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.items).toHaveLength(1);
    expect(pool.query.mock.calls[0][1]).toEqual([CID]);
  });

  test('session nélkül 401', async () => {
    setUser(null);
    const res = await call('ecmrList', []);
    expect(res.status).toBe(401);
  });
});

// ─── ecmrGet ─────────────────────────────────────────────────
describe('ecmrGet', () => {
  test('ID nélkül elutasít', async () => {
    setUser(ADMIN);
    const res = await call('ecmrGet', []);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/lipsa/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('nem lét → „Nu a fost gasit"', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([]));
    const res = await call('ecmrGet', [999]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/gasit/i);
  });

  test('sikeres lekérés visszaadja az ecmr-t', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([{
      id: 5, order_id: 100, status: 'partial',
      sender_signed_at: '2026-01-01T10:00:00Z',
    }]));
    const res = await call('ecmrGet', [5]);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.ecmr.id).toBe(5);
  });
});

// ─── ecmrCreate ──────────────────────────────────────────────
describe('ecmrCreate', () => {
  test('order_id nélkül', async () => {
    setUser(ADMIN);
    const res = await call('ecmrCreate', []);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/lipsa/i);
  });

  test('sikeres létrehozás (order ownership OK)', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([{ '?column?': 1 }])) // orders ownership
      .mockResolvedValueOnce(rows([{ id: 42 }]))         // INSERT RETURNING
      .mockResolvedValueOnce({ rowCount: 1 });           // audit
    const res = await call('ecmrCreate', [100]);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.id).toBe(42);
    expect(String(pool.query.mock.calls[1][0])).toMatch(/INSERT INTO order_ecmr/i);
  });
});

// ─── ecmrSign ────────────────────────────────────────────────
describe('ecmrSign', () => {
  test('érvénytelen party (whitelist ellen)', async () => {
    setUser(ADMIN);
    const res = await call('ecmrSign', [{
      ecmr_id: 1, party: 'hacker', name: 'X',
    }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/Parte invalida/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('név nélkül', async () => {
    setUser(ADMIN);
    const res = await call('ecmrSign', [{
      ecmr_id: 1, party: 'sender', name: '',
    }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/Numele semnatarului/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('túl nagy aláírás elutasítva', async () => {
    setUser(ADMIN);
    // 300 KB — a limit ~200 KB
    const bigSig = 'x'.repeat(300 * 1024);
    const res = await call('ecmrSign', [{
      ecmr_id: 1, party: 'sender', name: 'X', sig: bigSig,
    }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/prea mare/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('sender aláírás — computeStatus partial', async () => {
    setUser(ADMIN);
    // UPDATE RETURNING egy sort ad vissza — az egyetlen aláírt fél a sender
    pool.query
      .mockResolvedValueOnce(rows([{
        id: 5, status: 'draft',
        sender_signed_at: '2026-01-01T10:00:00Z',
        carrier_signed_at: null,
        consignee_signed_at: null,
      }]))
      .mockResolvedValueOnce({ rowCount: 1 }) // status UPDATE (draft→partial)
      .mockResolvedValueOnce({ rowCount: 1 }); // audit
    const res = await call('ecmrSign', [{
      ecmr_id: 5, party: 'sender', name: 'Feladó Kft',
    }]);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.status).toBe('partial');
    // Az első SQL a party-specifikus UPDATE
    expect(String(pool.query.mock.calls[0][0])).toMatch(/UPDATE order_ecmr/i);
    expect(String(pool.query.mock.calls[0][0])).toMatch(/sender_name/);
  });

  test('mind a 3 fél aláírt → completed', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([{
        id: 5, status: 'partial',
        sender_signed_at: '2026-01-01T10:00:00Z',
        carrier_signed_at: '2026-01-02T10:00:00Z',
        consignee_signed_at: '2026-01-03T10:00:00Z',
      }]))
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 });
    const res = await call('ecmrSign', [{
      ecmr_id: 5, party: 'consignee', name: 'Címzett Kft',
    }]);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.status).toBe('completed');
  });

  test('carrier oszlop-választás — nem SQL-injection', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([{
        id: 5, status: 'partial',
        sender_signed_at: null,
        carrier_signed_at: '2026-01-02T10:00:00Z',
        consignee_signed_at: null,
      }]))
      .mockResolvedValueOnce({ rowCount: 1 }) // esetleges status update
      .mockResolvedValueOnce({ rowCount: 1 }); // audit
    const res = await call('ecmrSign', [{
      ecmr_id: 5, party: 'carrier', name: 'Fuvarozó Kft',
    }]);
    expect(res.body.result.ok).toBe(true);
    // A whitelist-elt oszlopnevek szerepelnek a SQL-ben
    const firstSql = String(pool.query.mock.calls[0][0]);
    expect(firstSql).toMatch(/carrier_name/);
    expect(firstSql).toMatch(/carrier_signed_at/);
    expect(firstSql).toMatch(/carrier_ip/);
    expect(firstSql).toMatch(/carrier_sig/);
  });

  test('nem létező e-CMR (rowCount=0) → „Nu a fost gasit"', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([])); // UPDATE RETURNING üres
    const res = await call('ecmrSign', [{
      ecmr_id: 999, party: 'sender', name: 'X',
    }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/gasit/i);
  });
});
