// ============================================================
//  orderPostDelivery — dokumentum-nyomkövetés (post-delivery lifecycle)
//    1) setOrderPostDelivery(order_id, mezők) — Admin/Manager, company_id-
//       szűrt, tulajdon-ellenőrzés, undefined=nem módosít, null/''=NULL,
//       payment_status_ext fehérlista, dátum-validáció.
//    2) checkInvoicePaidExternal(order_id) — a cég billing-provideren
//       lekéri a számla fizetési státuszát; több mezőnév-jelöltet próbál;
//       ha egyiket sem találja, hibát ad (NEM hamis 'pending'-et).
//  A Sofer NEM éri el egyiket sem.
// ============================================================
jest.mock('../../db', () => require('../helpers/db-mock').pool);
jest.mock('../../lib/audit', () => ({
  record: jest.fn(),
  fromReq: jest.fn(),
}));
jest.mock('../../lib/crypto', () => ({
  encrypt: jest.fn((s) => 'ENC(' + s + ')'),
  decrypt: jest.fn((s) => String(s).replace(/^ENC\(/, '').replace(/\)$/, '')),
  mask: jest.fn((s) => '***'),
}));

const mockGetInvoice = jest.fn();
jest.mock('../../services/billing', () => ({
  getAdapter: jest.fn(() => ({ getInvoice: mockGetInvoice })),
}));

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

beforeEach(() => { reset(); mockGetInvoice.mockReset(); });

// ═══ setOrderPostDelivery ════════════════════════════════════
describe('setOrderPostDelivery', () => {
  test('Sofer nem éri el', async () => {
    setUser(SOFER);
    const res = await call('setOrderPostDelivery', [{ order_id: 'CMD-1', invoice_no: 'FCT1' }]);
    expect(res.body.result.ok).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('order_id hiányzik → hiba, nincs DB-hívás', async () => {
    setUser(ADMIN);
    const res = await call('setOrderPostDelivery', [{ invoice_no: 'FCT1' }]);
    expect(res.body.result.ok).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('cross-tenant védelem — nem a saját cég fuvarja', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([])); // ownership SELECT üres
    const res = await call('setOrderPostDelivery', [{ order_id: 'CMD-X', invoice_no: 'FCT1' }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/nu a fost gasit/i);
    // A tulajdon-ellenőrző SELECT company_id-t is paraméterez
    const [sql, params] = pool.query.mock.calls[0];
    expect(String(sql)).toMatch(/orders WHERE id=\$1 AND company_id=\$2/);
    expect(params).toEqual(['CMD-X', CID]);
    // Nincs UPDATE (csak 1 hívás történt)
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test('nincs mező küldve → "Nu s-au trimis modificari" hiba', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([{ id: 'CMD-1' }])); // ownership OK
    const res = await call('setOrderPostDelivery', [{ order_id: 'CMD-1' }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/Nu s-au trimis/i);
  });

  test('érvénytelen payment_status_ext → elutasítva', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([{ id: 'CMD-1' }])); // ownership
    const res = await call('setOrderPostDelivery', [{ order_id: 'CMD-1', payment_status_ext: 'not_a_valid_status' }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/invalid/i);
    // Nincs UPDATE — csak az ownership SELECT futott
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test('sikeres mentés — invoice_no + posta dátumok + fizetés', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([{ id: 'CMD-1' }])) // ownership
      .mockResolvedValueOnce(rows([]));                 // UPDATE
    const res = await call('setOrderPostDelivery', [{
      order_id: 'CMD-1',
      invoice_no: 'FCT00123',
      postal_address: 'Str. Exemplu 5, Cluj',
      postal_sent_at: '2026-09-10',
      payment_status_ext: 'paid',
      payment_received_at: '2026-09-11',
      post_notes: 'Ok, plătit integral.',
    }]);
    expect(res.body.result.ok).toBe(true);
    expect(pool.query).toHaveBeenCalledTimes(2);
    const [sql, params] = pool.query.mock.calls[1];
    expect(String(sql)).toMatch(/UPDATE orders SET/);
    expect(String(sql)).toMatch(/invoice_no = \$1/);
    expect(String(sql)).toMatch(/payment_ext_source = \$\d+/); // manual jelzés bekerül
    expect(params).toContain('FCT00123');
    expect(params).toContain('paid');
    expect(params).toContain('manual');
    // WHERE id + company_id a lista VÉGÉN
    expect(params[params.length - 2]).toBe('CMD-1');
    expect(params[params.length - 1]).toBe(CID);
  });

  test('üres string mezők NULL-ra állnak (nem üres string kerül a DB-be)', async () => {
    setUser(MANAGER);
    pool.query
      .mockResolvedValueOnce(rows([{ id: 'CMD-2' }]))
      .mockResolvedValueOnce(rows([]));
    const res = await call('setOrderPostDelivery', [{
      order_id: 'CMD-2',
      invoice_no: '',
      postal_address: '   ',
    }]);
    expect(res.body.result.ok).toBe(true);
    const [, params] = pool.query.mock.calls[1];
    // invoice_no + postal_address mindkettő NULL lett (üres/whitespace → trim → '' → null)
    expect(params[0]).toBeNull();
    expect(params[1]).toBeNull();
  });

  test('érvénytelen dátum-formátum → NULL-ra esik (nem dob hibát)', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([{ id: 'CMD-3' }]))
      .mockResolvedValueOnce(rows([]));
    const res = await call('setOrderPostDelivery', [{ order_id: 'CMD-3', postal_sent_at: 'nem-datum' }]);
    expect(res.body.result.ok).toBe(true);
    const [, params] = pool.query.mock.calls[1];
    expect(params[0]).toBeNull();
  });

  test('mező-hosszkorlát: invoice_no 50 karakterre vágva, post_notes 2000-re', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([{ id: 'CMD-4' }]))
      .mockResolvedValueOnce(rows([]));
    const longInv = 'X'.repeat(80);
    const longNote = 'Y'.repeat(2500);
    await call('setOrderPostDelivery', [{ order_id: 'CMD-4', invoice_no: longInv, post_notes: longNote }]);
    const [, params] = pool.query.mock.calls[1];
    expect(params[0].length).toBe(50);
    expect(params[1].length).toBe(2000);
  });
});

// ═══ checkInvoicePaidExternal ═══════════════════════════════
describe('checkInvoicePaidExternal', () => {
  test('Manager nem éri el — csak Admin/Manager (Sofer kizárva)', async () => {
    setUser(SOFER);
    const res = await call('checkInvoicePaidExternal', [{ order_id: 'CMD-1' }]);
    expect(res.body.result.ok).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('fuvar nem található (cross-tenant) → hiba', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([])); // orders SELECT üres
    const res = await call('checkInvoicePaidExternal', [{ order_id: 'CMD-X' }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/nu a fost gasita/i);
  });

  test('nincs invoice_no rögzítve a fuvaron → hiba', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([{ id: 'CMD-1', invoice_no: null, pret: 500 }]));
    const res = await call('checkInvoicePaidExternal', [{ order_id: 'CMD-1' }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/Nu exista numar de factura/i);
  });

  test('nincs aktív billing-integráció → hiba', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([{ id: 'CMD-1', invoice_no: 'FCT001', pret: 500 }]))
      .mockResolvedValueOnce(rows([])); // billing_integrations üres
    const res = await call('checkInvoicePaidExternal', [{ order_id: 'CMD-1' }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/provider de facturare configurat/i);
  });

  test('sikeres lekérés — FGO mezőnevekkel (value/paid), teljesen kifizetve → paid', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([{ id: 'CMD-1', invoice_no: 'FCT00123', pret: 500 }]))
      .mockResolvedValueOnce(rows([{ provider: 'fgo', credentials: { enc: 'ENC({"apiKey":"xyz"})' } }]))
      .mockResolvedValueOnce(rows([])); // UPDATE
    mockGetInvoice.mockResolvedValueOnce({ ok: true, invoice: { value: 500, paid: 500 } });
    const res = await call('checkInvoicePaidExternal', [{ order_id: 'CMD-1' }]);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.status).toBe('paid');
    // serie/numar szétvágás: 'FCT00123' -> serie='FCT', numar='00123'
    expect(mockGetInvoice).toHaveBeenCalledWith('FCT', '00123');
    // UPDATE-nél a forrás 'fgo'
    const [sql, params] = pool.query.mock.calls[2];
    expect(String(sql)).toMatch(/payment_ext_source='fgo'/);
    expect(params).toEqual(['paid', 'CMD-1', CID]);
  });

  test('részleges fizetés → delayed', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([{ id: 'CMD-1', invoice_no: 'FCT00123', pret: 500 }]))
      .mockResolvedValueOnce(rows([{ provider: 'fgo', credentials: { enc: 'ENC({"apiKey":"xyz"})' } }]))
      .mockResolvedValueOnce(rows([]));
    mockGetInvoice.mockResolvedValueOnce({ ok: true, invoice: { value: 500, paid: 200 } });
    const res = await call('checkInvoicePaidExternal', [{ order_id: 'CMD-1' }]);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.status).toBe('delayed');
  });

  test('nincs fizetve → pending', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([{ id: 'CMD-1', invoice_no: 'FCT00123', pret: 500 }]))
      .mockResolvedValueOnce(rows([{ provider: 'fgo', credentials: { enc: 'ENC({"apiKey":"xyz"})' } }]))
      .mockResolvedValueOnce(rows([]));
    mockGetInvoice.mockResolvedValueOnce({ ok: true, invoice: { value: 500, paid: 0 } });
    const res = await call('checkInvoicePaidExternal', [{ order_id: 'CMD-1' }]);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.status).toBe('pending');
  });

  test('provider hibát ad vissza → a hiba visszamegy, STÁTUSZ NEM módosul', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([{ id: 'CMD-1', invoice_no: 'FCT00123', pret: 500 }]))
      .mockResolvedValueOnce(rows([{ provider: 'fgo', credentials: { enc: 'ENC({"apiKey":"xyz"})' } }]));
    mockGetInvoice.mockResolvedValueOnce({ ok: false, message: 'Factura nu a fost gasita.' });
    const res = await call('checkInvoicePaidExternal', [{ order_id: 'CMD-1' }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/nu a fost gasita/i);
    // Nincs UPDATE-hívás (csak 2 SELECT történt)
    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  test('ismeretlen provider-válasz mezőnevek → hiba, NEM hamis "pending"', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([{ id: 'CMD-1', invoice_no: 'FCT00123', pret: 500 }]))
      .mockResolvedValueOnce(rows([{ provider: 'smartbill', credentials: { enc: 'ENC({"apiKey":"xyz"})' } }]));
    // SmartBill/Oblio raw válasz, aminek egyik mezőneve sem egyezik a fehérlistával
    mockGetInvoice.mockResolvedValueOnce({ ok: true, invoice: { someUnknownField: 123 } });
    const res = await call('checkInvoicePaidExternal', [{ order_id: 'CMD-1' }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/structura necunoscută/i);
    // Nincs UPDATE — nem írjuk felül hamis állapottal
    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  test('alternatív mezőnevek (total/paidValue) is felismerve', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([{ id: 'CMD-1', invoice_no: 'FCT00123', pret: 500 }]))
      .mockResolvedValueOnce(rows([{ provider: 'smartbill', credentials: { enc: 'ENC({"apiKey":"xyz"})' } }]))
      .mockResolvedValueOnce(rows([]));
    mockGetInvoice.mockResolvedValueOnce({ ok: true, invoice: { total: 500, paidValue: 500 } });
    const res = await call('checkInvoicePaidExternal', [{ order_id: 'CMD-1' }]);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.status).toBe('paid');
  });

  test('csak számjegyekből álló invoice_no → serie üres, numar a teljes szám', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([{ id: 'CMD-1', invoice_no: '00456', pret: 100 }]))
      .mockResolvedValueOnce(rows([{ provider: 'fgo', credentials: { enc: 'ENC({"apiKey":"xyz"})' } }]))
      .mockResolvedValueOnce(rows([]));
    mockGetInvoice.mockResolvedValueOnce({ ok: true, invoice: { value: 100, paid: 0 } });
    await call('checkInvoicePaidExternal', [{ order_id: 'CMD-1' }]);
    expect(mockGetInvoice).toHaveBeenCalledWith('', '00456');
  });

  test('titkosított credentials nem olvasható → hiba', async () => {
    setUser(ADMIN);
    const crypto = require('../../lib/crypto');
    pool.query
      .mockResolvedValueOnce(rows([{ id: 'CMD-1', invoice_no: 'FCT1', pret: 100 }]))
      .mockResolvedValueOnce(rows([{ provider: 'fgo', credentials: { enc: 'malformed-json-not-really' } }]));
    crypto.decrypt.mockImplementationOnce(() => { throw new Error('bad key'); });
    const res = await call('checkInvoicePaidExternal', [{ order_id: 'CMD-1' }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/nu pot fi citite/i);
  });
});
