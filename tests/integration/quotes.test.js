// ============================================================
//  Quotes (Cotații) — teljes életciklus + validáció
//
//  Handlerek: quoteList (szűrők), quoteSave (create + update),
//  quoteSetStatus (whitelist), quoteToOrder (konverzió: dupla-védelem,
//  comCreate-átemelés, ajánlat lezárása).
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
const MANAGER = { ...fixtures.manager, company_id: CID };
const SOFER = { ...fixtures.sofer, company_id: CID };

beforeEach(() => reset());

// ─── quoteList — szűrők ──────────────────────────────────────
describe('quoteList', () => {
  test('bármely szerep hívhatja (Sofer is)', async () => {
    setUser(SOFER);
    pool.query.mockResolvedValueOnce(rows([{ id: 1, client_name: 'X' }]));
    const res = await call('quoteList', []);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.items).toHaveLength(1);
    // company_id az első paraméter
    expect(pool.query.mock.calls[0][1][0]).toBe(CID);
  });

  test('érvénytelen státusz-szűrő nem kerül a WHERE-be', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([]));
    await call('quoteList', [{ status: 'INVALID_STATUS' }]);
    const [sql, params] = pool.query.mock.calls[0];
    // Csak a company_id paraméter, mert a whitelist-en nincs
    expect(params).toEqual([CID]);
    expect(String(sql)).not.toMatch(/AND status =/i);
  });

  test('érvényes szűrő + dátumok bekerülnek', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([]));
    await call('quoteList', [{ status: 'sent', from: '2026-01-01', to: '2026-12-31' }]);
    const [sql, params] = pool.query.mock.calls[0];
    expect(params).toEqual([CID, 'sent', '2026-01-01', '2026-12-31']);
    expect(String(sql)).toMatch(/AND status =/i);
    expect(String(sql)).toMatch(/AND created_at >=/i);
    expect(String(sql)).toMatch(/AND created_at <=/i);
  });

  test('session nélkül elutasít', async () => {
    setUser(null);
    const res = await call('quoteList', []);
    expect(res.status).toBe(401);
  });
});

// ─── quoteSave — create + update ─────────────────────────────
describe('quoteSave', () => {
  test('client nélkül elutasít', async () => {
    setUser(ADMIN);
    const res = await call('quoteSave', [{ loc_from: 'A', loc_to: 'B', price: 100 }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/Clientul/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('új ajánlat létrehozás — INSERT', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([{ id: 100 }])) // INSERT RETURNING
      .mockResolvedValueOnce({ rowCount: 1 });    // audit
    const res = await call('quoteSave', [{
      client_name: 'Új Ügyfél', loc_from: 'Cluj', loc_to: 'Brasov',
      price: 500, valuta: 'EUR',
    }]);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.id).toBe(100);
    const [sql, params] = pool.query.mock.calls[0];
    expect(String(sql)).toMatch(/INSERT INTO quotes/i);
    expect(params[0]).toBe(CID);
  });

  test('devizanem alapértelmezetten EUR', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([{ id: 101 }]))
      .mockResolvedValueOnce({ rowCount: 1 });
    await call('quoteSave', [{ client_name: 'X' }]);
    // 7. paraméter (valuta)
    expect(pool.query.mock.calls[0][1][6]).toBe('EUR');
  });

  test('update: ownership OK + UPDATE', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([{ id: 5 }])) // ownership OK
      .mockResolvedValueOnce({ rowCount: 1 })   // UPDATE
      .mockResolvedValueOnce({ rowCount: 1 });  // audit
    const res = await call('quoteSave', [{
      id: 5, client_name: 'Módosított', price: 999,
    }]);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.id).toBe(5);
    const sqls = pool.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /SELECT id FROM quotes/i.test(s))).toBe(true);
    expect(sqls.some((s) => /UPDATE quotes/i.test(s))).toBe(true);
  });

  test('érvénytelen ID (0) — hibaüzenet', async () => {
    setUser(ADMIN);
    const res = await call('quoteSave', [{ id: 'nem_szám', client_name: 'X' }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/ID invalid/i);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

// ─── quoteSetStatus — státusz whitelist ──────────────────────
describe('quoteSetStatus', () => {
  test('érvénytelen státusz elutasít, DB-t sem érint', async () => {
    setUser(ADMIN);
    const res = await call('quoteSetStatus', [{ id: 1, status: 'accepted' }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/Status invalid/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('érvényes státusz — UPDATE company_id-szűrt', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 }); // audit
    const res = await call('quoteSetStatus', [{ id: 1, status: 'awarded' }]);
    expect(res.body.result.ok).toBe(true);
    const [sql, params] = pool.query.mock.calls[0];
    expect(String(sql)).toMatch(/UPDATE quotes SET status.*company_id/is);
    expect(params).toEqual(['awarded', 1, CID]);
  });

  test('minden érvényes státusz-érték elfogadva', async () => {
    for (const st of ['draft', 'sent', 'awarded', 'lost']) {
      reset();
      setUser(ADMIN);
      pool.query
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rowCount: 1 });
      const res = await call('quoteSetStatus', [{ id: 1, status: st }]);
      expect(res.body.result.ok).toBe(true);
    }
  });
});

// ─── quoteToOrder — konverzió ────────────────────────────────
describe('quoteToOrder', () => {
  test('nem létező ajánlat', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([])); // SELECT üres
    const res = await call('quoteToOrder', [{ id: 999 }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/găsit/i);
  });

  test('már konvertált (order_id!=null) → dupla-védelem', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([{
      id: 5, client_name: 'X', loc_from: 'A', loc_to: 'B',
      price: 100, valuta: 'EUR', order_id: 'CMD-EXISTING',
    }]));
    const res = await call('quoteToOrder', [{ id: 5 }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/deja convert/i);
    // Csak a SELECT futhatott — semmi INSERT/UPDATE
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test('Manager hívhatja', async () => {
    setUser(MANAGER);
    pool.query.mockResolvedValueOnce(rows([])); // nem lét
    const res = await call('quoteToOrder', [{ id: 999 }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/găsit/i);
  });

  test('Sofer NEM hívhatja', async () => {
    setUser(SOFER);
    const res = await call('quoteToOrder', [{ id: 1 }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/interzis/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('sima számot fogad a hívó (nem obj) — args=[1]', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([]));
    const res = await call('quoteToOrder', [1]);
    // Nem érte el a nem-létező ág, tehát bejutott az ID-t 1-ként
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/găsit/i);
    // A SELECT paraméter id=1
    expect(pool.query.mock.calls[0][1]).toEqual([1, CID]);
  });

  test('ID nélkül elutasít', async () => {
    setUser(ADMIN);
    const res = await call('quoteToOrder', [{}]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/ID invalid/i);
    expect(pool.query).not.toHaveBeenCalled();
  });
});
