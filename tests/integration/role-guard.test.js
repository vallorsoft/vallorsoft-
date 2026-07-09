// ============================================================
//  Role-guard sweep — szerep-alapú védőháló
//
//  Minden magas kockázatú ír-handlerre: (1) session nélkül 401,
//  (2) Sofer szerep esetén ok:false ÉS a DB-t NEM érinti (a szerep-check
//  a query előtt visszautasít). Így ha valaki elfelejt egy pozicio-
//  ellenőrzést egy új handlerben, ez a suite azonnal piros.
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

function call(functionName, args) {
  return request(app).post('/api/execute').send({ functionName, arguments: args });
}

beforeEach(() => reset());

// Az összes írás/módosítás-handler, amit Admin/Manager kap. A hívás
// arg-jai szándékosan „ártalmatlanok" (érvényes szerkezet, de az ID-k
// hamisak) — a szerep-check előbb elutasít.
const WRITE_HANDLERS = [
  ['comCreate',        [{ client: 'X', loc_incarcare: 'A', loc_descarcare: 'B' }]],
  ['comUpdate',        ['CMD-X', { pret: 1 }]],
  ['comDelete',        ['CMD-X']],
  ['addOrderLeg',      ['CMD-X', { sofer_type: 'Intern', email_sofer: 'a@a.hu' }]],
  ['deleteOrderLeg',   [1]],
  ['orderDocUpload',   ['CMD-X', 'file.pdf', 'BASE64']],
  ['orderDocSaveSigned', [1, 'BASE64']],
  ['fuvarlevelUpdate', [1, {}]],
  ['fuvarlevelCreate', [{}]],
  ['vehicleCreate',    [{ rendszam: 'X1', tip: 'Vontato' }]],
  ['vehicleUpdate',    [1, { rendszam: 'X1' }]],
  ['vehicleDelete',    [1]],
  ['extDriverCreate',  [{ nume: 'X', firma: 'Y' }]],
  ['extDriverUpdate',  [1, { nume: 'X' }]],
  ['extDriverDelete',  [1]],
  ['assignDriverVehicle', [1, 'a@a.hu']],
  ['assignDefaultTrailer', [1, 2]],
  ['carrierSave',      [{ nume: 'X', cui: 'RO123' }]],
  ['carrierDelete',    [1]],
  ['carrierSetGroup',  [1, null]],
  ['carrierGroupSave', [{ name: 'X' }]],
  ['carrierGroupDelete', [1]],
  ['carrierInvoiceSave', [{ carrier_id: 1, invoice_no: 'X', amount: 1 }]],
  ['carrierInvoicePayment', [{ id: 1, amount: 1 }]],
  ['carrierInvoiceDelete', [1]],
  ['carrierPortalInvite', [{ carrier_id: 1, email: 'x@x.hu' }]],
  ['carrierPortalSetActive', [{ user_id: 1, active: false }]],
  ['carrierDocUploadAdmin', [1, 'file.pdf', 'BASE64']],
  ['ecmrCreate',       [123]],
  ['ecmrSign',         [{ ecmr_id: 1, party: 'sender', name: 'X' }]],
  ['favLocationSave',  [{ label: 'X', address: 'Y' }]],
  ['favLocationDelete', [1]],
  ['quoteSave',        [{ client_name: 'X' }]],
  ['quoteSetStatus',   [{ id: 1, status: 'sent' }]],
  ['quoteToOrder',     [{ id: 1 }]],
];

describe('Role-guard sweep — szerep-alapú védőháló', () => {

  describe('session nélkül minden ír-handler 401', () => {
    test.each(WRITE_HANDLERS)('%s → 401', async (fn, args) => {
      setUser(null);
      const res = await call(fn, args);
      expect(res.status).toBe(401);
      expect(pool.query).not.toHaveBeenCalled();
    });
  });

  describe('Sofer szerep → ok:false ÉS DB-t NEM érinti', () => {
    // A Sofer felhasználó csak sofőr-specifikus végpontokat használ
    // (sofer.js). Bármely Admin/Manager ír-handlernek DB-érintés nélkül
    // el kell utasítania.
    test.each(WRITE_HANDLERS)('%s → ok:false, 0 DB-hívás', async (fn, args) => {
      setUser({ ...fixtures.sofer, company_id: 1 });
      const res = await call(fn, args);
      expect(res.status).toBe(200);
      expect(res.body.result).toBeDefined();
      // A handler ok:false-t ad. A ritka kivétel (pl. valamiért ok:true
      // egy readonly branch-en) is elfogadható, de DB-hívás semmiképp nem
      // futhat.
      expect(res.body.result.ok !== true).toBe(true);
      expect(pool.query).not.toHaveBeenCalled();
    });
  });

  // Külön nagyobb hangsúllyal a KRITIKUS handlereken (AUDIT.md #11)
  describe('Kritikus handlerek — RO hibaüzenettel utasítanak el', () => {
    const CRITICAL = [
      ['orderDocUpload', ['CMD-X', 'x.pdf', 'BASE64']],
      ['ecmrCreate',     [1]],
      ['comDelete',      ['CMD-X']],
      ['vehicleDelete',  [1]],
    ];

    test.each(CRITICAL)('%s Sofer → RO „interzis" üzenet', async (fn, args) => {
      setUser({ ...fixtures.sofer, company_id: 1 });
      const res = await call(fn, args);
      expect(res.body.result.ok).toBe(false);
      expect(String(res.body.result.err || '')).toMatch(/interzis|autentif/i);
    });
  });
});
