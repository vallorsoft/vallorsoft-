// ============================================================
//  Sofőr-funkciók handler-lefedettség (mock DB) — a #299/#300 kör
//  után „élesbe hibamentesen" kérésre. A már tesztelt handlerek
//  (getMySoferOrders, scanReceipt, handover-lánc, getMySoferStats
//  stb.) nincsenek duplikálva — lásd a saját suite-jaikat.
//
//  Fókusz: getMyAssignedVehicle, getLastVehicleReadings,
//  previewTripDiurna, receiptScan cég-oldali beállítások +
//  sofőr-oldali usable-check, GDPR privacy-notice.
// ============================================================
jest.mock('../../db', () => require('../helpers/db-mock').pool);

// A featureEnabled az receiptScan handlerekben egy DB-lekérdezéssel
// dolgozik — a mock-poolunk kiszolgálja, de a lib/featureEnabled
// belső cache-e (`_lastCacheKey`) fals-negatívot okoz teszt-fájlok
// között. A require-mockolás garantálja, hogy KAPUZATLANUL teljesítünk
// (a viselkedést a valós DB-integrációk tesztelik).
jest.mock('../../lib/featureEnabled', () => ({ featureEnabled: jest.fn(async () => true) }));
// Az audit a legtöbb írási úton best-effort; mock a lezárt fájlok
// közti kereszthatások (`audit_log`-táblahiány) miatt.
jest.mock('../../lib/audit', () => ({ fromReq: jest.fn(async () => {}) }));

const { reset, rows, pool } = require('../helpers/db-mock');
const orders = require('../../handlers/orders');
const documents = require('../../handlers/documents');
const receiptScan = require('../../handlers/receiptScan');
const gdpr = require('../../handlers/gdpr');

// A `previewTripDiurna` a `fetchTripCrossings` segédre épül — ezt a
// pool-mockon keresztül szolgálja ki. Egyetlen SELECT (a szabály +
// seed), az én stubom pontosan azt adja vissza, amit a lib kér.
jest.mock('../../lib/tripCrossings', () => ({
  fetchTripCrossings: jest.fn(async () => ({
    inWindow: [{ direction: 'OUT', crossed_at: '2026-07-01T09:00:00Z' }],
    forCalc: [{ direction: 'OUT', crossed_at: '2026-07-01T09:00:00Z' }]
  }))
}));

function makeRes() {
  const res = { body: null, statusCode: 200 };
  res.json = (o) => { res.body = o; return res; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.send = () => res;
  return res;
}
function reqAs(u, opts) { return Object.assign({ session: { user: u || null }, headers: {}, socket: {} }, opts || {}); }

const DRIVER  = { id: 10, email: 'sofor@ceg.hu', nume: 'Sofor', pozicio: 'Sofer',   company_id: 1 };
const MANAGER = { id: 20, email: 'mng@ceg.hu',   nume: 'Mngr',  pozicio: 'Manager', company_id: 1 };
const ADMIN   = { id: 30, email: 'adm@ceg.hu',   nume: 'Admin', pozicio: 'Admin',   company_id: 1 };

beforeEach(() => reset());

// ================================================================
//  getMyAssignedVehicle — a sofőrhöz rendelt vontató + alap-pótkocsi
// ================================================================
describe('getMyAssignedVehicle', () => {
  test('csak Sofer hívhatja — Admin/Manager NEM', async () => {
    const res1 = makeRes();
    await orders.getMyAssignedVehicle(reqAs(ADMIN), res1, []);
    expect(res1.body.result.ok).toBe(false);
    const res2 = makeRes();
    await orders.getMyAssignedVehicle(reqAs(MANAGER), res2, []);
    expect(res2.body.result.ok).toBe(false);
  });
  test('bejelentkezés nélkül → ok:false', async () => {
    const res = makeRes();
    await orders.getMyAssignedVehicle(reqAs(null), res, []);
    expect(res.body.result.ok).toBe(false);
  });
  test('nincs cég/email → ok:true, assigned:null (nem 500)', async () => {
    const res = makeRes();
    await orders.getMyAssignedVehicle(reqAs({ pozicio: 'Sofer' }), res, []);
    expect(res.body.result).toEqual({ ok: true, assigned: null });
    expect(pool.query).not.toHaveBeenCalled();
  });
  test('van hozzárendelt vontató + alap-pótkocsi → visszaadja', async () => {
    pool.query.mockResolvedValueOnce(rows([
      { rendszam_camion: 'B123', marca: 'MAN', model: 'TGX', rendszam_remorca: 'BP1' }
    ]));
    const res = makeRes();
    await orders.getMyAssignedVehicle(reqAs(DRIVER), res, []);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.assigned).toEqual({ rendszam_camion: 'B123', marca: 'MAN', model: 'TGX', rendszam_remorca: 'BP1' });
    // Cég + email a WHERE-ben (multi-tenant + kisbetűs illesztés)
    const params = pool.query.mock.calls[0][1];
    expect(params).toEqual([1, 'sofor@ceg.hu']);
  });
  test('email nagybetűvel a session-ben → lower-case illeszkedik', async () => {
    pool.query.mockResolvedValueOnce(rows([]));
    const res = makeRes();
    await orders.getMyAssignedVehicle(reqAs(Object.assign({}, DRIVER, { email: 'Sofor@CEG.hu' })), res, []);
    const params = pool.query.mock.calls[0][1];
    expect(params[1]).toBe('sofor@ceg.hu');
  });
  test('nincs találat → assigned:null, ok:true', async () => {
    pool.query.mockResolvedValueOnce(rows([]));
    const res = makeRes();
    await orders.getMyAssignedVehicle(reqAs(DRIVER), res, []);
    expect(res.body.result).toEqual({ ok: true, assigned: null });
  });
  test('DB-hiba → ok:false, nem 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'));
    const res = makeRes();
    await orders.getMyAssignedVehicle(reqAs(DRIVER), res, []);
    expect(res.body.result.ok).toBe(false);
  });
});

// ================================================================
//  getLastVehicleReadings — előző menetlevél záró km + fuel átvitel
// ================================================================
describe('getLastVehicleReadings', () => {
  test('idegen szerep (portál stb.) tiltva', async () => {
    const res = makeRes();
    await orders.getLastVehicleReadings(reqAs({ pozicio: 'Konyvelo', company_id: 1 }), res, ['B123']);
    expect(res.body.result.ok).toBe(false);
  });
  test('Sofer + Admin + Manager engedélyezett; üres rendszám → ok:true, fuel/km:null', async () => {
    for (const u of [DRIVER, ADMIN, MANAGER]) {
      const res = makeRes();
      await orders.getLastVehicleReadings(reqAs(u), res, ['']);
      expect(res.body.result).toEqual({ ok: true, fuel: null, km: null, level: null });
    }
    expect(pool.query).not.toHaveBeenCalled();
  });
  test('menetlevél-alapból ad fuel + km értéket + level=fuel backward-compat', async () => {
    pool.query.mockResolvedValueOnce(rows([{ fuel: 240, km: 456789, last_arr: '2026-07-01T12:00:00Z' }]));
    pool.query.mockResolvedValueOnce(rows([]));   // gps snapshot: nincs
    const res = makeRes();
    await orders.getLastVehicleReadings(reqAs(DRIVER), res, ['B 123']);
    expect(res.body.result).toEqual({ ok: true, fuel: 240, km: 456789, level: 240 });
    // A rendszám normalizálva („B 123" → „B123") kerül a query-be
    expect(pool.query.mock.calls[0][1]).toEqual([1, 'B123']);
  });
  test('újabb GPS snapshot felülírja a menetlevél-értékeket', async () => {
    pool.query.mockResolvedValueOnce(rows([{ fuel: 240, km: 456000, last_arr: '2026-07-01T12:00:00Z' }]));
    pool.query.mockResolvedValueOnce(rows([{ mileage: 456500, fuel_level: 260, snapped_at: '2026-07-05T23:59:00Z' }]));
    const res = makeRes();
    await orders.getLastVehicleReadings(reqAs(DRIVER), res, ['B123']);
    expect(res.body.result.km).toBe(456500);
    expect(res.body.result.fuel).toBe(260);
    expect(res.body.result.level).toBe(260);
  });
  test('régebbi GPS snapshot NEM írja felül a menetlevél-értékeket', async () => {
    pool.query.mockResolvedValueOnce(rows([{ fuel: 240, km: 456500, last_arr: '2026-07-05T23:59:00Z' }]));
    pool.query.mockResolvedValueOnce(rows([{ mileage: 456000, fuel_level: 220, snapped_at: '2026-07-01T00:00:00Z' }]));
    const res = makeRes();
    await orders.getLastVehicleReadings(reqAs(DRIVER), res, ['B123']);
    expect(res.body.result.km).toBe(456500);
    expect(res.body.result.fuel).toBe(240);
  });
  test('a snapshot-lekérdezés hibája nem buktatja a hívást (best-effort)', async () => {
    pool.query.mockResolvedValueOnce(rows([{ fuel: 240, km: 456000, last_arr: '2026-07-01T00:00:00Z' }]));
    pool.query.mockRejectedValueOnce(new Error('gps_month_end_snapshots does not exist'));
    const res = makeRes();
    await orders.getLastVehicleReadings(reqAs(DRIVER), res, ['B123']);
    expect(res.body.result).toEqual({ ok: true, fuel: 240, km: 456000, level: 240 });
  });
});

// ================================================================
//  previewTripDiurna — a diurna-ablak élő előnézete
// ================================================================
describe('previewTripDiurna', () => {
  test('bejelentkezés nélkül → ok:false', async () => {
    const res = makeRes();
    await documents.previewTripDiurna(reqAs(null), res, [{}]);
    expect(res.body.result.ok).toBe(false);
  });
  test('hiányzó indulás/érkezés dátum → ready:false, days:0 (nem hiba)', async () => {
    const res = makeRes();
    await documents.previewTripDiurna(reqAs(DRIVER), res, [{ indulasDt: '', erkezesDt: '' }]);
    expect(res.body.result).toEqual({ ok: true, ready: false, crossings: [], days: 0 });
  });
  test('sofőr válaszában NINCS externDays/internDays (csak Admin/Managernek látszik)', async () => {
    const res = makeRes();
    await documents.previewTripDiurna(reqAs(DRIVER), res, [{ indulasDt: '2026-07-01T08:00', erkezesDt: '2026-07-05T20:00' }]);
    expect(res.body.result.ready).toBe(true);
    expect(res.body.result).not.toHaveProperty('externDays');
    expect(res.body.result).not.toHaveProperty('internDays');
    expect(res.body.result.days).toBeGreaterThanOrEqual(0);
  });
  test('Admin/Manager válaszában externDays + internDays is benne van', async () => {
    for (const u of [ADMIN, MANAGER]) {
      const res = makeRes();
      await documents.previewTripDiurna(reqAs(u), res, [{ indulasDt: '2026-07-01T08:00', erkezesDt: '2026-07-05T20:00' }]);
      expect(res.body.result.ready).toBe(true);
      expect(res.body.result).toHaveProperty('externDays');
      expect(res.body.result).toHaveProperty('internDays');
    }
  });
});

// ================================================================
//  Bon-scan cég-beállítás (getBonScanSettings / setBonScanEnabled /
//  deleteBonScanSample) + sofőr-oldali usable-check.
// ================================================================
describe('bon-scan handlerek', () => {
  test('getBonScanSettings: Sofer TILTVA', async () => {
    const res = makeRes();
    await receiptScan.getBonScanSettings(reqAs(DRIVER), res);
    expect(res.body.result.ok).toBe(false);
    // Nincs DB-hívás sikertelen jogosultsági kapunál.
    expect(pool.query).not.toHaveBeenCalled();
  });
  test('getBonScanSettings: Admin — visszaadja az override-ot és a mintákat', async () => {
    pool.query.mockResolvedValueOnce(rows([{ enabled: true }]));     // company_features
    pool.query.mockResolvedValueOnce(rows([                          // receipt_scan_samples
      { id: 5, merchant_key: 'mol', merchant_label: 'MOL', fields: {}, sample_count: 3, updated_at: '2026-07-10' }
    ]));
    const res = makeRes();
    await receiptScan.getBonScanSettings(reqAs(ADMIN), res);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.override).toBe(true);
    expect(res.body.result.samples.length).toBe(1);
    expect(res.body.result.samples[0].merchant_key).toBe('mol');
  });
  test('getBonScanSettings: a samples-lekérdezés hibája nem buktatja el a választ', async () => {
    pool.query.mockResolvedValueOnce(rows([]));    // company_features üres
    pool.query.mockRejectedValueOnce(new Error('no such table receipt_scan_samples'));
    const res = makeRes();
    await receiptScan.getBonScanSettings(reqAs(ADMIN), res);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.samples).toEqual([]);
  });

  test('setBonScanEnabled: Sofer TILTVA', async () => {
    const res = makeRes();
    await receiptScan.setBonScanEnabled(reqAs(DRIVER), res, [{ key: 'ai-bon-scan', enabled: false }]);
    expect(res.body.result.ok).toBe(false);
  });
  test('setBonScanEnabled: Admin, ismeretlen kulcs → fehérlistára szűkül (`ai-bon-scan`)', async () => {
    pool.query.mockResolvedValueOnce(rows([]));   // upsert válasza
    const res = makeRes();
    await receiptScan.setBonScanEnabled(reqAs(ADMIN), res, [{ key: 'stats_finance', enabled: false }]);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.key).toBe('ai-bon-scan');   // NEM stats_finance — fehérlista védi
  });
  test('setBonScanEnabled: DB-hiba → err-lel visszatér, nem 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('company_features constraint failed'));
    const res = makeRes();
    await receiptScan.setBonScanEnabled(reqAs(ADMIN), res, [{ enabled: true }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/Eroare/);
  });

  test('getMyBonScanEnabled: bejelentkezés nélkül tilt', async () => {
    const res = makeRes();
    await receiptScan.getMyBonScanEnabled(reqAs(null), res);
    expect(res.body.result.ok).toBe(false);
  });
  test('getMyBonScanEnabled: idegen szerep (Konyvelo) tiltva', async () => {
    const res = makeRes();
    await receiptScan.getMyBonScanEnabled(reqAs({ pozicio: 'Konyvelo', company_id: 1 }), res);
    expect(res.body.result.ok).toBe(false);
  });
  test('getMyBonScanEnabled: Sofer + GEMINI_API_KEY → usable:true', async () => {
    const prev = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'AI...';
    try {
      const res = makeRes();
      await receiptScan.getMyBonScanEnabled(reqAs(DRIVER), res);
      expect(res.body.result.ok).toBe(true);
      expect(res.body.result.hasKey).toBe(true);
      expect(res.body.result.enabled).toBe(true);
      expect(res.body.result.usable).toBe(true);
    } finally { if (prev == null) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = prev; }
  });
  test('getMyBonScanEnabled: nincs kulcs → usable:false + hasKey:false (nem szivárog belső hibaüzenet)', async () => {
    const prev = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      const res = makeRes();
      await receiptScan.getMyBonScanEnabled(reqAs(DRIVER), res);
      expect(res.body.result.ok).toBe(true);
      expect(res.body.result.hasKey).toBe(false);
      expect(res.body.result.usable).toBe(false);
    } finally { if (prev != null) process.env.GEMINI_API_KEY = prev; }
  });

  test('deleteBonScanSample: Sofer TILTVA', async () => {
    const res = makeRes();
    await receiptScan.deleteBonScanSample(reqAs(DRIVER), res, [{ id: 5 }]);
    expect(res.body.result.ok).toBe(false);
  });
  test('deleteBonScanSample: érvénytelen id (0/negatív/NaN/string)', async () => {
    for (const bad of [0, -1, 'x', null, undefined]) {
      const res = makeRes();
      await receiptScan.deleteBonScanSample(reqAs(ADMIN), res, [{ id: bad }]);
      expect(res.body.result.ok).toBe(false);
      expect(res.body.result.err).toMatch(/ID/);
    }
    expect(pool.query).not.toHaveBeenCalled();
  });
  test('deleteBonScanSample: idegen cég mintája nincs törölve (rowCount=0)', async () => {
    pool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const res = makeRes();
    await receiptScan.deleteBonScanSample(reqAs(ADMIN), res, [{ id: 999 }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/nu aparține/i);
    // A WHERE-ben mindig ott a company_id — nincs cross-tenant törlés.
    expect(pool.query.mock.calls[0][1]).toEqual([999, 1]);
  });
  test('deleteBonScanSample: saját cég mintája törölhető', async () => {
    pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const res = makeRes();
    await receiptScan.deleteBonScanSample(reqAs(ADMIN), res, [{ id: 5 }]);
    expect(res.body.result).toEqual({ ok: true, deleted: 1 });
  });
});

// ================================================================
//  GDPR privacy notice: getMyPrivacyNotice + ackPrivacyNotice
// ================================================================
describe('GDPR privacy notice', () => {
  test('getMyPrivacyNotice: bejelentkezés nélkül tilt', async () => {
    const res = makeRes();
    await gdpr.getMyPrivacyNotice(reqAs(null), res);
    expect(res.body.result.ok).toBe(false);
  });
  test('getMyPrivacyNotice: nincs beállított notice → notice:null', async () => {
    pool.query.mockResolvedValueOnce(rows([]));
    const res = makeRes();
    await gdpr.getMyPrivacyNotice(reqAs(DRIVER), res);
    expect(res.body.result).toEqual({ ok: true, notice: null });
  });
  test('getMyPrivacyNotice: van notice + friss ack → acknowledged:true', async () => {
    pool.query.mockResolvedValueOnce(rows([{
      privacy_notice: 'GPS-t rögzítünk munkaidőben', dpo_contact: 'dpo@x.hu',
      gps_business_only: true, updated_at: '2026-07-01T00:00:00Z'
    }]));
    pool.query.mockResolvedValueOnce(rows([{ acknowledged_at: '2026-07-02T00:00:00Z' }]));
    const res = makeRes();
    await gdpr.getMyPrivacyNotice(reqAs(DRIVER), res);
    expect(res.body.result.acknowledged).toBe(true);
    expect(res.body.result.notice).toMatch(/GPS/);
  });
  test('getMyPrivacyNotice: régi ack az UJABB frissítéshez képest → acknowledged:false', async () => {
    pool.query.mockResolvedValueOnce(rows([{
      privacy_notice: 'v2 szöveg', dpo_contact: null, gps_business_only: true,
      updated_at: '2026-07-10T00:00:00Z'
    }]));
    pool.query.mockResolvedValueOnce(rows([{ acknowledged_at: '2026-07-05T00:00:00Z' }]));
    const res = makeRes();
    await gdpr.getMyPrivacyNotice(reqAs(DRIVER), res);
    expect(res.body.result.acknowledged).toBe(false);
  });
  test('ackPrivacyNotice: bejelentkezés nélkül tilt', async () => {
    const res = makeRes();
    await gdpr.ackPrivacyNotice(reqAs(null), res);
    expect(res.body.result.ok).toBe(false);
  });
  test('ackPrivacyNotice: rögzíti a company_id + user_id + kind = privacy_notice sort', async () => {
    pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const req = reqAs(DRIVER, { headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } });
    const res = makeRes();
    await gdpr.ackPrivacyNotice(req, res);
    expect(res.body.result.ok).toBe(true);
    const params = pool.query.mock.calls[0][1];
    expect(params[0]).toBe(1);              // company_id
    expect(params[1]).toBe(10);             // user_id
    expect(params[2]).toBe('privacy_notice');
    expect(params[3]).toBe('1.2.3.4');      // első X-Forwarded-For IP
  });
});
