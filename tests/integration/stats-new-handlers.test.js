// ============================================================
//  Új statisztikai handlerek szerep-kapu + válasz-alak (mock-DB):
//    - getVehicleIdleStats  (jármű állásidő üres napok)
//    - getServiceForecast   (szerviz-előrejelzés hetekben)
//    - getOrderFunnel       (fuvar-státusz funnel + átlagos idők)
//    - getCarrierApAging    (alvállalkozói AP-öregítés — jogosult)
//
//  Csak azt vizsgáljuk, hogy a szerep-védelem működik és a válasz-alak
//  megfelel a kliens-oldali várakozásoknak. Az SQL-eredményt a mock-db
//  szolgáltatja (a valós SQL-t a valós-DB fuvarlevelek-db.test.js fedi
//  külön). Így a fájl DB nélkül is fut (CI mock + valós-DB is zöld).
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
const SOFER = { ...fixtures.sofer, company_id: CID };
const MANAGER = { ...fixtures.manager, company_id: CID };

beforeEach(() => reset());

describe('getVehicleIdleStats', () => {
  test('Sofer NEM hívhatja', async () => {
    setUser(SOFER);
    const res = await call('getVehicleIdleStats', []);
    expect(res.body.result.ok).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('Admin: visszaadja a jarmuvek listát', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([
      { rendszam: 'B111ABC', gap_db: 5, atlag_nap: 2.4, ossz_ures_nap: 12, max_ures_nap: 6 },
      { rendszam: 'B222XYZ', gap_db: 3, atlag_nap: 0.8, ossz_ures_nap: 2, max_ures_nap: 1 },
    ]));
    const res = await call('getVehicleIdleStats', []);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.jarmuvek).toHaveLength(2);
    expect(res.body.result.jarmuvek[0].rendszam).toBe('B111ABC');
    // company_id kényszerítve: az első arg biztos $1=cid
    expect(pool.query.mock.calls[0][1][0]).toBe(CID);
  });
});

describe('getServiceForecast', () => {
  test('Sofer NEM hívhatja', async () => {
    setUser(SOFER);
    const res = await call('getServiceForecast', []);
    expect(res.body.result.ok).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('Admin: sürgős (≤2 hét) és figyelmeztető (≤6 hét) helyesen jelölve', async () => {
    setUser(ADMIN);
    // 1) svc query (utolsó szerviz-tétel jármű-id-nként)
    pool.query.mockResolvedValueOnce(rows([
      { vehicle_id: 1, service_date: '2026-05-01', utolso_szerviz_km: 100000, next_due_km: 110000, next_due_date: null },
      { vehicle_id: 2, service_date: '2026-06-01', utolso_szerviz_km: 200000, next_due_km: 220000, next_due_date: null },
    ]));
    // 2) km_R (havi átlag km az utolsó 90 napból)
    pool.query.mockResolvedValueOnce(rows([
      { rendszam: 'B111', km_90: 30000, wb_db: 30 },  // 10 000 km/hó
      { rendszam: 'B222', km_90: 3000,  wb_db: 3 },   // 1 000 km/hó
    ]));
    // 3) veh_R (jármű-törzs)
    pool.query.mockResolvedValueOnce(rows([
      { id: 1, rendszam: 'B111', rendszam_eredeti: 'B-111', marca: 'Volvo', model: 'FH', an: 2020 },
      { id: 2, rendszam: 'B222', rendszam_eredeti: 'B-222', marca: 'MAN', model: 'TGX', an: 2018 },
    ]));
    // 4) gps snapshot (aktuális km)
    pool.query.mockResolvedValueOnce(rows([
      { rendszam: 'B111', mileage: 108000 },  // 2000 km hátra, 10k/hó → ~0.87 hét — SÜRGŐS
      { rendszam: 'B222', mileage: 205000 },  // 15000 km hátra, 1k/hó → sok hét — normál
    ]));

    const res = await call('getServiceForecast', []);
    expect(res.body.result.ok).toBe(true);
    const veh = res.body.result.jarmuvek;
    expect(veh.length).toBe(2);
    // Rendezés: sürgős elöl
    expect(veh[0].rendszam).toBe('B-111');
    expect(veh[0].surgos).toBe(true);
    expect(veh[1].surgos).toBe(false);
  });
});

describe('getOrderFunnel', () => {
  test('Sofer NEM hívhatja', async () => {
    setUser(SOFER);
    const res = await call('getOrderFunnel', []);
    expect(res.body.result.ok).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('Admin: funnel + lepesek visszaadva a válasz-alakban', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([{
      ossz_alocat_ig: 10, avg_min_alocat_ig: 30,
      ossz_felrako_felrakas: 8, avg_min_felrako_felrakas: 45,
      ossz_felrakas_lerako: 6, avg_min_felrakas_lerako: 720,
      ossz_lerako_lerakas: 5, avg_min_lerako_lerakas: 60,
      ossz_teljes: 5, avg_ora_teljes: 14.5,
      db_kiirt: 20, db_felrakohoz: 15, db_felrakva: 12, db_lerakohoz: 8, db_leurit: 5
    }]));
    const res = await call('getOrderFunnel', []);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.funnel).toEqual({
      kiirt: 20, felrakohoz: 15, felrakva: 12, lerakohoz: 8, leurit: 5
    });
    expect(res.body.result.lepesek.alocat_ig).toEqual({ min: 30, db: 10 });
    expect(res.body.result.lepesek.felrakas_lerako).toEqual({ min: 720, db: 6 });
    expect(res.body.result.lepesek.teljes_ora).toEqual({ ora: 14.5, db: 5 });
  });

  test('Admin: null átlagok is átmennek (nincs adat)', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([{
      ossz_alocat_ig: 0, avg_min_alocat_ig: null,
      ossz_felrako_felrakas: 0, avg_min_felrako_felrakas: null,
      ossz_felrakas_lerako: 0, avg_min_felrakas_lerako: null,
      ossz_lerako_lerakas: 0, avg_min_lerako_lerakas: null,
      ossz_teljes: 0, avg_ora_teljes: null,
      db_kiirt: 0, db_felrakohoz: 0, db_felrakva: 0, db_lerakohoz: 0, db_leurit: 0
    }]));
    const res = await call('getOrderFunnel', []);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.lepesek.alocat_ig.min).toBe(null);
  });
});

describe('getCarrierApAging', () => {
  test('Sofer NEM hívhatja', async () => {
    setUser(SOFER);
    const res = await call('getCarrierApAging', []);
    expect(res.body.result.ok).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('Manager pénzügyi jog NÉLKÜL: forbidden=true', async () => {
    setUser(MANAGER);
    // Az _canSeeFinance a user_permissions táblát kérdi le
    pool.query.mockResolvedValueOnce(rows([]));  // nincs enabled sor
    const res = await call('getCarrierApAging', []);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.forbidden).toBe(true);
  });

  test('Admin: aging + lista visszaadva', async () => {
    setUser(ADMIN);
    // aging query
    pool.query.mockResolvedValueOnce(rows([{
      d0_30: '1200.00', d31_60: '500.00', d60p: '800.00',
      ossz_kintlevo: '2500.00', kintlevo_db: 4
    }]));
    // list query
    pool.query.mockResolvedValueOnce(rows([
      { id: 1, invoice_number: 'F-2026-0001', carrier_nev: 'Transporter SRL',
        amount: '1000', paid_amount: '0', currency: 'EUR', status: 'unpaid',
        issue_date: '2026-06-01', effective_due: '2026-07-01', keses_nap: 21 }
    ]));
    const res = await call('getCarrierApAging', []);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.aging.d0_30).toBe('1200.00');
    expect(res.body.result.lista).toHaveLength(1);
    expect(res.body.result.lista[0].invoice_number).toBe('F-2026-0001');
  });
});
