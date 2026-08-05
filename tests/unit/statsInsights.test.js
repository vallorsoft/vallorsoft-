// ============================================================
//  Unit-teszt — handlers/statsInsights.js
//  Az anomália-aggregátor kapuit, adatszivárgás-védelmét és a
//  rendezést/összefésülést teszteljük mock DB-vel.
// ============================================================
jest.mock('../../db', () => require('../helpers/db-mock').pool);

const { pool, rows, reset } = require('../helpers/db-mock');
const H = require('../../handlers/statsInsights');

function call(fn, user, args) {
  return new Promise((resolve) => {
    const req = { session: { user } };
    const res = { json: (payload) => resolve(payload) };
    fn(req, res, args);
  });
}

const ADMIN   = { id: 1, email: 'a@x', pozicio: 'Admin',   company_id: 1 };
const MANAGER = { id: 2, email: 'm@x', pozicio: 'Manager', company_id: 1 };
const SOFER   = { id: 3, email: 's@x', pozicio: 'Sofer',   company_id: 1 };

// A handler 5 párhuzamos forrás-lekérdezést + esetleg 2 pénzügyit indít.
// A sorrend a Promise.all([fuel, service, expiry, uitExp, uitMiss])-tól függ,
// és a service-blokk maga 3-4 query-t hív belül. Ezért az egyszerűség kedvéért
// mockResolvedValue-t (default rows([])) használunk, és mockResolvedValueOnce
// csak a konkrét teszt-adatokra.

function defaultEmptyDb() {
  pool.query.mockResolvedValue(rows([]));
}

beforeEach(() => {
  reset();
  defaultEmptyDb();
});

describe('getStatsInsights — szerep-védelem', () => {
  test('Sofer tiltva', async () => {
    const r = await call(H.getStatsInsights, SOFER);
    expect(r.result.ok).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('Manager engedélyezve (nem pénzügyi mutatók)', async () => {
    // Manager _canSeeFinance: user_permissions üres → false
    const r = await call(H.getStatsInsights, MANAGER);
    expect(r.result.ok).toBe(true);
    expect(r.result.can_finance).toBe(false);
    expect(Array.isArray(r.result.insights)).toBe(true);
  });

  test('Admin — pénzügyi mutatókat is kapja', async () => {
    const r = await call(H.getStatsInsights, ADMIN);
    expect(r.result.ok).toBe(true);
    expect(r.result.can_finance).toBe(true);
  });
});

describe('getStatsInsights — összefésülés és rendezés', () => {
  test('üres források → üres lista + 0 összesítés', async () => {
    const r = await call(H.getStatsInsights, ADMIN);
    expect(r.result.ok).toBe(true);
    expect(r.result.insights).toEqual([]);
    expect(r.result.count_by_severity).toEqual({ danger: 0, warn: 0, info: 0 });
    expect(r.result.count_by_area).toEqual({ finance: 0, fleet: 0, ops: 0, people: 0 });
  });

  test('rendezés: danger > warn > info; value csökkenőleg egy severity-ben', async () => {
    reset();
    // A service-blokk svcR üresen early-return-öl, így vehR/gpsMap/kmR NEM fut.
    // Ténylegesen konzumált query-sorrend: fuel, svcR, expiry, uitExp, uitMiss, overdue, aging
    pool.query.mockResolvedValueOnce(rows([
      { rendszam: 'B-100', km: 1000, motorina: 400, nevleges: 25 },   // 40 L/100km, dev=0.6 → danger
      { rendszam: 'B-200', km: 1000, motorina: 300, nevleges: 25 },   // 30 L/100km, dev=0.2 → warn
    ]));   // fuel
    pool.query.mockResolvedValueOnce(rows([]));    // svcR (empty → early return)
    pool.query.mockResolvedValueOnce(rows([
      { id: 5, entity_type: 'vehicle', entity_label: 'B-300', doc_type: 'ITP', days_left: 20 },  // warn (30 nap alatt)
    ]));   // expiry
    pool.query.mockResolvedValueOnce(rows([]));    // uitExp
    pool.query.mockResolvedValueOnce(rows([]));    // uitMiss
    pool.query.mockResolvedValueOnce(rows([{ db: 0, osszeg: 0 }]));                 // overdue
    pool.query.mockResolvedValueOnce(rows([{ d60p: 0, d31_60: 0, db_60p: 0 }]));    // aging

    const r = await call(H.getStatsInsights, ADMIN);
    expect(r.result.ok).toBe(true);
    // Elvárt: első a danger (B-100 40 L/100km), utána warn-ek value szerint csökkenő (B-200 30 > expiry 20)
    expect(r.result.insights[0].severity).toBe('danger');
    expect(r.result.insights[0].title).toBe('B-100');
    expect(r.result.insights[1].severity).toBe('warn');
    expect(r.result.count_by_severity.danger).toBe(1);
    expect(r.result.count_by_severity.warn).toBe(2);
    expect(r.result.count_by_area.fleet).toBe(3);
  });

  test('Manager: pénzügyi forrás NEM fut le', async () => {
    reset();
    // _canSeeFinance query (1) + 5 forrás (fuel, svcR-early, expiry, uitExp, uitMiss).
    // A finance-blokk NEM fut, mert Manager perms üres.
    for (let i = 0; i < 6; i++) pool.query.mockResolvedValueOnce(rows([]));
    const r = await call(H.getStatsInsights, MANAGER);
    expect(r.result.ok).toBe(true);
    expect(r.result.can_finance).toBe(false);
    expect(r.result.insights.some(i => i.area === 'finance')).toBe(false);
  });

  test('Admin: kintlévőség & AP 60+ danger', async () => {
    reset();
    // A service svcR üresen early-return-öl → vehR/gpsMap/kmR nem fut.
    // Konzumált sorrend: fuel, svcR, expiry, uitExp, uitMiss, overdue, aging.
    pool.query.mockResolvedValueOnce(rows([])); // fuel
    pool.query.mockResolvedValueOnce(rows([])); // svcR (early return)
    pool.query.mockResolvedValueOnce(rows([])); // expiry
    pool.query.mockResolvedValueOnce(rows([])); // uitExp
    pool.query.mockResolvedValueOnce(rows([])); // uitMiss
    pool.query.mockResolvedValueOnce(rows([{ db: 3, osszeg: 15000 }])); // overdue
    pool.query.mockResolvedValueOnce(rows([{ d60p: 5000, d31_60: 2000, db_60p: 2 }])); // aging

    const r = await call(H.getStatsInsights, ADMIN);
    expect(r.result.ok).toBe(true);
    const financeItems = r.result.insights.filter(i => i.area === 'finance');
    expect(financeItems.length).toBe(3); // overdue + AP60p + AP31-60
    expect(financeItems.filter(i => i.severity === 'danger').length).toBe(2);
    expect(financeItems.filter(i => i.severity === 'warn').length).toBe(1);
  });

  test('multi-tenant: minden query company_id-vel indul', async () => {
    reset();
    for (let i = 0; i < 10; i++) pool.query.mockResolvedValueOnce(rows([]));
    await call(H.getStatsInsights, ADMIN);
    pool.query.mock.calls.forEach(([sql, params]) => {
      if (params && params.length) {
        // A cégre szűrő paraméter minden hívásnál 1 (ADMIN.company_id)
        expect(params[0]).toBe(1);
      }
    });
  });
});
