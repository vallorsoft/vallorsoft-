// ============================================================
//  Comanda de Transport (megbízás) — handler tesztek
//  Lefedett: orderAssignmentGet/Carriers/Save/GetPdf/SaveSigned/
//  AttachToDocs/Delete. Szerepkör-védelem, tenant-izoláció,
//  csak Extern/sofőr-nélküli szűrés, mező-fehérlista.
// ============================================================
jest.mock('../../db', () => require('../helpers/db-mock').pool);

const request = require('supertest');
const express = require('express');
const { pool, rows, reset } = require('../helpers/db-mock');
const { setUser, sessionMiddleware, fixtures } = require('../helpers/session-mock');

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(sessionMiddleware);
app.use(require('../../routes/execute'));

function call(fn, args){
  return request(app).post('/api/execute').send({ functionName: fn, arguments: args });
}

const CID = 1;
const ADMIN = { ...fixtures.admin, company_id: CID };
const MANAGER = { ...fixtures.manager, company_id: CID };
const SOFER = { ...fixtures.sofer, company_id: CID };

beforeEach(() => reset());

// ── Szerep-kapu ─────────────────────────────────────────────
describe('orderAssignment — szerep-kapuk', () => {
  test('Sofer NEM éri el az orderAssignmentGet-et', async () => {
    setUser(SOFER);
    const res = await call('orderAssignmentGet', ['CMD-1']);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/interzis/i);
    expect(pool.query).not.toHaveBeenCalled();
  });
  test('Sofer NEM éri el az orderAssignmentSave-et', async () => {
    setUser(SOFER);
    const res = await call('orderAssignmentSave', [{ order_id: 'CMD-1' }]);
    expect(res.body.result.ok).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

// ── orderAssignmentGet — tenant-izoláció + jogosultsági szűrő ──
describe('orderAssignmentGet', () => {
  test('nem-tenant fuvarhoz nem ad adatot', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([]));  // "SELECT * FROM orders WHERE ... company_id=..." üres
    const res = await call('orderAssignmentGet', ['CMD-OTHER']);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/gasit/i);
    // Ellenőrzés: az első lekérdezés company_id-szűrt
    expect(pool.query.mock.calls[0][1]).toEqual(['CMD-OTHER', CID]);
  });

  test('belső sofőr KIOSZTVA → elutasítja', async () => {
    setUser(ADMIN);
    // Fuvar visszajön internal driver-rel (email_sofer NOT NULL)
    pool.query.mockResolvedValueOnce(rows([{
      id: 'CMD-1', company_id: CID, email_sofer: 'x@y.z',
      fuvar_no: 'CMD-2026-0001', load_type: 'FTL'
    }]));
    const res = await call('orderAssignmentGet', ['CMD-1']);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/sofer/i);
  });

  test('Extern fuvar: visszaadja az előtöltő snapshotot', async () => {
    setUser(ADMIN);
    pool.query
      // Fuvar + carrier join
      .mockResolvedValueOnce(rows([{
        id: 'CMD-1', company_id: CID, email_sofer: null, nume_sofer: null,
        fuvar_no: 'CMD-2026-0001', load_type: 'FTL', suly_kg: 22000, valuta: 'EUR',
        carrier_id: 42, carrier_cost: 1250,
        carrier_nev: 'ExtCarrier SRL', carrier_cui: 'RO123', carrier_reg_com: 'J40/1/2020',
        carrier_adresa: 'Str. Test 1', carrier_telefon: '+40711', carrier_email: 'e@c.ro',
        carrier_iban: 'RO12BANK', carrier_payment_term_days: 30
      }]))
      // order_stops
      .mockResolvedValueOnce(rows([
        { id: 10, kind: 'pickup', stop_index: 0, loc: 'Cluj', firma: 'A SRL', data: '2026-08-01', ref: null },
        { id: 11, kind: 'delivery', stop_index: 0, loc: 'Bucuresti', firma: 'B SRL', data: '2026-08-03', ref: null }
      ]))
      // companies + company_branding join
      .mockResolvedValueOnce(rows([{
        nev: 'VallorSoft SRL', igazgato_nev: 'John Doe', email_contact: 'admin@vs',
        telefon: '+40', cui: 'RO47', reg_com: 'J1/1/2023', adresa: 'Arcus',
        has_logo: true, has_stamp: true, brand_color: '#123'
      }]))
      // existing assignment
      .mockResolvedValueOnce(rows([]));
    const res = await call('orderAssignmentGet', ['CMD-1']);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.carrier.nev).toBe('ExtCarrier SRL');
    expect(res.body.result.stops).toHaveLength(2);
    expect(res.body.result.company.nev).toBe('VallorSoft SRL');
    expect(res.body.result.existing).toBe(null);
  });
});

// ── orderAssignmentSave — mező-validáció + tenant + upsert ──
describe('orderAssignmentSave', () => {
  test('cross-tenant: fuvar nem az admin cégéé → visszautasít', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([]));  // SELECT * FROM orders → nincs
    const res = await call('orderAssignmentSave', [{ order_id: 'CMD-OTHER' }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/gasit/i);
  });

  test('sofőr KIOSZTVA → elutasít', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([{ id: 'CMD-1', company_id: CID, email_sofer: 'a@b' }]));
    const res = await call('orderAssignmentSave', [{ order_id: 'CMD-1', number_source: 'auto' }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/sofer/i);
  });

  test('érvénytelen pénznem → elutasít', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([{ id: 'CMD-1', company_id: CID, email_sofer: null }]));
    const res = await call('orderAssignmentSave', [{ order_id: 'CMD-1', currency: 'euro' }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/[Mm]oneda/);
  });

  test('érvényes payload: új sor beszúrás (INSERT)', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([{ id: 'CMD-1', company_id: CID, email_sofer: null }]))       // orders own
      .mockResolvedValueOnce(rows([]))                                                          // existing (nincs) — az UPSERT előtti check
      .mockResolvedValueOnce(rows([{ id: 99 }]));                                               // INSERT
    const res = await call('orderAssignmentSave', [{
      order_id: 'CMD-1', number_source: 'auto',
      price: 1250, currency: 'EUR', payment_term_days: 30,
      fields: { vehicle: { tip_camion: 'CAP TRACTOR / 13.6 m' }, driver: { name: 'X', phone: '+40' } }
    }]);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.id).toBe(99);
    // A INSERT SQL company_id-t első paraméterek egyikeként kell tartalmaznia
    const insertCall = pool.query.mock.calls[2];
    expect(insertCall[0]).toMatch(/INSERT INTO order_assignments/);
    expect(insertCall[1][1]).toBe(CID);
  });

  test('érvényes payload: meglévő sor frissítés (UPDATE)', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([{ id: 'CMD-1', company_id: CID, email_sofer: null }]))       // orders own
      .mockResolvedValueOnce(rows([{ id: 5 }]))                                                 // existing
      .mockResolvedValueOnce(rows([{ id: 5 }]));                                                // UPDATE
    const res = await call('orderAssignmentSave', [{
      order_id: 'CMD-1', number_source: 'custom', custom_number: 'ORD-42'
    }]);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.id).toBe(5);
    expect(pool.query.mock.calls[2][0]).toMatch(/UPDATE order_assignments/);
  });

  test('custom_number kötelező, ha number_source=custom', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([{ id: 'CMD-1', company_id: CID, email_sofer: null }]));
    const res = await call('orderAssignmentSave', [{ order_id: 'CMD-1', number_source: 'custom', custom_number: '' }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/[Nn]umar/);
  });
});

// ── AttachToDocs cross-tenant védelem ─────────────────────
describe('orderAssignmentAttachToDocs', () => {
  test('cross-tenant fuvar → visszautasít, NEM INSERT-el', async () => {
    setUser(MANAGER);
    pool.query.mockResolvedValueOnce(rows([]));   // ownership → 0
    const res = await call('orderAssignmentAttachToDocs', [{ order_id: 'CMD-X', base64: 'JVBERi0=' }]);
    expect(res.body.result.ok).toBe(false);
    expect(pool.query).toHaveBeenCalledTimes(1);  // NEM INSERT-el
  });
});

// ── Delete: tenant-védelem ─────────────────────────────────
describe('orderAssignmentDelete', () => {
  test('nem létező sor → err', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([]));
    const res = await call('orderAssignmentDelete', ['CMD-1']);
    expect(res.body.result.ok).toBe(false);
  });
  test('törlés: company_id-szűrt DELETE', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([{ id: 7 }]));
    const res = await call('orderAssignmentDelete', ['CMD-1']);
    expect(res.body.result.ok).toBe(true);
    expect(pool.query.mock.calls[0][0]).toMatch(/DELETE FROM order_assignments/);
    expect(pool.query.mock.calls[0][1]).toEqual(['CMD-1', CID]);
  });
});
