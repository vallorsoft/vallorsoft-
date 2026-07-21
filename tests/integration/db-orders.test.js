// ============================================================
//  VALÓDI DB integráció — a mock-kal NEM fedhető utak:
//   - comCreate / orderHandover TRANZAKCIÓ (pool.connect)
//   - finalized_at TRIGGER
//   - getMySoferOrders dash_visible SQL-logika
//   - plannerAssign: parkolt fuvar újraosztása → Alocat
//  Csak akkor fut, ha van DATABASE_URL (CI Postgres service);
//  helyben/DB nélkül a suite kihagyódik, a mock-tesztek mennek.
// ============================================================
const { loadSchema, truncateAll, hasDb } = require('../helpers/real-db');

const pool = require('../../db');                 // VALÓDI pool (nincs jest.mock)
const orders = require('../../handlers/orders');  // comCreate, comUpdate, getMySoferOrders, plannerAssign
const handover = require('../../handlers/handover');

function makeRes() {
  const res = { body: null };
  res.json = (o) => { res.body = o; return res; };
  res.status = () => res;
  return res;
}
function reqAs(user) { return { session: { user } }; }
const admin = (companyId) => reqAs({ company_id: companyId, email: 'admin@x.hu', pozicio: 'Admin' });

const d = hasDb() ? describe : describe.skip;

d('Valódi DB integráció (orders / sofőr / handover / planner)', () => {
  jest.setTimeout(40000);
  let companyId;
  const DRIVER = 'driver@x.hu';

  beforeAll(async () => { await loadSchema(pool); });
  afterAll(async () => { await pool.end(); });

  beforeEach(async () => {
    await truncateAll(pool);
    const c = await pool.query("INSERT INTO companies (nev) VALUES ('Teszt Kft') RETURNING id");
    companyId = c.rows[0].id;
    await pool.query(
      "INSERT INTO users (nume, email, pozicio, password_hash, company_id) VALUES ('Sofőr D', $1, 'Sofer', 'x', $2)",
      [DRIVER, companyId]);
  });

  test('comCreate: Intern sofőr → Alocat, email kisbetűs; szakasz (leg) NEM jön létre automatikusan', async () => {
    const res = makeRes();
    await orders.comCreate(admin(companyId), res, [{
      client: 'Ügyfél', loc_incarcare: 'A', loc_descarcare: 'B', load_type: 'FTL',
      sofer_type: 'Intern', email_sofer: 'Driver@X.HU', nume_sofer: 'Sofőr D',
    }]);
    expect(res.body.result.ok).toBe(true);
    const id = res.body.result.id;
    const o = (await pool.query('SELECT * FROM orders WHERE id = $1', [id])).rows[0];
    expect(o.status).toBe('Alocat');
    expect(o.email_sofer).toBe('driver@x.hu');     // comCreate normalizál
    expect(o.load_type).toBe('FTL');
    // A kezdeti sofőr/jármű a felső orders.* mezőkben él; szakaszt csak
    // explicit „➕ Szakasz" gombra (addOrderLeg) hozunk létre.
    const legs = await pool.query('SELECT * FROM order_legs WHERE order_id = $1', [id]);
    expect(legs.rowCount).toBe(0);
  });

  test('comUpdate: Disponibil-ról belső sofőr hozzárendelése → DB-ben Alocat + kisbetűs email', async () => {
    await pool.query("INSERT INTO orders (id, company_id, status) VALUES ('CMD-U1', $1, 'Disponibil')", [companyId]);
    const res = makeRes();
    await orders.comUpdate(admin(companyId), res, ['CMD-U1', {
      status: 'Disponibil', sofer_type: 'Intern', email_sofer: 'Driver@X.HU',
    }]);
    expect(res.body.result.ok).toBe(true);
    const o = (await pool.query("SELECT status, email_sofer FROM orders WHERE id = 'CMD-U1'")).rows[0];
    expect(o.status).toBe('Alocat');
    expect(o.email_sofer).toBe('driver@x.hu');
  });

  test('finalized_at TRIGGER: Finalizat-ra váltáskor beáll, egyébként null marad', async () => {
    await pool.query("INSERT INTO orders (id, company_id, status) VALUES ('CMD-T1', $1, 'Alocat')", [companyId]);
    await pool.query("UPDATE orders SET status = 'In Curs' WHERE id = 'CMD-T1'");
    let o = (await pool.query("SELECT finalized_at FROM orders WHERE id = 'CMD-T1'")).rows[0];
    expect(o.finalized_at).toBeNull();
    await pool.query("UPDATE orders SET status = 'Finalizat' WHERE id = 'CMD-T1'");
    o = (await pool.query("SELECT finalized_at FROM orders WHERE id = 'CMD-T1'")).rows[0];
    expect(o.finalized_at).not.toBeNull();
  });

  test('getMySoferOrders dash_visible: CSAK aktív fuvar látszik a főoldalon; a Finalizat sosem (csak a menetlevélben, waybill_visible)', async () => {
    const mk = (id, status, fin) => pool.query(
      'INSERT INTO orders (id, company_id, email_sofer, status, finalized_at) VALUES ($1,$2,$3,$4,$5)',
      [id, companyId, DRIVER, status, fin]);
    await mk('CMD-A', 'Alocat', null);
    await mk('CMD-P', 'Parkolt', null);
    await mk('CMD-R', 'Raktarban', null);
    await mk('CMD-FN', 'Finalizat', new Date());                           // ma zárt, MÉG NINCS menetlevél
    await mk('CMD-FO', 'Finalizat', new Date(Date.now() - 5 * 86400000));   // 5 napos, MÉG NINCS menetlevél
    // 5 napos Finalizat, DE már készült róla menetlevél 5 napja → menetlevél-picker-ből is kiesett
    await mk('CMD-FW', 'Finalizat', new Date(Date.now() - 5 * 86400000));
    await pool.query(
      "INSERT INTO fuvarlevelek (id, email_sofer, order_ids, data_completare) VALUES ($1,$2,$3,$4)",
      ['FUV-DBO-1', DRIVER, JSON.stringify(['CMD-FW']), new Date(Date.now() - 5 * 86400000)]);
    const res = makeRes();
    await orders.getMySoferOrders(reqAs({ company_id: companyId, email: DRIVER, pozicio: 'Sofer' }), res, []);
    const dash = {}, way = {};
    res.body.result.forEach((r) => { dash[r.id] = r.dash_visible; way[r.id] = r.waybill_visible; });
    // Főoldal: csak aktív státuszok
    expect(dash['CMD-A']).toBe(true);
    expect(dash['CMD-P']).toBe(true);      // regresszió-őr: leadott fuvar nem tűnik el
    expect(dash['CMD-R']).toBe(true);
    expect(dash['CMD-FN']).toBe(false);    // Finalizat → nincs a főoldalon
    expect(dash['CMD-FO']).toBe(false);    // Finalizat → nincs a főoldalon (menetlevél nélkül is)
    expect(dash['CMD-FW']).toBe(false);
    // Menetlevél-picker: Finalizat itt látszik (amíg nincs menetlevél / friss zárás)
    expect(way['CMD-A']).toBe(true);
    expect(way['CMD-FN']).toBe(true);      // ma zárt → picker-ben
    expect(way['CMD-FO']).toBe(true);      // menetlevél nélkül SOSEM tűnik el a picker-ből
    expect(way['CMD-FW']).toBe(false);     // menetlevél már van + 5 napos → picker-ből is kiesett
  });

  test('orderHandover (tranzakció): raktárba adás → Raktarban, email_sofer null, warehouse_items sor', async () => {
    await pool.query(
      "INSERT INTO orders (id, company_id, email_sofer, status, loc_incarcare) VALUES ('CMD-H1', $1, $2, 'In Curs', 'Start')",
      [companyId, DRIVER]);
    const res = makeRes();
    await handover.orderHandover(admin(companyId), res, ['CMD-H1', {
      type: 'warehouse', location: 'Cluj', qty: 5, qty_unit: 'paletta',
      length_cm: 100, width_cm: 100, height_cm: 100, weight_kg: 500, doc_pages: 3,
    }]);
    expect(res.body.result.ok).toBe(true);
    const o = (await pool.query("SELECT status, email_sofer FROM orders WHERE id = 'CMD-H1'")).rows[0];
    expect(o.status).toBe('Raktarban');
    expect(o.email_sofer).toBeNull();
    const wi = await pool.query("SELECT * FROM warehouse_items WHERE order_id = 'CMD-H1' AND status = 'Raktarban'");
    expect(wi.rowCount).toBe(1);
  });

  test('plannerAssign: parkolt fuvar jármű-kiosztása → Alocat (folytatás)', async () => {
    await pool.query(
      "INSERT INTO vehicles (tip, rendszam, company_id) VALUES ('Vontato', 'TEST01', $1)", [companyId]);
    await pool.query(
      "INSERT INTO orders (id, company_id, status, loc_incarcare) VALUES ('CMD-PK', $1, 'Parkolt', 'Depou')", [companyId]);
    const res = makeRes();
    await orders.plannerAssign(admin(companyId), res, ['CMD-PK', { rendszam_camion: 'TEST01' }]);
    expect(res.body.result.ok).toBe(true);
    const o = (await pool.query("SELECT status, rendszam_camion FROM orders WHERE id = 'CMD-PK'")).rows[0];
    expect(o.status).toBe('Alocat');
    expect(o.rendszam_camion).toBe('TEST01');
  });

  test('leg-konzisztencia: addOrderLeg → a fuvar top-szintű sofőrje az ÚJ leghez igazul (kisbetűs)', async () => {
    const cr = makeRes();
    await orders.comCreate(admin(companyId), cr, [{
      client: 'X', loc_incarcare: 'A', loc_descarcare: 'B', load_type: 'FTL',
      sofer_type: 'Intern', email_sofer: DRIVER, nume_sofer: 'Sofőr D',
    }]);
    const id = cr.body.result.id;
    await pool.query(
      "INSERT INTO users (nume, email, pozicio, password_hash, company_id) VALUES ('Másik', 'masik@x.hu', 'Sofer', 'x', $1)", [companyId]);
    const lr = makeRes();
    await orders.addOrderLeg(admin(companyId), lr, [id, { sofer_type: 'Intern', email_sofer: 'Masik@X.HU', nume_sofer: 'Másik' }]);
    expect(lr.body.result.ok).toBe(true);
    const o = (await pool.query('SELECT email_sofer, nume_sofer FROM orders WHERE id = $1', [id])).rows[0];
    expect(o.email_sofer).toBe('masik@x.hu');   // top-szint követi az új leget, normalizálva
    expect(o.nume_sofer).toBe('Másik');
  });

  test('leg-konzisztencia: deleteOrderLeg → a top-szint a megmaradó legutolsó leghez áll vissza', async () => {
    // Új semantika: comCreate nem hoz létre kezdő szakaszt, ezért két
    // explicit addOrderLeg-gel dolgozunk (első leg = DRIVER, második = Másik),
    // majd az utolsót töröljük és a top-szint az elsőre esik vissza.
    await pool.query(
      "INSERT INTO users (nume, email, pozicio, password_hash, company_id) VALUES ('Másik2','masik@x.hu','Sofer','x',$1) ON CONFLICT (email) DO NOTHING",
      [companyId]);
    const cr = makeRes();
    await orders.comCreate(admin(companyId), cr, [{
      client: 'X', loc_incarcare: 'A', loc_descarcare: 'B', load_type: 'FTL',
      sofer_type: 'Intern', email_sofer: DRIVER, nume_sofer: 'Sofőr D',
    }]);
    const id = cr.body.result.id;
    await orders.addOrderLeg(admin(companyId), makeRes(), [id, { sofer_type: 'Intern', email_sofer: DRIVER, nume_sofer: 'Sofőr D' }]);
    await orders.addOrderLeg(admin(companyId), makeRes(), [id, { sofer_type: 'Intern', email_sofer: 'masik@x.hu', nume_sofer: 'Másik' }]);
    const leg2 = (await pool.query('SELECT id FROM order_legs WHERE order_id = $1 ORDER BY leg_number DESC LIMIT 1', [id])).rows[0].id;
    await orders.deleteOrderLeg(admin(companyId), makeRes(), [leg2]);
    const o = (await pool.query('SELECT email_sofer FROM orders WHERE id = $1', [id])).rows[0];
    expect(o.email_sofer).toBe(DRIVER);   // vissza az első (megmaradt) leg sofőrjére
  });
});
