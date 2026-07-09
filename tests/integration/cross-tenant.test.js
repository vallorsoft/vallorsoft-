// ============================================================
//  Cross-tenant regresszió-suite — multi-tenant izoláció ellenőrzése
//
//  Cél: minden ír-műveletnél („A" cég Admin/Manager userje próbál „B" cég
//  entitására írni) a handler ok:false-t adjon vissza — NE módosítsa a
//  másik tenant adatait. A mock DB úgy szimulálja B cég entitásait,
//  hogy az A cég company_id-jével futó ownership-lekérdezés 0 sort ad,
//  vagy a végső UPDATE/DELETE rowCount=0-t.
//
//  Motiváció: az AUDIT.md 11. lépése egy KRITIKUS cross-tenant írási
//  hibát tárt fel (`orderDocUpload` — kliens-megadta orderId INSERT
//  ownership-check nélkül). A javítás megtörtént; ez a suite biztosítja,
//  hogy a jövőben egyetlen ír-művelet se csússzon vissza védtelen
//  állapotba.
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

// A hívó a company_id=1 (Admin cégA). A védendő entitás a company_id=2
// (cégB) alá tartozik — a session szűrője miatt A nem éri el.
const CID_A = 1;
const CID_B = 2;
const ADMIN_A = { ...fixtures.admin, company_id: CID_A };
const MANAGER_A = { ...fixtures.manager, company_id: CID_A };

// Segéd: /api/execute hívás
function callExecute(functionName, args) {
  return request(app)
    .post('/api/execute')
    .send({ functionName, arguments: args });
}

// A cross-tenant válasz-mintázat: a session szűrő miatt üres ownership
// (0 sor) vagy 0 rowCount. A handler „nu a fost gasit" / „nu a fost găsit"
// / „acces interzis" jellegű RO hibaüzenetet ad — de a fontos: ok=false
// ÉS soha nem sikeres ír-művelet.
function expectDenied(res) {
  expect(res.status).toBe(200);
  expect(res.body.result.ok).toBe(false);
  // Elfogadható tenant-elutasítás jelzések (bármelyik illeszkedik)
  expect(String(res.body.result.err || '')).toMatch(
    /gasit|găsit|interzis|not.?found|acces/i
  );
}

beforeEach(() => reset());

describe('Cross-tenant regresszió — Admin/Manager NEM írhat idegen cég entitására', () => {

  // ─── orders (comUpdate) ───────────────────────────────────────
  // A comUpdate ELŐSZÖR ellenőrzi az ownership-et (SELECT status …
  // WHERE id=$1 AND company_id=$2). Idegen cég fuvarjánál 0 sor →
  // „Transportul nu a fost gasit sau acces interzis".
  test('comUpdate — idegen cég fuvarját nem lehet módosítani', async () => {
    setUser(ADMIN_A);
    // Az ownership-SELECT üres eredményt ad (A cég company_id-jével nézve
    // B cég fuvarja láthatatlan)
    pool.query.mockResolvedValueOnce(rows([]));
    const res = await callExecute('comUpdate', [
      'CMD-BELONGS-TO-B',
      { pret: 999999 }
    ]);
    expectDenied(res);
    // Nem lehet, hogy UPDATE SQL is elindult volna — pontosan 1 query (SELECT)
    expect(pool.query).toHaveBeenCalledTimes(1);
    const firstCall = pool.query.mock.calls[0];
    expect(String(firstCall[0])).toMatch(/^\s*SELECT status FROM orders/i);
    expect(firstCall[1]).toEqual(['CMD-BELONGS-TO-B', CID_A]);
  });

  // ─── orders (comDelete) ───────────────────────────────────────
  test('comDelete — idegen cég fuvarját nem lehet anulálni', async () => {
    setUser(ADMIN_A);
    pool.query.mockResolvedValueOnce(rows([])); // ownership SELECT üres
    const res = await callExecute('comDelete', ['CMD-BELONGS-TO-B']);
    expectDenied(res);
    // Semmi UPDATE nem futhatott
    expect(pool.query).toHaveBeenCalledTimes(1);
    const firstCall = pool.query.mock.calls[0];
    expect(String(firstCall[0])).toMatch(/SELECT id, status FROM orders/i);
    expect(firstCall[1]).toEqual(['CMD-BELONGS-TO-B', CID_A]);
  });

  // ─── documents (orderDocUpload) — AUDIT.md #11 REGRESSZIÓ ────
  // Ez volt a KRITIKUS találat: eddig a handler ownership-check nélkül
  // szúrt be. A fix után SELECT-tel ellenőrzi az orders tulajdonjogát.
  test('orderDocUpload — AUDIT.md #11 REGRESSZIÓ — idegen cég fuvarjához nem lehet dokumentumot fűzni', async () => {
    setUser(ADMIN_A);
    // Az ownership SELECT üres → INSERT nem futhat
    pool.query.mockResolvedValueOnce(rows([]));
    const res = await callExecute('orderDocUpload', [
      'CMD-BELONGS-TO-B',
      'malicious.pdf',
      'BASE64DATA'
    ]);
    expectDenied(res);
    // KRITIKUS: pontosan 1 query (a SELECT) — INSERT nem futhatott le.
    expect(pool.query).toHaveBeenCalledTimes(1);
    const firstCall = pool.query.mock.calls[0];
    expect(String(firstCall[0])).toMatch(/SELECT 1 FROM orders/i);
    expect(firstCall[1]).toEqual(['CMD-BELONGS-TO-B', CID_A]);
    // Semmi INSERT nem futhatott
    for (const [sql] of pool.query.mock.calls) {
      expect(String(sql)).not.toMatch(/INSERT INTO order_documents/i);
    }
  });

  // ─── fleet (vehicleUpdate) ────────────────────────────────────
  // A jármű-update WHERE id=$X AND company_id=$Y — a rowCount=0 jelzi
  // az idegen tenant kísérletet.
  test('vehicleUpdate — idegen cég járművét nem lehet módosítani', async () => {
    setUser(ADMIN_A);
    // Az UPDATE végrehajt, de 0 sort talál (id létezik ugyan, de más cégé)
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await callExecute('vehicleUpdate', [
      9999,
      { rendszam: 'HACK-01', tip: 'Vontato' }
    ]);
    expectDenied(res);
    // Az UPDATE SQL a company_id-t is tartalmazza
    const firstCall = pool.query.mock.calls[0];
    expect(String(firstCall[0])).toMatch(/UPDATE vehicles.*company_id/is);
  });

  // ─── fleet (vehicleDelete) ────────────────────────────────────
  test('vehicleDelete — idegen cég járművét nem lehet törölni', async () => {
    setUser(ADMIN_A);
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await callExecute('vehicleDelete', [9999]);
    expectDenied(res);
    const firstCall = pool.query.mock.calls[0];
    expect(String(firstCall[0])).toMatch(/DELETE FROM vehicles.*company_id/is);
    expect(firstCall[1]).toEqual([9999, CID_A]);
  });

  // ─── documents (fuvarlevelUpdate) ─────────────────────────────
  // Sub-select szűrő: id létezhet, de email_sofer NEM a cégA userei közül
  // való → ownership-check üres → elutasítás UPDATE nélkül.
  test('fuvarlevelUpdate — idegen cég menetlevelét nem lehet módosítani', async () => {
    setUser(ADMIN_A);
    pool.query.mockResolvedValueOnce(rows([])); // ownership SELECT üres
    const res = await callExecute('fuvarlevelUpdate', [
      12345,
      { km_inceput: 0, km_sfarsit: 999999 }
    ]);
    expectDenied(res);
    // Csak a SELECT futhatott le — semmi UPDATE
    expect(pool.query).toHaveBeenCalledTimes(1);
    const firstCall = pool.query.mock.calls[0];
    expect(String(firstCall[0])).toMatch(/^\s*SELECT id FROM fuvarlevelek/i);
    expect(firstCall[1]).toEqual([12345, CID_A]);
  });

  // ─── quotes (quoteSave — update ág) ───────────────────────────
  // A quoteSave update ágban ownership SELECT + UPDATE. Idegen cég
  // ajánlata láthatatlan → SELECT üres → nincs UPDATE.
  test('quoteSave — idegen cég árajánlatát nem lehet módosítani', async () => {
    setUser(ADMIN_A);
    pool.query.mockResolvedValueOnce(rows([])); // ownership SELECT üres
    const res = await callExecute('quoteSave', [
      { id: 555, client_name: 'Hacker Kft', loc_from: 'X', loc_to: 'Y', price: 1 }
    ]);
    expectDenied(res);
    expect(pool.query).toHaveBeenCalledTimes(1);
    const firstCall = pool.query.mock.calls[0];
    expect(String(firstCall[0])).toMatch(/SELECT id FROM quotes.*company_id/i);
  });

  // ─── quotes (quoteSetStatus) ──────────────────────────────────
  // A quoteSetStatus egyetlen UPDATE-tel megy — a rowCount=0 az elutasítás.
  test('quoteSetStatus — idegen cég ajánlatának státuszát nem lehet változtatni', async () => {
    setUser(ADMIN_A);
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await callExecute('quoteSetStatus', [{ id: 555, status: 'awarded' }]);
    expectDenied(res);
    const firstCall = pool.query.mock.calls[0];
    expect(String(firstCall[0])).toMatch(/UPDATE quotes.*company_id/is);
  });

  // ─── carriers (carrierSetGroup) ───────────────────────────────
  // Két ownership-check: carrier + group. Ha az alvállalkozó B cégé →
  // első SELECT üres, semmi UPDATE.
  test('carrierSetGroup — idegen cég alvállalkozóját nem lehet másik csoportba tenni', async () => {
    setUser(ADMIN_A);
    pool.query.mockResolvedValueOnce(rows([])); // carrier ownership üres
    const res = await callExecute('carrierSetGroup', [777, 10]);
    expectDenied(res);
    // Csak 1 query — a második (group) SELECT sem futhatott, mert az első
    // már elbukott
    expect(pool.query).toHaveBeenCalledTimes(1);
    const firstCall = pool.query.mock.calls[0];
    expect(String(firstCall[0])).toMatch(/SELECT id FROM carriers.*company_id/i);
  });

  // ─── ecmr (ecmrCreate) ────────────────────────────────────────
  // Ugyanaz a minta, mint az orderDocUpload-fix (AUDIT #11) —
  // ELŐSZÖR SELECT az orders-en, csak utána INSERT.
  test('ecmrCreate — idegen cég fuvarjához nem lehet e-CMR-t létrehozni', async () => {
    setUser(ADMIN_A);
    pool.query.mockResolvedValueOnce(rows([])); // ownership SELECT üres
    const res = await callExecute('ecmrCreate', [1234]);
    expectDenied(res);
    // Pontosan 1 query — az INSERT nem futhatott
    expect(pool.query).toHaveBeenCalledTimes(1);
    const firstCall = pool.query.mock.calls[0];
    expect(String(firstCall[0])).toMatch(/SELECT 1 FROM orders/i);
    for (const [sql] of pool.query.mock.calls) {
      expect(String(sql)).not.toMatch(/INSERT INTO order_ecmr/i);
    }
  });

  // ─── ecmr (ecmrSign) ──────────────────────────────────────────
  // Egyetlen UPDATE RETURNING; rowCount=0 (üres RETURNING) → elutasítás.
  test('ecmrSign — idegen cég e-CMR-ját nem lehet aláírni', async () => {
    setUser(ADMIN_A);
    pool.query.mockResolvedValueOnce(rows([])); // UPDATE RETURNING üres
    const res = await callExecute('ecmrSign', [{
      ecmr_id: 999,
      party: 'sender',
      name: 'Fake Sender'
    }]);
    expectDenied(res);
    const firstCall = pool.query.mock.calls[0];
    expect(String(firstCall[0])).toMatch(/UPDATE order_ecmr.*company_id/is);
  });

  // ─── favLocations (favLocationSave — update ág) ───────────────
  // A favLocationSave update ág WHERE id/company_id — rowCount=0 esetén
  // „Nu a fost găsit".
  test('favLocationSave — idegen cég kedvenc helyszínét nem lehet módosítani', async () => {
    setUser(ADMIN_A);
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await callExecute('favLocationSave', [{
      id: 42,
      label: 'Hacked',
      address: 'Malicious address'
    }]);
    expectDenied(res);
    const firstCall = pool.query.mock.calls[0];
    expect(String(firstCall[0])).toMatch(/UPDATE favorite_locations.*company_id/is);
  });

  // ─── favLocations (favLocationDelete) ─────────────────────────
  test('favLocationDelete — idegen cég kedvenc helyszínét nem lehet törölni', async () => {
    setUser(ADMIN_A);
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await callExecute('favLocationDelete', [42]);
    // A favLocationDelete kecsesen ok:!!rowCount-ot ad vissza; rowCount=0
    // → ok:false (nem hiba, csak nincs mit törölni — ami helyes viselkedés)
    expect(res.status).toBe(200);
    expect(res.body.result.ok).toBe(false);
    const firstCall = pool.query.mock.calls[0];
    expect(String(firstCall[0])).toMatch(/DELETE FROM favorite_locations.*company_id/is);
    expect(firstCall[1]).toEqual([42, CID_A]);
  });

  // ─── Manager szerep — ugyanez a védelem érvényes ──────────────
  // Nem elég csak Admin-nal tesztelni; a Manager is Admin-hoz hasonló
  // ír-jogokkal bír a fuvar-módosításnál. A tenant-szűrésnek Managerre
  // is ugyanígy meg kell fognia.
  test('comUpdate — Manager szintén nem írhat idegen cég fuvarjára', async () => {
    setUser(MANAGER_A);
    pool.query.mockResolvedValueOnce(rows([]));
    const res = await callExecute('comUpdate', [
      'CMD-BELONGS-TO-B',
      { pret: 1 }
    ]);
    expectDenied(res);
  });

  // ─── Sofer szerep — még olvasás sem, írás pláne ───────────────
  // Extra védőháló: nem-Admin/Manager egyszerűen szerep-alapon el kell
  // hasaljon. Ha ez elromlik (pl. valaki elfelejt egy pozicio-check-et),
  // ez a teszt azonnal piros.
  test('comUpdate — Sofer szerep 403 (nem kellene DB-t sem érintenie)', async () => {
    setUser({ ...fixtures.sofer, company_id: CID_A });
    const res = await callExecute('comUpdate', ['CMD-XYZ', { pret: 1 }]);
    expect(res.status).toBe(200);
    expect(res.body.result.ok).toBe(false);
    expect(String(res.body.result.err || '')).toMatch(/interzis/i);
    // Semmi DB-lekérdezés — a szerep-check előre elutasította
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('orderDocUpload — Sofer szerep sem kerülheti meg a tenant-védelmet', async () => {
    setUser({ ...fixtures.sofer, company_id: CID_A });
    const res = await callExecute('orderDocUpload', [
      'CMD-BELONGS-TO-B',
      'x.pdf',
      'BASE64'
    ]);
    expect(res.status).toBe(200);
    expect(res.body.result.ok).toBe(false);
    expect(String(res.body.result.err || '')).toMatch(/interzis/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  // ─── Session nélkül minden 401 ──────────────────────────────
  test('/api/execute — session nélkül 401 minden ír-műveletre', async () => {
    setUser(null);
    const res = await callExecute('comUpdate', ['CMD-X', { pret: 1 }]);
    expect(res.status).toBe(401);
    expect(pool.query).not.toHaveBeenCalled();
  });
});
