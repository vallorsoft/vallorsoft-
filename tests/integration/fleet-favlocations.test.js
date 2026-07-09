// ============================================================
//  Flotta (vehicles + external_drivers) + Kedvenc helyszínek
//  (favorite_locations) — CRUD + validáció.
//
//  Handlerek: vehicleList/Create/Update/Delete,
//  extDriverList/Create/Update/Delete, favLocationList/Save/Delete.
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

beforeEach(() => reset());

// ─── vehicles ────────────────────────────────────────────────
describe('vehicles', () => {
  test('vehicleList — company_id-szűrt', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([
      { id: 1, rendszam: 'B123ABC', tip: 'Vontato' },
      { id: 2, rendszam: 'B999XYZ', tip: 'Potkocsi' },
    ]));
    const res = await call('vehicleList', []);
    expect(res.body.result).toHaveLength(2);
    expect(pool.query.mock.calls[0][1]).toEqual([CID]);
  });

  test('vehicleCreate — rendszam nélkül elutasít', async () => {
    setUser(ADMIN);
    const res = await call('vehicleCreate', [{ tip: 'Vontato' }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/inmatriculare/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('vehicleCreate — érvénytelen tip', async () => {
    setUser(ADMIN);
    const res = await call('vehicleCreate', [{ rendszam: 'B123', tip: 'HackerType' }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/Tip invalid/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('vehicleCreate — sikeres (nincs csomag-limit)', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([])) // planLimits: nincs subscription_plans sor → ok:true
      .mockResolvedValueOnce({ rowCount: 1 }); // INSERT
    const res = await call('vehicleCreate', [{
      rendszam: 'b123 abc', tip: 'Vontato', marca: 'Volvo', model: 'FH16',
    }]);
    expect(res.body.result.ok).toBe(true);
    // Rendszam felnormalizálva
    const insertParams = pool.query.mock.calls[1][1];
    expect(insertParams[0]).toBe('B123 ABC');
  });

  test('vehicleCreate — csomag-limit elérve', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([{ lim: 5 }])) // subscription_plans van, limit=5
      .mockResolvedValueOnce(rows([{ n: 5 }]));  // used=5 == limit
    const res = await call('vehicleCreate', [{
      rendszam: 'B999', tip: 'Vontato',
    }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/Limita.*pachetului/i);
  });

  test('vehicleUpdate — üres mezők → „Nu exista nimic de modificat"', async () => {
    setUser(ADMIN);
    const res = await call('vehicleUpdate', [1, {}]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/nimic de modificat/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('vehicleUpdate — érvénytelen tip elutasít', async () => {
    setUser(ADMIN);
    const res = await call('vehicleUpdate', [1, { tip: 'Bad' }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/Tip invalid/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('vehicleUpdate — sikeres', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce({ rowCount: 1 });
    const res = await call('vehicleUpdate', [1, { marca: 'Scania' }]);
    expect(res.body.result.ok).toBe(true);
  });

  test('vehicleDelete — nem lét (rowCount=0)', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce({ rowCount: 0 });
    const res = await call('vehicleDelete', [999]);
    expect(res.body.result.ok).toBe(false);
  });

  test('vehicleDelete — sikeres, company_id-szűrt', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce({ rowCount: 1 });
    const res = await call('vehicleDelete', [1]);
    expect(res.body.result.ok).toBe(true);
    const [sql, params] = pool.query.mock.calls[0];
    expect(String(sql)).toMatch(/DELETE FROM vehicles.*company_id/is);
    expect(params).toEqual([1, CID]);
  });
});

// ─── external_drivers ────────────────────────────────────────
describe('external_drivers', () => {
  test('extDriverCreate — nume/firma nélkül elutasít', async () => {
    setUser(ADMIN);
    const res = await call('extDriverCreate', [{ telefon: '0700123456' }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/Numele sau denumirea/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('extDriverCreate — email normalizálás (lowercase)', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([{ id: 10 }]));
    const res = await call('extDriverCreate', [{
      nume: 'John Doe', email: 'JOHN@EXAMPLE.COM',
      rendszam_camion: 'b111  ',
    }]);
    expect(res.body.result.ok).toBe(true);
    const params = pool.query.mock.calls[0][1];
    expect(params[3]).toBe('john@example.com');
    expect(params[4]).toBe('B111'); // uppercase + trim
  });

  test('extDriverCreate — csak firma is elég', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([{ id: 11 }]));
    const res = await call('extDriverCreate', [{ firma: 'Fuvarozó Kft' }]);
    expect(res.body.result.ok).toBe(true);
  });

  test('extDriverUpdate — üres args → nincs mit módosítani', async () => {
    setUser(ADMIN);
    const res = await call('extDriverUpdate', [1, {}]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/nimic de modificat/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('extDriverUpdate — sikeres módosítás', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce({ rowCount: 1 });
    const res = await call('extDriverUpdate', [1, { telefon: '0700 999 888' }]);
    expect(res.body.result.ok).toBe(true);
    const [sql] = pool.query.mock.calls[0];
    expect(String(sql)).toMatch(/UPDATE external_drivers.*company_id/is);
  });

  test('extDriverDelete — sikeres', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce({ rowCount: 1 });
    const res = await call('extDriverDelete', [7]);
    expect(res.body.result.ok).toBe(true);
    const [sql, params] = pool.query.mock.calls[0];
    expect(String(sql)).toMatch(/DELETE FROM external_drivers.*company_id/is);
    expect(params).toEqual([7, CID]);
  });
});

// ─── favorite_locations ──────────────────────────────────────
describe('favorite_locations', () => {
  test('favLocationList — company_id-szűrt', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([
      { id: 1, label: 'Raktár Cluj', address: 'Str. X 1', type: 'both' },
    ]));
    const res = await call('favLocationList', []);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.items).toHaveLength(1);
    expect(pool.query.mock.calls[0][1]).toEqual([CID]);
  });

  test('favLocationSave — label nélkül', async () => {
    setUser(ADMIN);
    const res = await call('favLocationSave', [{ address: 'Str. X' }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/Eticheta/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('favLocationSave — address nélkül', async () => {
    setUser(ADMIN);
    const res = await call('favLocationSave', [{ label: 'X' }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/Adresa/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('favLocationSave — érvénytelen type → both-ra normalizál', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([{ id: 22 }])) // INSERT
      .mockResolvedValueOnce({ rowCount: 1 }); // audit
    const res = await call('favLocationSave', [{
      label: 'X', address: 'Y', type: 'not_a_real_type',
    }]);
    expect(res.body.result.ok).toBe(true);
    // 6. paraméter (type) → 'both'
    expect(pool.query.mock.calls[0][1][5]).toBe('both');
  });

  test('favLocationSave — érvényes type „load"', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([{ id: 23 }]))
      .mockResolvedValueOnce({ rowCount: 1 });
    const res = await call('favLocationSave', [{
      label: 'X', address: 'Y', type: 'load',
    }]);
    expect(res.body.result.ok).toBe(true);
    expect(pool.query.mock.calls[0][1][5]).toBe('load');
  });

  test('favLocationSave — update ág', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce({ rowCount: 1 })   // UPDATE
      .mockResolvedValueOnce({ rowCount: 1 }); // audit
    const res = await call('favLocationSave', [{
      id: 5, label: 'X', address: 'Y',
    }]);
    expect(res.body.result.ok).toBe(true);
    const [sql] = pool.query.mock.calls[0];
    expect(String(sql)).toMatch(/UPDATE favorite_locations.*company_id/is);
  });

  test('favLocationDelete — ID nélkül', async () => {
    setUser(ADMIN);
    const res = await call('favLocationDelete', [null]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/obligatoriu/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('favLocationDelete — sikeres törlés', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce({ rowCount: 1 })   // DELETE
      .mockResolvedValueOnce({ rowCount: 1 }); // audit
    const res = await call('favLocationDelete', [5]);
    expect(res.body.result.ok).toBe(true);
  });
});
