// ============================================================
//  Read-only aggregátorok — dashboard, opsCenter, entityDetail,
//  ordersDone, bnr, globalSearch
//
//  Ellenőrizzük: szerep-kapu, company_id-szűrés, tulajdonjog-védelem
//  (ownership check ELSŐ query-ben), és a bemenet-limitek (limit clamp,
//  keresőszó min. hossz).
// ============================================================
jest.mock('../../db', () => require('../helpers/db-mock').pool);

// getPositions külső API-t hív — teljes no-op stub.
jest.mock('../../lib/vehiclePositions', () => ({
  getPositions: jest.fn(async () => ({ positions: [], cached: false })),
}));
jest.mock('../../services/bnr', () => ({
  fetchBnrEurRon: jest.fn(async () => 4.98),
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

beforeEach(() => reset());

// ═══ dashStats ═══════════════════════════════════════════════
describe('dashStats', () => {
  test('Sofer NEM hívhatja', async () => {
    setUser(SOFER);
    const res = await call('dashStats', []);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/interzis/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('Admin: 5 db lekérdezés + cégnév', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([{ status: 'Alocat', db: 3 }]))         // statuszok
      .mockResolvedValueOnce(rows([{ ho: '2026-06', osszeg: 15000 }]))    // havi bevétel
      .mockResolvedValueOnce(rows([{ nume_sofer: 'X', total_km: 5000 }])) // sofor_km
      .mockResolvedValueOnce(rows([{ rendszam: 'B1', fuvarok: 5 }]))      // jarmu_kihasznaltsag
      .mockResolvedValueOnce(rows([{ nev: 'Cég Kft' }]));                 // ceg_nev
    const res = await call('dashStats', []);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.ceg_nev).toBe('Cég Kft');
    expect(res.body.result.statuszok).toHaveLength(1);
    // Mind az 5 lekérdezés a saját company_id-vel
    for (let i = 0; i < 5; i++) {
      expect(pool.query.mock.calls[i][1][0]).toBe(CID);
    }
  });
});

// ═══ getRecentOrders ═════════════════════════════════════════
describe('getRecentOrders', () => {
  test('limit clamp: felső korlát 50', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([]));
    await call('getRecentOrders', [999]);
    expect(pool.query.mock.calls[0][1]).toEqual([CID, 50]);
  });

  test('érvénytelen limit → 8', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([]));
    await call('getRecentOrders', ['abc']);
    expect(pool.query.mock.calls[0][1]).toEqual([CID, 8]);
  });

  test('obj argumentum kezelve ({limit:5}) — a gas(fn, obj) formában', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([]));
    // A gas(fn, {limit:5}) az /api/execute-nak arguments={limit:5}-t küld
    // (nem tömbbe csomagolva). A handler _argObj ezt kezeli.
    await call('getRecentOrders', { limit: 5 });
    expect(pool.query.mock.calls[0][1]).toEqual([CID, 5]);
  });

  test('Sofer elutasítva', async () => {
    setUser(SOFER);
    const res = await call('getRecentOrders', []);
    expect(res.body.result.ok).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

// ═══ getVehicleStatusSummary ═════════════════════════════════
describe('getVehicleStatusSummary', () => {
  test('normalizált 0-k üres visszaadásnál', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([{ active: 5, inactive: 2, unknown: 0 }]));
    const res = await call('getVehicleStatusSummary', []);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.active).toBe(5);
    expect(res.body.result.inactive).toBe(2);
  });
});

// ═══ getActiveVehiclePositions ═══════════════════════════════
describe('getActiveVehiclePositions', () => {
  test('Manager hívhatja, getPositions eredménye visszaadva', async () => {
    setUser(MANAGER);
    const res = await call('getActiveVehiclePositions', []);
    expect(res.body.result.positions).toEqual([]);
    expect(res.body.result.cached).toBe(false);
  });

  test('Sofer elutasítva', async () => {
    setUser(SOFER);
    const res = await call('getActiveVehiclePositions', []);
    expect(res.body.result.ok).toBe(false);
  });
});

// ═══ getMyFeatures ═══════════════════════════════════════════
describe('getMyFeatures', () => {
  test('plan-features + company-override egyesítve (override felülír)', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([
        { feature_key: 'chat', enabled: true },
        { feature_key: 'ai-kiolvasas', enabled: false },
      ]))
      .mockResolvedValueOnce(rows([
        { feature_key: 'ai-kiolvasas', enabled: true }, // override → felülír
      ]));
    const res = await call('getMyFeatures', []);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.features.chat).toBe(true);
    expect(res.body.result.features['ai-kiolvasas']).toBe(true);
    expect(res.body.result.pozicio).toBe('Admin');
  });
});

// ═══ opsCenter ═══════════════════════════════════════════════
describe('getOpsCenter', () => {
  test('Sofer elutasítva', async () => {
    setUser(SOFER);
    const res = await call('getOpsCenter', []);
    expect(res.body.result.ok).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('Admin: teljes payload — counters + health', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([{ aktiv: 10, mai_felrakas: 3, mai_lerakas: 2, keso: 1, hianyzo_fuvarozo: 0 }]))
      .mockResolvedValueOnce(rows([{ db: 2 }])) // hianyzo_uit
      .mockResolvedValueOnce(rows([{ db: 4 }])) // lejaro_szamla
      .mockResolvedValueOnce(rows([{ db: 3 }])) // lejaro_ap_szamla
      .mockResolvedValueOnce(rows([{ db: 5 }])) // lejaro_dok
      .mockResolvedValueOnce(rows([{ varakozo: 2, aktiv: 10 }])) // waitR
      .mockResolvedValueOnce(rows([{ aktiv_jarmu: 8 }])) // fr
      .mockResolvedValueOnce(rows([{ db: 6 }])); // onroad
    const res = await call('getOpsCenter', []);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.counters.aktiv).toBe(10);
    expect(res.body.result.counters.hianyzo_uit).toBe(2);
    expect(res.body.result.counters.lejaro_szamla).toBe(4);
    expect(res.body.result.health.assigned_pct).toBe(80); // (10-2)/10
    expect(res.body.result.health.utilization_pct).toBe(75); // 6/8
    expect(res.body.result.health.waiting).toBe(2);
  });
});

// ═══ getFinishedOrders ═══════════════════════════════════════
describe('getFinishedOrders', () => {
  test('Sofer elutasítva', async () => {
    setUser(SOFER);
    const res = await call('getFinishedOrders', []);
    expect(res.body.result.ok).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('dátum-szűrő (érvényes ISO): from + to bekerül a paraméterekbe', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([]));
    await call('getFinishedOrders', [{ from: '2026-01-01', to: '2026-06-30' }]);
    expect(pool.query.mock.calls[0][1]).toEqual([CID, '2026-01-01', '2026-06-30']);
  });

  test('érvénytelen dátum-formátum kihagyva', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([]));
    await call('getFinishedOrders', [{ from: 'nem_datum', to: '' }]);
    expect(pool.query.mock.calls[0][1]).toEqual([CID]);
  });
});

// ═══ getBnrRate ══════════════════════════════════════════════
describe('getBnrRate', () => {
  test('Sofer elutasítva', async () => {
    setUser(SOFER);
    const res = await call('getBnrRate', []);
    expect(res.body.result.ok).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('Admin: bnr_rate + company_rate visszaadva', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([{ eur_ron_rate: 4.95 }]));
    const res = await call('getBnrRate', []);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.bnr_rate).toBe(4.98);
    expect(res.body.result.company_rate).toBe(4.95);
    expect(res.body.result.fetched_at).toBeDefined();
  });

  test('nincs cég-ráta (null)', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([]));
    const res = await call('getBnrRate', []);
    expect(res.body.result.company_rate).toBeNull();
  });
});

// ═══ globalSearch ════════════════════════════════════════════
describe('globalSearch', () => {
  test('session nélkül', async () => {
    setUser(null);
    const res = await call('globalSearch', ['abc']);
    expect(res.status).toBe(401);
  });

  test('< 2 karakter → üres groups', async () => {
    setUser(ADMIN);
    const res = await call('globalSearch', ['a']);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.groups).toEqual([]);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('Sofer: fuvar/sofőr NEM keresett, csak ügyfél/jármű', async () => {
    setUser(SOFER);
    // A handler párhuzamosan indít 6+ SELECT-et — mindegyik ILIKE
    // ownership-szűréssel. Elegendő általános mock, mert csak azt
    // ellenőrizzük, hogy visszaad ok:true-t.
    pool.query.mockResolvedValue(rows([]));
    const res = await call('globalSearch', ['test']);
    expect(res.body.result.ok).toBe(true);
    // Ellenőrizzük: a fuvar-lekérdezés SEM hívva (isStaff=false → Promise.resolve)
    const sqls = pool.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /FROM orders/i.test(s))).toBe(false);
  });

  test('Admin: fuvar + ügyfél + jármű + sofőr lekérdezve, mind cégre szűrt', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValue(rows([]));
    const res = await call('globalSearch', ['test']);
    expect(res.body.result.ok).toBe(true);
    // Minden hívás első paramétere company_id
    for (const call of pool.query.mock.calls) {
      expect(call[1][0]).toBe(CID);
    }
  });
});

// ═══ getVehicleDetail (entityDetail) ═════════════════════════
describe('getVehicleDetail', () => {
  test('Sofer NEM hívhatja', async () => {
    setUser(SOFER);
    const res = await call('getVehicleDetail', [{ id: 1 }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/interzis/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('érvénytelen ID', async () => {
    setUser(ADMIN);
    const res = await call('getVehicleDetail', [{ id: 'abc' }]);
    expect(res.body.result.err).toMatch(/ID invalid/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('idegen cég járműve — pool.query 1× (ownership SELECT), nincs több', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([])); // vehicles ownership üres
    const res = await call('getVehicleDetail', [{ id: 99 }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/gasit/i);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test('sikeres — vehicle + lejáratok + szerviz + üzemanyag', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([{ id: 1, rendszam: 'B123ABC', tip: 'Vontato' }]))
      .mockResolvedValueOnce(rows([{ id: 1, doc_type: 'ITP', expiry_date: '2026-12-31', days_left: 30 }]))
      .mockResolvedValueOnce(rows([{ id: 1, service_date: '2026-06-01', category: 'Cserekészlet' }]))
      .mockResolvedValueOnce(rows([{ id: 1, tx_date: '2026-06-15', qty_l: 500, amount_ron: 3000 }]))
      .mockResolvedValueOnce(rows([{ db: 3, litru: 1500, suma: 9000 }]));
    const res = await call('getVehicleDetail', [{ id: 1 }]);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.vehicle.rendszam).toBe('B123ABC');
    expect(res.body.result.expiries).toHaveLength(1);
    expect(res.body.result.service).toHaveLength(1);
    expect(res.body.result.fuel).toHaveLength(1);
    expect(res.body.result.fuelTotal.db).toBe(3);
  });
});

// ═══ getDriverDetail (entityDetail) ══════════════════════════
describe('getDriverDetail', () => {
  test('sem email sem ID → elutasít', async () => {
    setUser(ADMIN);
    const res = await call('getDriverDetail', [{}]);
    expect(res.body.result.err).toMatch(/Lipsesc datele/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('idegen cég sofőrje (üres users)', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([]));
    const res = await call('getDriverDetail', [{ email: 'x@x.hu' }]);
    expect(res.body.result.err).toMatch(/gasit/i);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test('email + ownership OK — lookup normalizált lowercase', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([{ id: 10, nume: 'X', email: 'sofer@ceg.hu', tel: '0700' }]))
      .mockResolvedValueOnce(rows([])) // lejáratok
      .mockResolvedValueOnce(rows([])); // driver_advances (opcionális)
    const res = await call('getDriverDetail', [{ email: 'SOFER@CEG.HU' }]);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.driver.nume).toBe('X');
    // Az első lekérdezés paramétere kisbetűs email
    expect(pool.query.mock.calls[0][1][1]).toBe('sofer@ceg.hu');
  });
});

// ═══ getOrderDetail (entityDetail) ═══════════════════════════
describe('getOrderDetail', () => {
  test('ID nélkül', async () => {
    setUser(ADMIN);
    const res = await call('getOrderDetail', [{}]);
    expect(res.body.result.err).toMatch(/ID invalid/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('idegen cég fuvarja — csak 1 SELECT', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([]));
    const res = await call('getOrderDetail', [{ id: 'CMD-B' }]);
    expect(res.body.result.err).toMatch(/gasita/i);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test('sikeres — order + dokumentumok + POD + számlák + legs + audit', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([{ id: 'CMD-1', client: 'X', status: 'Alocat', tracking_token: 'TOK' }]))
      .mockResolvedValueOnce(rows([{ id: 1, file_name: 'order.pdf' }])) // documents
      .mockResolvedValueOnce(rows([{ id: 1, tip: 'POD', file_name: 'pod.jpg' }])) // POD
      .mockResolvedValueOnce(rows([{ id: 1, numar: '01', status: 'issued' }])) // invoices
      .mockResolvedValueOnce(rows([{ leg_number: 1 }])) // legs
      .mockResolvedValueOnce(rows([{ action: 'order.create' }])); // audit
    const res = await call('getOrderDetail', [{ id: 'CMD-1' }]);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.order.id).toBe('CMD-1');
    expect(res.body.result.tracking_token).toBe('TOK');
    expect(res.body.result.documents).toHaveLength(1);
    expect(res.body.result.pod).toHaveLength(1);
    expect(res.body.result.invoices).toHaveLength(1);
  });
});

// ═══ getClientProfile (entityDetail) ═════════════════════════
describe('getClientProfile', () => {
  test('érvénytelen ID', async () => {
    setUser(ADMIN);
    const res = await call('getClientProfile', [{ id: 'abc' }]);
    expect(res.body.result.err).toMatch(/ID invalid/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('sikeres — client + orders + invoices + portal (jelszó nélkül)', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([{ id: 5, denumire: 'Ügyfél Kft' }]))
      .mockResolvedValueOnce(rows([{ id: 'CMD-1', status: 'Finalizat' }]))
      .mockResolvedValueOnce(rows([{ id: 100, numar: '01', status: 'issued' }]))
      .mockResolvedValueOnce(rows([{ id: 1, email: 'kapcs@ugyfel.hu', has_password: true }]));
    const res = await call('getClientProfile', [{ id: 5 }]);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.client.denumire).toBe('Ügyfél Kft');
    expect(res.body.result.orders).toHaveLength(1);
    expect(res.body.result.invoices).toHaveLength(1);
    // portál: has_password (jelszó-hash nélkül)
    expect(res.body.result.portal[0].has_password).toBe(true);
    expect(res.body.result.portal[0].pass_hash).toBeUndefined();
  });
});
