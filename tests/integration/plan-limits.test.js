// ============================================================
//  Csomag-limitek kikényszerítése (valódi DB)
// ============================================================
const { loadSchema, hasDb } = require('../helpers/real-db');
const pool = require('../../db');
const orders = require('../../handlers/orders');
const fleet = require('../../handlers/fleet');
const planLimits = require('../../lib/planLimits');

function makeRes() { const res = { body: null }; res.json = (o) => { res.body = o; return res; }; res.status = () => res; return res; }
const admin = (cid) => ({ session: { user: { company_id: cid, email: 'a@x.hu', pozicio: 'Admin' } } });

const d = hasDb() ? describe : describe.skip;

d('Csomag-limitek (valódi DB)', () => {
  jest.setTimeout(40000);
  beforeAll(async () => { await loadSchema(pool); });
  afterAll(async () => { await pool.end(); });
  beforeEach(async () => { await pool.query('TRUNCATE orders, vehicles, subscription_plans, companies RESTART IDENTITY CASCADE'); });

  async function companyWithPlan(limits) {
    const l = limits || {};
    const p = await pool.query(
      'INSERT INTO subscription_plans (name, max_users, max_vehicles, max_orders_per_month) VALUES ($1,$2,$3,$4) RETURNING id',
      ['Teszt', l.max_users == null ? null : l.max_users, l.max_vehicles == null ? null : l.max_vehicles, l.max_orders_per_month == null ? null : l.max_orders_per_month]);
    const c = await pool.query('INSERT INTO companies (nev, subscription_plan_id) VALUES ($1,$2) RETURNING id', ['T', p.rows[0].id]);
    return c.rows[0].id;
  }

  test('orders_month limit: a limit elérése után a comCreate tiltott', async () => {
    const cid = await companyWithPlan({ max_orders_per_month: 1 });
    const r1 = makeRes();
    await orders.comCreate(admin(cid), r1, [{ client: 'A', loc_incarcare: 'X', loc_descarcare: 'Y', load_type: 'FTL' }]);
    expect(r1.body.result.ok).toBe(true);
    const r2 = makeRes();
    await orders.comCreate(admin(cid), r2, [{ client: 'B', loc_incarcare: 'X', loc_descarcare: 'Y', load_type: 'FTL' }]);
    expect(r2.body.result.ok).toBe(false);
    expect(r2.body.result.err).toMatch(/comenzi|lun|limit/i);
  });

  test('vehicles limit: a limit elérése után a vehicleCreate tiltott', async () => {
    const cid = await companyWithPlan({ max_vehicles: 1 });
    const r1 = makeRes();
    await fleet.vehicleCreate(admin(cid), r1, [{ rendszam: 'V1', tip: 'Vontato' }]);
    expect(r1.body.result.ok).toBe(true);
    const r2 = makeRes();
    await fleet.vehicleCreate(admin(cid), r2, [{ rendszam: 'V2', tip: 'Vontato' }]);
    expect(r2.body.result.ok).toBe(false);
    expect(r2.body.result.err).toMatch(/vehicul|limit/i);
  });

  test('NULL limit = korlátlan: checkLimit ok marad', async () => {
    const cid = await companyWithPlan({});
    const lim = await planLimits.checkLimit(cid, 'orders_month');
    expect(lim.ok).toBe(true);
    expect(lim.limit).toBeNull();
  });

  test('nincs csomag = korlátlan', async () => {
    const c = await pool.query("INSERT INTO companies (nev) VALUES ('NoPlan') RETURNING id");
    const lim = await planLimits.checkLimit(c.rows[0].id, 'vehicles');
    expect(lim.ok).toBe(true);
  });
});
