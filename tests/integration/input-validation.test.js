// ============================================================
//  Input-validation sweep — handler-szintű pre-check védőháló
//
//  Kritikus szabály: minden ír-handler validálja a bemenetet a DB-hívás
//  ELŐTT. Rossz szerkezetű payload (hiányzó ID, üres kötelező mező,
//  whitelist-en kívüli enum) NEM érheti el a DB-t — így nincs pazarló
//  lekérdezés, sem félresiklott SQL. Ez a suite egy helyről szemmel
//  tartja az összes preconditionben lévő őrt.
// ============================================================
jest.mock('../../db', () => require('../helpers/db-mock').pool);

const request = require('supertest');
const express = require('express');
const { pool, reset } = require('../helpers/db-mock');
const { setUser, sessionMiddleware, fixtures } = require('../helpers/session-mock');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(sessionMiddleware);
app.use(require('../../routes/execute'));

function call(fn, args) {
  return request(app).post('/api/execute').send({ functionName: fn, arguments: args });
}

const ADMIN = { ...fixtures.admin, company_id: 1 };

beforeEach(() => {
  reset();
  setUser(ADMIN);
});

// ─── Hiányzó ID ──────────────────────────────────────────────
describe('Hiányzó ID esetén nincs DB-érintés', () => {
  const NEEDS_ID = [
    ['comUpdate',              [null, { pret: 1 }]],
    ['comUpdate',              ['', { pret: 1 }]],
    ['comDelete',              [null]],
    ['comDelete',              ['']],
    ['vehicleDelete',          [null]],
    ['extDriverUpdate',        [null, { nume: 'X' }]],
    ['extDriverDelete',        [null]],
    ['favLocationDelete',      [null]],
    ['carrierDelete',          [null]],
    ['carrierGroupDelete',     [null]],
    ['carrierInvoicePayment',  [null, 100]],
    ['carrierPortalSetActive', [null, true]],
    ['fuvarlevelUpdate',       [null, {}]],
    ['quoteSetStatus',         [{ status: 'draft' }]],
    ['quoteToOrder',           [{}]],
    ['ecmrGet',                [null]],
    ['ecmrCreate',             [null]],
  ];

  test.each(NEEDS_ID)('%s + args=%p → ok:false, 0 DB-hívás', async (fn, args) => {
    const res = await call(fn, args);
    expect(res.body.result.ok).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

// ─── Whitelist-en kívüli enum-érték ──────────────────────────
describe('Enum whitelist-védelem', () => {
  test('vehicleCreate — érvénytelen tip', async () => {
    const res = await call('vehicleCreate', [{ rendszam: 'B1', tip: 'BUS' }]);
    expect(res.body.result.err).toMatch(/Tip invalid/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('vehicleUpdate — érvénytelen tip', async () => {
    const res = await call('vehicleUpdate', [1, { tip: 'X' }]);
    expect(res.body.result.err).toMatch(/Tip invalid/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('comUpdate — érvénytelen status', async () => {
    const res = await call('comUpdate', ['CMD-1', { status: 'InvalidStatus' }]);
    expect(res.body.result.err).toMatch(/Status invalid/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('quoteSetStatus — érvénytelen státusz', async () => {
    const res = await call('quoteSetStatus', [{ id: 1, status: 'draftz' }]);
    expect(res.body.result.err).toMatch(/Status invalid/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('ecmrSign — érvénytelen party', async () => {
    const res = await call('ecmrSign', [{ ecmr_id: 1, party: 'SQL_INJECTION', name: 'X' }]);
    expect(res.body.result.err).toMatch(/Parte invalid/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('ecmrSign — üres party', async () => {
    const res = await call('ecmrSign', [{ ecmr_id: 1, party: '', name: 'X' }]);
    expect(res.body.result.err).toMatch(/Parte invalid/i);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

// ─── Kötelező mező hiányzik ──────────────────────────────────
describe('Kötelező mezők', () => {
  test('vehicleCreate — rendszam üres', async () => {
    const res = await call('vehicleCreate', [{ rendszam: '   ', tip: 'Vontato' }]);
    expect(res.body.result.err).toMatch(/inmatriculare/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('extDriverCreate — nume és firma is hiányzik', async () => {
    const res = await call('extDriverCreate', [{ telefon: '0700', email: 'x@x.hu' }]);
    expect(res.body.result.err).toMatch(/Numele sau denumirea/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('favLocationSave — label üres', async () => {
    const res = await call('favLocationSave', [{ address: 'X' }]);
    expect(res.body.result.err).toMatch(/Eticheta/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('favLocationSave — address üres', async () => {
    const res = await call('favLocationSave', [{ label: 'X' }]);
    expect(res.body.result.err).toMatch(/Adresa/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('carrierSave — nev nélkül', async () => {
    const res = await call('carrierSave', [{ cui: 'RO1', email: 'x@x.hu' }]);
    expect(res.body.result.err).toMatch(/Numele firmei/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('carrierGroupSave — name nélkül', async () => {
    const res = await call('carrierGroupSave', [{}]);
    expect(res.body.result.err).toMatch(/Numele grupului/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('carrierInvoiceSave — carrier_id nélkül', async () => {
    const res = await call('carrierInvoiceSave', [{ amount: 100 }]);
    expect(res.body.result.err).toMatch(/subcontractant/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('carrierPortalInvite — érvénytelen e-mail', async () => {
    const res = await call('carrierPortalInvite', [{
      carrier_id: 1, email: 'not-an-email',
    }]);
    expect(res.body.result.err).toMatch(/E-mail invalid/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('quoteSave — client_name és client_id is hiányzik', async () => {
    const res = await call('quoteSave', [{ loc_from: 'A', loc_to: 'B', price: 1 }]);
    expect(res.body.result.err).toMatch(/Clientul/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('fuvarlevelCreate — nume_sofer üres', async () => {
    const res = await call('fuvarlevelCreate', [{ km_inceput: 0 }]);
    expect(res.body.result.err).toMatch(/Numele soferului/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('ecmrSign — név nélkül', async () => {
    const res = await call('ecmrSign', [{ ecmr_id: 1, party: 'sender', name: '  ' }]);
    expect(res.body.result.err).toMatch(/Numele semnatarului/i);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

// ─── orderDocUpload — hiányos payload ────────────────────────
describe('orderDocUpload — hiányos payload', () => {
  test('üres orderId', async () => {
    const res = await call('orderDocUpload', ['', 'file.pdf', 'BASE64']);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/lipsa/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('üres fileName', async () => {
    const res = await call('orderDocUpload', ['CMD-1', '', 'BASE64']);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/lipsa/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('üres base64', async () => {
    const res = await call('orderDocUpload', ['CMD-1', 'file.pdf', null]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/lipsa/i);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

// ─── Boundary: nagyon nagy string / negatív szám ─────────────
describe('Boundary értékek', () => {
  test('ecmrSign — 200 KB feletti aláírás elutasul', async () => {
    const bigSig = 'x'.repeat(210 * 1024);
    const res = await call('ecmrSign', [{
      ecmr_id: 1, party: 'sender', name: 'X', sig: bigSig,
    }]);
    expect(res.body.result.err).toMatch(/prea mare/i);
    expect(pool.query).not.toHaveBeenCalled();
  });
});
