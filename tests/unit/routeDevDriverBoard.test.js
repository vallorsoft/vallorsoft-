// Sofőr-verseny: útvonal-fegyelem sofőrönként (többlet-km, többlet-idő, rangsor)
jest.mock('../../db', () => require('../helpers/db-mock').pool);
jest.mock('../../lib/audit', () => ({ fromReq: jest.fn() }));
jest.mock('../../lib/featureEnabled', () => ({ featureEnabled: jest.fn().mockResolvedValue(true) }));
const { pool, rows, reset } = require('../helpers/db-mock');
const rd = require('../../lib/routeDeviation');

const row = (email, name, plan, act, status, extra) => Object.assign({ email_sofer: email, nume_sofer: name,
  planned_km: plan, actual_km: act, diff_km: act - plan, status, detail: null, fuel_per_100km: null }, extra || {});

describe('extraHours', () => {
  test('mért és tervezett menetidőből', () => {
    expect(rd.extraHours({ status: 'deviation', diff_km: 40, detail: { planned_h: 4, stats: { drive_h: 4.8 } } }))
      .toEqual({ h: expect.closeTo(0.8, 5), est: false });
  });
  test('terv-idő nélkül a többlet-km a mért átlagsebességgel', () => {
    const r = rd.extraHours({ status: 'deviation', diff_km: 40, detail: { stats: { avg_kmh: 80 } } });
    expect(r.est).toBe(true); expect(r.h).toBeCloseTo(0.5);
  });
  test('rendben lévő fuvarnál becsült többlet-idő nincs', () => {
    expect(rd.extraHours({ status: 'ok', diff_km: 3, detail: {} }).h).toBe(0);
  });
  test('rövidebb menetidő nem negatív', () => {
    expect(rd.extraHours({ status: 'ok', diff_km: -10, detail: { planned_h: 5, stats: { drive_h: 4 } } }).h).toBe(0);
  });
});

describe('driverBoard', () => {
  const data = [
    // Anna: 3 fuvar, 0 eltérés, 10 km megtakarítás → 1. hely
    row('anna@x.ro', 'Anna', 300, 295, 'ok'), row('anna@x.ro', 'Anna', 200, 195, 'ok'), row('anna@x.ro', 'Anna', 100, 100, 'ok'),
    // Béla: 3 fuvar, 1 eltérés +60 km → 2. hely
    row('bela@x.ro', 'Béla', 300, 360, 'deviation', { fuel_per_100km: 32, detail: { planned_h: 4, stats: { drive_h: 5, off_km: 30 } } }),
    row('bela@x.ro', 'Béla', 300, 302, 'ok'), row('BELA@x.ro', 'Béla', 400, 401, 'ok'),
    // Csaba: 3 fuvar, 2 eltérés +100 km → 3. hely
    row('csaba@x.ro', 'Csaba', 200, 260, 'deviation'), row('csaba@x.ro', 'Csaba', 200, 240, 'deviation'), row('csaba@x.ro', 'Csaba', 100, 100, 'ok'),
    // Dénes: csak 1 fuvar → nincs rangsorban
    row('denes@x.ro', 'Dénes', 100, 100, 'ok'),
  ];
  const b = rd.driverBoard(data);
  test('rangsor a 100 km-re jutó többlet-km szerint; kevés adat a végén, rang nélkül', () => {
    expect(b.drivers.map((d) => d.name)).toEqual(['Anna', 'Béla', 'Csaba', 'Dénes']);
    expect(b.drivers.map((d) => d.rank)).toEqual([1, 2, 3, null]);
  });
  test('sofőr e-mail kisbetűsítve egy sofőrnek számít', () => {
    expect(b.drivers.find((d) => d.name === 'Béla').orders).toBe(3);
  });
  test('Béla mutatói: többlet-km, idő, liter, terven kívül', () => {
    const d = b.drivers.find((x) => x.name === 'Béla');
    expect(d.extra_km).toBe(60); expect(d.deviation).toBe(1); expect(d.extra_per_100).toBe(6);
    expect(d.extra_h).toBe(1); expect(d.extra_h_est).toBe(false);
    expect(d.extra_l).toBe(19);                    // 60 km × 32 L/100
    expect(d.off_km).toBe(30);
  });
  test('Csaba: alap fogyasztás és becsült többlet-idő', () => {
    const d = b.drivers.find((x) => x.name === 'Csaba');
    expect(d.extra_km).toBe(100); expect(d.extra_l).toBe(30); expect(d.extra_h_est).toBe(true);
    expect(d.deviation_pct).toBeCloseTo(66.7);
  });
  test('cég-összesítés + kiemelések', () => {
    expect(b.company.extra_km).toBe(160); expect(b.company.orders).toBe(10); expect(b.company.saved_km).toBe(10);
    expect(b.awards.best).toBe('Anna'); expect(b.awards.most_saved).toBe('Anna'); expect(b.awards.clean).toEqual(['Anna']);
  });
  test('üres bemenet', () => {
    const e = rd.driverBoard([]);
    expect(e.drivers).toEqual([]); expect(e.awards).toBeNull();
  });
});

describe('handlers.routeDeviationDriverStats', () => {
  const h = require('../../handlers/stopMatch');
  const call = (u, arg) => new Promise((ok) => h.routeDeviationDriverStats({ session: { user: u }, headers: {} }, { json: (x) => ok(x.result) }, [arg || {}]));
  beforeEach(() => reset());
  test('sofőr nem éri el', async () => {
    const r = await call({ pozicio: 'Sofer', company_id: 7 });
    expect(r.ok).toBe(false); expect(pool.query).not.toHaveBeenCalled();
  });
  test('cégre és időszakra szűrt', async () => {
    pool.query.mockResolvedValueOnce(rows([row('a@x.ro', 'A', 100, 120, 'deviation')]));
    const r = await call({ pozicio: 'Admin', company_id: 7 }, { from: '2026-10-01', to: '2026-10-31' });
    expect(r.ok).toBe(true); expect(r.drivers[0].extra_km).toBe(20);
    expect(pool.query.mock.calls[0][1]).toEqual([7, '2026-10-01', '2026-10-31']);
  });
});

describe('routeDeviationMap — sofőr szerinti időszak', () => {
  const h = require('../../handlers/stopMatch');
  beforeEach(() => reset());
  test('sofer_email szűrő a paraméterek között', async () => {
    pool.query.mockResolvedValueOnce(rows([]));
    const r = await new Promise((ok) => h.routeDeviationMap({ session: { user: { pozicio: 'Manager', company_id: 7 } }, headers: {} },
      { json: (x) => ok(x.result) }, [{ from: '2026-10-01', to: '2026-10-31', sofer_email: 'Anna@X.ro' }]));
    expect(r.ok).toBe(true);
    expect(pool.query.mock.calls[0][1]).toEqual([7, '2026-10-01', '2026-10-31', 'anna@x.ro', 41]);
  });
});
