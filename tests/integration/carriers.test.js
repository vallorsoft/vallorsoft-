// ============================================================
//  Alvállalkozó (carrier) modul — CRUD + AP + csoport + portál
//
//  Lefedett handlerek: carrierList, carrierSave (create + update),
//  carrierDelete (blokk AP-számla esetén), carrierGroupList/Save/Delete,
//  carrierSetGroup, carrierInvoiceSave, carrierInvoicePayment
//  (részleges és 'full'), carrierInvoiceDelete, carrierPortalSetActive.
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

// ─── carrierList ─────────────────────────────────────────────
describe('carrierList', () => {
  test('visszaadja a cég alvállalkozóit', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([
      { id: 1, nev: 'Alfa SRL', open_balance: 0, portal_users: 0, group_name: null },
      { id: 2, nev: 'Beta SRL', open_balance: 250, portal_users: 1, group_name: 'Nagy fuvarozók' },
    ]));
    const res = await call('carrierList', []);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.items).toHaveLength(2);
    expect(res.body.result.items[0].nev).toBe('Alfa SRL');
    // company_id-szűrés
    expect(pool.query.mock.calls[0][1]).toEqual([CID]);
  });
});

// ─── carrierSave ─────────────────────────────────────────────
describe('carrierSave', () => {
  test('név nélkül: „Numele firmei este obligatoriu"', async () => {
    setUser(ADMIN);
    const res = await call('carrierSave', [{ cui: 'RO123' }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/Numele/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('új alvállalkozó létrehozása', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([{ id: 42 }]));
    const res = await call('carrierSave', [{
      nev: 'Új Fuvarozó SRL', cui: 'RO987', email: 'kapcs@fuvar.hu',
    }]);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.id).toBe(42);
    const [sql, params] = pool.query.mock.calls[0];
    expect(String(sql)).toMatch(/INSERT INTO carriers/i);
    expect(params[0]).toBe(CID);
    expect(params[1]).toBe('Új Fuvarozó SRL');
  });

  test('meglévő átírása (id megadva) — csak saját cégében', async () => {
    setUser(ADMIN);
    // Nincs group_id → csak 1 query (az UPDATE)
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const res = await call('carrierSave', [{
      id: 5, nev: 'Módosított SRL', aktiv: false,
    }]);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.id).toBe(5);
    const [sql, params] = pool.query.mock.calls[0];
    expect(String(sql)).toMatch(/UPDATE carriers/i);
    expect(params).toEqual(expect.arrayContaining([5, CID]));
  });

  test('group_id megadva → ELŐBB a csoport ownership-check', async () => {
    setUser(ADMIN);
    // 1) csoport-ownership: nem található (más cégé)
    pool.query.mockResolvedValueOnce(rows([]));
    const res = await call('carrierSave', [{ nev: 'X', group_id: 77 }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/Grupul/i);
    // Csak 1 query — INSERT nem futhatott
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(String(pool.query.mock.calls[0][0])).toMatch(/SELECT id FROM carrier_groups/i);
  });
});

// ─── carrierDelete ───────────────────────────────────────────
describe('carrierDelete', () => {
  test('ID nélkül elutasít', async () => {
    setUser(ADMIN);
    const res = await call('carrierDelete', []);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/obligatoriu/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('nyitott AP-számla → letiltás', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([{ '?column?': 1 }])); // van AP-számla
    const res = await call('carrierDelete', [5]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/factură|dezactiv/i);
    // Nem futhatott a DELETE
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test('sikeres törlés (portal user + jármű ürítés + DELETE)', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([]))            // nincs AP-számla
      .mockResolvedValueOnce({ rowCount: 0 })     // carrier_users DELETE
      .mockResolvedValueOnce({ rowCount: 0 })     // carrier_vehicles DELETE
      .mockResolvedValueOnce({ rowCount: 1 });    // carriers DELETE
    const res = await call('carrierDelete', [5]);
    expect(res.body.result.ok).toBe(true);
    // Csak az utolsó DELETE hivatkozzon a carriers-re (nem törli át tévedésből a másikat)
    expect(String(pool.query.mock.calls[3][0])).toMatch(/DELETE FROM carriers/i);
  });
});

// ─── carrierGroupSave / Delete ───────────────────────────────
describe('carrierGroupSave', () => {
  test('név nélkül elutasít', async () => {
    setUser(ADMIN);
    const res = await call('carrierGroupSave', [{}]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/Numele/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('új csoport létrehozás', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([{ id: 99 }]));
    const res = await call('carrierGroupSave', [{ name: 'Prémium' }]);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.id).toBe(99);
    expect(String(pool.query.mock.calls[0][0])).toMatch(/INSERT INTO carrier_groups/i);
  });

  test('átnevezés (id megadva) — WHERE company_id', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce({ rowCount: 1 });
    const res = await call('carrierGroupSave', [{ id: 3, name: 'Új név' }]);
    expect(res.body.result.ok).toBe(true);
    expect(String(pool.query.mock.calls[0][0])).toMatch(/UPDATE carrier_groups.*company_id/is);
  });
});

describe('carrierGroupDelete', () => {
  test('nem létező csoport → elutasít, semmi UPDATE/DELETE', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([])); // ownership SELECT üres
    const res = await call('carrierGroupDelete', [88]);
    expect(res.body.result.ok).toBe(false);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test('sikeres törlés: az érintett carrier.group_id NULL-ra, majd DELETE', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([{ id: 88 }])) // ownership OK
      .mockResolvedValueOnce({ rowCount: 3 })    // carriers NULL-set
      .mockResolvedValueOnce({ rowCount: 1 });   // DELETE
    const res = await call('carrierGroupDelete', [88]);
    expect(res.body.result.ok).toBe(true);
    expect(String(pool.query.mock.calls[1][0])).toMatch(/UPDATE carriers SET group_id=NULL/i);
    expect(String(pool.query.mock.calls[2][0])).toMatch(/DELETE FROM carrier_groups/i);
  });
});

// ─── carrierSetGroup ─────────────────────────────────────────
describe('carrierSetGroup', () => {
  test('groupId=null → csak carrier-ownership, aztán UPDATE', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([{ id: 1 }])) // carrier OK
      .mockResolvedValueOnce({ rowCount: 1 });  // UPDATE
    const res = await call('carrierSetGroup', [1, null]);
    expect(res.body.result.ok).toBe(true);
    // Nem futhatott a group-ownership check (mert null a groupId)
    const sqls = pool.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /SELECT id FROM carrier_groups/i.test(s))).toBe(false);
  });

  test('érvényes carrier + group → 2× ownership + UPDATE', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([{ id: 1 }])) // carrier OK
      .mockResolvedValueOnce(rows([{ id: 5 }])) // group OK
      .mockResolvedValueOnce({ rowCount: 1 })   // UPDATE
      .mockResolvedValueOnce({ rowCount: 1 });  // audit.fromReq
    const res = await call('carrierSetGroup', [1, 5]);
    expect(res.body.result.ok).toBe(true);
    // Az első 3 query: a két ownership + az UPDATE. Az audit best-effort
    // 4. hívás — nem szigorúan „üzleti" lekérdezés.
    const sqls = pool.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.filter((s) => /SELECT id FROM carriers/i.test(s)).length).toBe(1);
    expect(sqls.filter((s) => /SELECT id FROM carrier_groups/i.test(s)).length).toBe(1);
    expect(sqls.filter((s) => /UPDATE carriers SET group_id/i.test(s)).length).toBe(1);
  });
});

// ─── carrierInvoiceSave ──────────────────────────────────────
describe('carrierInvoiceSave', () => {
  test('carrier_id nélkül → „Selectează un subcontractant"', async () => {
    setUser(ADMIN);
    const res = await call('carrierInvoiceSave', [{ amount: 100 }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/subcontractant/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('sikeres AP-számla — carrier ownership + INSERT + (fuvar-rákötés kimarad, ha nincs order)', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([{ id: 1 }])) // carrier ownership
      .mockResolvedValueOnce(rows([{ id: 500 }])); // INSERT RETURNING
    const res = await call('carrierInvoiceSave', [{
      carrier_id: 1, invoice_number: 'F-2026-0001',
      amount: 1234.5, currency: 'EUR',
    }]);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.id).toBe(500);
    // 2 query, nem 3 (order_ids üres → nem futott a fuvar-UPDATE)
    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  test('érvénytelen devizanem → EUR-ra normalizál', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([{ id: 1 }]))
      .mockResolvedValueOnce(rows([{ id: 501 }]));
    const res = await call('carrierInvoiceSave', [{
      carrier_id: 1, invoice_number: 'X', amount: 10, currency: 'GBP',
    }]);
    expect(res.body.result.ok).toBe(true);
    // A 2. hívás INSERT — 7. paraméter a devizanem
    const insertParams = pool.query.mock.calls[1][1];
    expect(insertParams[6]).toBe('EUR');
  });

  test('order_ids esetén rákötés a fuvarra (3. UPDATE)', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([{ id: 1 }]))
      .mockResolvedValueOnce(rows([{ id: 502 }]))
      .mockResolvedValueOnce({ rowCount: 2 }); // fuvar-UPDATE
    const res = await call('carrierInvoiceSave', [{
      carrier_id: 1, amount: 500, currency: 'RON',
      order_ids: ['CMD-1', 'CMD-2'],
    }]);
    expect(res.body.result.ok).toBe(true);
    expect(pool.query).toHaveBeenCalledTimes(3);
    expect(String(pool.query.mock.calls[2][0])).toMatch(/UPDATE orders SET carrier_id/i);
  });
});

// ─── carrierInvoicePayment ───────────────────────────────────
describe('carrierInvoicePayment', () => {
  test('nem létező számla → elutasít', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([]));
    const res = await call('carrierInvoicePayment', [999, 100]);
    expect(res.body.result.ok).toBe(false);
  });

  test('teljes fizetés: „full" → status=paid, paid_amount=amount', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([{ amount: 1000, paid_amount: 200 }]))
      .mockResolvedValueOnce({ rowCount: 1 });
    const res = await call('carrierInvoicePayment', [10, 'full']);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.status).toBe('paid');
    expect(res.body.result.paid_amount).toBe(1000);
  });

  test('részfizetés: existing 200 + new 300 → paid=500, status=partial', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([{ amount: 1000, paid_amount: 200 }]))
      .mockResolvedValueOnce({ rowCount: 1 });
    const res = await call('carrierInvoicePayment', [10, 300]);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.status).toBe('partial');
    expect(res.body.result.paid_amount).toBe(500);
  });

  test('túlfizetés-védelem: cap az amount-nál', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([{ amount: 100, paid_amount: 80 }]))
      .mockResolvedValueOnce({ rowCount: 1 });
    const res = await call('carrierInvoicePayment', [10, 500]);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.paid_amount).toBe(100); // capped
    expect(res.body.result.status).toBe('paid');
  });
});

// ─── carrierInvoiceDelete ────────────────────────────────────
describe('carrierInvoiceDelete', () => {
  test('nincs ilyen sor → ok:false', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce({ rowCount: 0 });
    const res = await call('carrierInvoiceDelete', [999]);
    expect(res.body.result.ok).toBe(false);
    expect(String(pool.query.mock.calls[0][0])).toMatch(/DELETE FROM carrier_invoices.*company_id/is);
  });

  test('sikeres törlés', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce({ rowCount: 1 });
    const res = await call('carrierInvoiceDelete', [5]);
    expect(res.body.result.ok).toBe(true);
  });
});

// ─── carrierPortalSetActive ──────────────────────────────────
describe('carrierPortalSetActive', () => {
  test('ID nélkül elutasít', async () => {
    setUser(ADMIN);
    const res = await call('carrierPortalSetActive', [null, true]);
    expect(res.body.result.ok).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('deaktiválás — WHERE company_id', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce({ rowCount: 1 });
    const res = await call('carrierPortalSetActive', [7, false]);
    expect(res.body.result.ok).toBe(true);
    const [sql, params] = pool.query.mock.calls[0];
    expect(String(sql)).toMatch(/UPDATE carrier_users SET activ.*company_id/is);
    expect(params).toEqual([false, 7, CID]);
  });
});
