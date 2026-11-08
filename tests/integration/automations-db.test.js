// ============================================================
//  VALÓDI DB integráció — három automatizmus + használati kimutatás
//   1) üzemanyag-hiány riasztás (GPS tartály-szint) — iroda / sofőr fokozat
//   2) automatikus útdíj — kézi értéket nem ír felül
//   3) lejárat → feladat felelőssel, csak az új dátum zárja le
//   4) devAuditUsage — csak developer
//  Csak DATABASE_URL mellett fut.
// ============================================================
jest.mock('../../services/email', () => ({
  sendClientEmail: jest.fn(async () => ({ ok: true })),
}));
jest.mock('../../services/push', () => ({
  sendPushToRole: jest.fn(async () => {}),
  sendPushToEmail: jest.fn(async () => {}),
}));
const { loadSchema, truncateAll, hasDb } = require('../helpers/real-db');
const pool = require('../../db');
const fleet = require('../../handlers/fleetCompliance');
const dev = require('../../handlers/developer');
const email = require('../../services/email');
const push = require('../../services/push');

const d = hasDb() ? describe : describe.skip;
const call = async (mod, fn, user, arg) => {
  const res = { body: null, json(o) { this.body = o; return this; } };
  await mod[fn]({ session: { user }, headers: {}, ip: '127.0.0.1' }, res, arg === undefined ? [] : [arg]);
  return res.body.result;
};

// Egy nap: 20 km menet (500 L-ről lassan fogy), 1 óra állás, közben a szint
// `dropL` literrel esik, majd újabb 20 km menet. Pont: [t,lat,lng,speed,ign,mileage,fuelUsed,level]
function dayTrack(dayStartSec, dropL) {
  const pts = [];
  let t = dayStartSec + 8 * 3600, lat = 46.0, lng = 23.0, level = 500, km = 100000;
  const step = 0.0018;                         // ~0,2 km / pont
  for (let i = 0; i < 100; i++) { t += 15; lng += step; km += 0.14; level -= 0.045; pts.push([t, lat, lng, 60, 1, Math.round(km), null, level]); }
  for (let i = 0; i < 120; i++) { t += 30; const l = i < 20 ? level : level - dropL; pts.push([t, lat, lng, 0, 0, Math.round(km), null, l]); }
  level -= dropL;
  for (let i = 0; i < 100; i++) { t += 15; lng += step; km += 0.14; level -= 0.045; pts.push([t, lat, lng, 60, 1, Math.round(km), null, level]); }
  return pts;
}

d('Valódi DB — automatizmusok', () => {
  jest.setTimeout(60000);
  let cid, adminId, mgrId;
  const ADMIN = { email: 'admin@x.ro', nume: 'Admin A', pozicio: 'Admin' };
  const MGR = { email: 'mgr@x.ro', nume: 'Manager M', pozicio: 'Manager' };
  const SOFER = { email: 'sofer@x.ro', nume: 'Pop Ion' };
  const PLATE = 'CV10VLR';

  beforeAll(async () => { await loadSchema(pool); });
  afterAll(async () => { await pool.end(); });
  beforeEach(async () => {
    await truncateAll(pool);
    await pool.query('TRUNCATE gps_track_days, fuel_loss_alerts, document_expiries, notifications, audit_log RESTART IDENTITY CASCADE');
    email.sendClientEmail.mockClear(); push.sendPushToEmail.mockClear(); push.sendPushToRole.mockClear();
    cid = (await pool.query("INSERT INTO companies (nev) VALUES ('A SRL') RETURNING id")).rows[0].id;
    adminId = (await pool.query("INSERT INTO users (nume,email,pozicio,password_hash,company_id) VALUES ($1,$2,'Admin','x',$3) RETURNING id", [ADMIN.nume, ADMIN.email, cid])).rows[0].id;
    mgrId = (await pool.query("INSERT INTO users (nume,email,pozicio,password_hash,company_id) VALUES ($1,$2,'Manager','x',$3) RETURNING id", [MGR.nume, MGR.email, cid])).rows[0].id;
    await pool.query("INSERT INTO users (nume,email,pozicio,password_hash,company_id) VALUES ($1,$2,'Sofer','x',$3)", [SOFER.nume, SOFER.email, cid]);
    await pool.query("INSERT INTO vehicles (company_id, rendszam, tip, assigned_driver_email) VALUES ($1,$2,'Vontato',$3)", [cid, PLATE, SOFER.email]);
    Object.assign(ADMIN, { id: adminId, company_id: cid }); Object.assign(MGR, { id: mgrId, company_id: cid });
  });

  async function gpsDay(daysAgo, dropL) {
    const day = new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);
    const ds = Date.parse(day + 'T00:00:00Z') / 1000 - 2 * 3600;
    const pts = dayTrack(ds, dropL);
    await pool.query(
      `INSERT INTO gps_track_days (company_id, rendszam, day, points_json, point_count, complete)
       VALUES ($1,$2,$3::date,$4,$5,true)`, [cid, PLATE, day, JSON.stringify(pts), pts.length]);
    return day;
  }

  test('üzemanyag: 150 L hiány → iroda kap értesítést, sofőr nem', async () => {
    const fl = require('../../lib/fuelLossAlert');
    const day = await gpsDay(2, 150);
    const r = await fl.runRound({ limit: 10 });
    expect(r.alerts).toBe(1);
    const row = (await pool.query('SELECT * FROM fuel_loss_alerts WHERE day=$1', [day])).rows[0];
    expect(Number(row.total_l)).toBeGreaterThan(100);
    expect(row.level).toBe(1);
    expect(push.sendPushToRole).toHaveBeenCalled();
    expect(push.sendPushToEmail).not.toHaveBeenCalled();
    const to = email.sendClientEmail.mock.calls.map((c) => c[0].to);
    expect(to).toEqual(expect.arrayContaining([ADMIN.email, MGR.email]));
    expect(to).not.toContain(SOFER.email);
    const n = (await pool.query("SELECT COUNT(*)::int AS n FROM notifications WHERE type='fuel_loss'")).rows[0].n;
    expect(n).toBe(1);
    // ismételt futás nem küld újra
    await pool.query('UPDATE fuel_loss_alerts SET checked_at = NOW() - INTERVAL \'13 hours\'');
    email.sendClientEmail.mockClear();
    expect((await fl.runRound({ limit: 10 })).alerts).toBe(0);
    expect(email.sendClientEmail).not.toHaveBeenCalled();
  });

  test('üzemanyag: 300 L hiány → a sofőr is kap e-mailt és push-t', async () => {
    const fl = require('../../lib/fuelLossAlert');
    await gpsDay(2, 300);
    await fl.runRound({ limit: 10 });
    const to = email.sendClientEmail.mock.calls.map((c) => c[0].to);
    expect(to).toContain(SOFER.email);
    expect(push.sendPushToEmail).toHaveBeenCalledWith([SOFER.email], expect.any(Object), cid);
    const body = email.sendClientEmail.mock.calls.map((c) => c[0].html).join(' ');
    expect(body).not.toMatch(/furt/i);
  });

  test('üzemanyag: kis (30 L) eltérés → nincs riasztás', async () => {
    const fl = require('../../lib/fuelLossAlert');
    await gpsDay(2, 30);
    expect((await fl.runRound({ limit: 10 })).alerts).toBe(0);
    expect(email.sendClientEmail).not.toHaveBeenCalled();
  });

  test('útdíj: kézzel beírt értéket nem írja felül, üreset kitölt', async () => {
    const at = require('../../lib/orderAutoToll');
    const rg = JSON.stringify({ src: 'here-truck', sig: 'pickup|A > delivery|B', km: 100, waypoints: [] });
    await pool.query(`INSERT INTO orders (id, company_id, status, loc_incarcare, loc_descarcare, route_geo, toll_cost)
                      VALUES ('O1',$1,'Disponibil','A','B',$2::jsonb,NULL), ('O2',$1,'Disponibil','A','B',$2::jsonb,77)`, [cid, rg]);
    const q = (await at.pickQueue(10)).map((x) => x.id);
    expect(q).toContain('O1');
    expect(q).not.toContain('O2');                      // kézi érték
  });

  test('lejárat → feladat felelőssel; csak az új dátum zárja le', async () => {
    await pool.query(`INSERT INTO document_expiries (company_id, entity_type, entity_label, doc_type, expiry_date, alert_days)
                      VALUES ($1,'vehicle',$2,'ITP', CURRENT_DATE + 10, 30)`, [cid, PLATE]);
    await call(fleet, 'expiryDefaultOwnerSet', ADMIN, { owner_id: mgrId });
    const n = await fleet.openExpiryTasks();
    expect(n).toBe(1);
    let it = (await pool.query('SELECT * FROM document_expiries')).rows[0];
    expect(it.task_opened_at).toBeTruthy();
    expect(it.task_owner_id).toBe(mgrId);
    const nt = (await pool.query("SELECT user_id FROM notifications WHERE type='expiry_task'")).rows;
    expect(nt.map((x) => x.user_id)).toContain(mgrId);
    // második futás nem nyit újra / nem értesít újra
    expect(await fleet.openExpiryTasks()).toBe(0);

    // felelős átadása az Adminnak
    expect((await call(fleet, 'expiryAssign', MGR, { id: it.id, owner_id: adminId })).ok).toBe(true);
    // még a figyelmeztetési időn belüli új dátum → nyitva marad
    const near = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
    const r = await (async () => {
      const res = { body: null, json(o) { this.body = o; return this; } };
      await fleet.expirySave({ session: { user: ADMIN }, headers: {} }, res, [it.id, { entity_type: 'vehicle', entity_label: PLATE, doc_type: 'ITP', expiry_date: near, alert_days: 30 }]);
      return res.body.result;
    })();
    expect(r.task_closed).toBe(false);
    // megújítás egy évvel → lezárul
    const far = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
    const res = { body: null, json(o) { this.body = o; return this; } };
    await fleet.expirySave({ session: { user: ADMIN }, headers: {} }, res, [it.id, { entity_type: 'vehicle', entity_label: PLATE, doc_type: 'ITP', expiry_date: far, alert_days: 30 }]);
    expect(res.body.result.task_closed).toBe(true);
    it = (await pool.query('SELECT * FROM document_expiries')).rows[0];
    expect(it.task_opened_at).toBeNull();
    expect(it.task_closed_at).toBeTruthy();
    expect(it.task_closed_by).toBe(ADMIN.email);
  });

  test('lejárat: más cég felhasználója nem lehet felelős', async () => {
    const other = (await pool.query("INSERT INTO companies (nev) VALUES ('B') RETURNING id")).rows[0].id;
    const ou = (await pool.query("INSERT INTO users (nume,email,pozicio,password_hash,company_id) VALUES ('X','x@b.ro','Admin','x',$1) RETURNING id", [other])).rows[0].id;
    const e = (await pool.query(`INSERT INTO document_expiries (company_id, doc_type, expiry_date) VALUES ($1,'RCA',CURRENT_DATE+5) RETURNING id`, [cid])).rows[0].id;
    expect((await call(fleet, 'expiryAssign', ADMIN, { id: e, owner_id: ou })).ok).toBe(false);
  });

  test('devAuditUsage: csak developer, és összesít', async () => {
    await pool.query(`INSERT INTO audit_log (company_id, user_email, action) VALUES ($1,'a@x.ro','order.create'),($1,'a@x.ro','order.create'),($1,'b@x.ro','border.update')`, [cid]);
    expect((await call(dev, 'devAuditUsage', ADMIN, {})).ok).toBe(false);
    const r = await call(dev, 'devAuditUsage', { email: 'd@v.ro', is_dev: true }, { days: 7 });
    expect(r.ok).toBe(true);
    expect(r.total).toBe(3);
    expect(r.by_action[0]).toMatchObject({ action: 'order.create', n: 2 });
  });
});
