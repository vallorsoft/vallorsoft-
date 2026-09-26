// ============================================================
//  VALÓDI DB — az általános hibakereső kör (2026-09-26) javításainak
//  regresszió-védelme. Mindegyik korábban élesben „Eroare de server"-t vagy
//  csendben üres eredményt adott:
//   - getWaybillDrivers  → GROUP BY „ungrouped column" hiba (Belső sofőrök →
//                          Régi sofőr menetleveleinek átrendezése kártya)
//   - e-CMR              → order_ecmr.order_id INTEGER vs orders.id VARCHAR
//   - getPlannerData     → carriers.denumire (valójában: nev) → alvállalkozói
//                          járművek sosem jelentek meg a tervezőtáblán
//   - devActivatePayment → subscription_plans.billing_interval nem létezik
//  Csak DATABASE_URL mellett fut (CI Postgres service); enélkül skip.
// ============================================================
const { loadSchema, truncateAll, hasDb } = require('../helpers/real-db');

const pool = require('../../db');
const documents = require('../../handlers/documents');
const ecmr = require('../../handlers/ecmr');
const orders = require('../../handlers/orders');
const developer = require('../../handlers/developer');

function makeRes() {
  const res = { body: null };
  res.json = (o) => { res.body = o; return res; };
  return res;
}
async function call(h, user, args) {
  const res = makeRes();
  await h({ session: { user }, ip: '127.0.0.1', headers: {} }, res, args);
  return res.body.result;
}

const d = hasDb() ? describe : describe.skip;

d('Hibakereső kör javításai (valódi DB)', () => {
  jest.setTimeout(40000);
  let cid, otherCid;
  const ADMIN = { id: 1, email: 'admin@x.ro', nume: 'Admin', pozicio: 'Admin' };

  beforeAll(async () => { await loadSchema(pool); });
  afterAll(async () => { await pool.end(); });

  beforeEach(async () => {
    await truncateAll(pool);
    await pool.query('DELETE FROM order_ecmr');
    await pool.query('DELETE FROM carrier_vehicles');
    await pool.query('DELETE FROM carriers');
    await pool.query('DELETE FROM payment_requests');
    cid = (await pool.query("INSERT INTO companies (nev) VALUES ('A SRL') RETURNING id")).rows[0].id;
    otherCid = (await pool.query("INSERT INTO companies (nev) VALUES ('B SRL') RETURNING id")).rows[0].id;
    ADMIN.company_id = cid;
    await pool.query(
      "INSERT INTO users (nume,email,pozicio,password_hash,company_id) VALUES ('Sofer Nou','nou@x.ro','Sofer','x',$1)", [cid]);
  });

  test('getWaybillDrivers: szellem- és aktuális sofőr csoportosítva, hiba nélkül', async () => {
    await pool.query(
      `INSERT INTO fuvarlevelek (id,email_sofer,nume_sofer,company_id) VALUES
         ('FUV-1','Regi@x.ro','Regi Sofer',$1), ('FUV-2','regi@x.ro','Regi Sofer',$1),
         ('FUV-3','nou@x.ro','Sofer Nou',$1), ('FUV-4','idegen@x.ro','Idegen',$2)`, [cid, otherCid]);
    const r = await call(documents.getWaybillDrivers, ADMIN);
    expect(r.ok).toBe(true);
    const byEmail = Object.fromEntries(r.drivers.map((x) => [x.email, x]));
    expect(byEmail['regi@x.ro']).toMatchObject({ db: 2, is_current: false });
    expect(byEmail['nou@x.ro']).toMatchObject({ db: 1, is_current: true });
    expect(byEmail['idegen@x.ro']).toBeUndefined();         // nincs cross-tenant
  });

  test('e-CMR: szöveges fuvar-azonosítóval létrehozható, listázható, aláírható', async () => {
    await pool.query("INSERT INTO orders (id,company_id,client,status) VALUES ('CMD-ABC123',$1,'Kliens','Alocat')", [cid]);
    await pool.query("INSERT INTO orders (id,company_id,client,status) VALUES ('CMD-IDEGEN',$1,'X','Alocat')", [otherCid]);

    const c = await call(ecmr.ecmrCreate, ADMIN, ['CMD-ABC123']);
    expect(c.ok).toBe(true);
    const l = await call(ecmr.ecmrList, ADMIN);
    expect(l.ok).toBe(true);
    expect(l.items.map((i) => i.order_id)).toEqual(['CMD-ABC123']);
    const g = await call(ecmr.ecmrGet, ADMIN, [c.id]);
    expect(g.ok).toBe(true);
    const s = await call(ecmr.ecmrSign, ADMIN, [{ ecmr_id: c.id, party: 'carrier', name: 'Ion' }]);
    expect(s).toMatchObject({ ok: true, status: 'partial' });

    // Idegen cég fuvarához nem hozható létre (cross-tenant write védelem)
    const x = await call(ecmr.ecmrCreate, ADMIN, ['CMD-IDEGEN']);
    expect(x.ok).toBe(false);
  });

  test('getPlannerData: az alvállalkozói járművek a cég nevével megjelennek', async () => {
    const car = (await pool.query("INSERT INTO carriers (company_id,nev) VALUES ($1,'Carrier Beta') RETURNING id", [cid])).rows[0].id;
    await pool.query("INSERT INTO carrier_vehicles (company_id,carrier_id,rendszam_camion) VALUES ($1,$2,'AR99XYZ')", [cid, car]);
    const r = await call(orders.getPlannerData, ADMIN, [{}]);
    expect(r.ok).not.toBe(false);
    expect(r.carrierVehicles).toEqual([
      expect.objectContaining({ rendszam: 'AR99XYZ', carrier_nev: 'Carrier Beta' }),
    ]);
  });

  test('devActivatePayment: a fizetési kérelem aktiválható (havi → +1 hó)', async () => {
    const plan = (await pool.query("INSERT INTO subscription_plans (name,price_net) VALUES ('Pro',99) RETURNING id")).rows[0].id;
    const pr = (await pool.query(
      "INSERT INTO payment_requests (company_id,plan_id,billing_type,reference,status) VALUES ($1,$2,'monthly','VS-T','pending') RETURNING id",
      [cid, plan])).rows[0].id;
    const r = await call(developer.devActivatePayment, { ...ADMIN, is_dev: true }, [pr]);
    expect(r.ok).toBe(true);
    const c = (await pool.query('SELECT subscription_status, subscription_plan_id FROM companies WHERE id=$1', [cid])).rows[0];
    expect(c).toMatchObject({ subscription_status: 'active', subscription_plan_id: plan });
    const st = (await pool.query('SELECT status FROM payment_requests WHERE id=$1', [pr])).rows[0].status;
    expect(st).toBe('paid');
  });
});
