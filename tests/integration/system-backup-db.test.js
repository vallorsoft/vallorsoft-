// Teljes rendszer-mentés → visszaállítás egy ÜRES adatbázisba (valódi Postgres +
// pg_dump/pg_restore + hamis S3). Kihagyva, ha nincs DATABASE_URL vagy pg_dump.
const { execSync } = require('child_process');
const { hasDb, loadSchema } = require('../helpers/real-db');

let pgOk = false;
try { execSync('pg_dump --version && pg_restore --version', { stdio: 'ignore' }); pgOk = true; } catch (_) {}
const d = hasDb() && pgOk ? describe : describe.skip;

d('teljes rendszer-mentés + visszaállítás (valódi DB)', () => {
  jest.setTimeout(120000);
  let pool, fake, target, admin, tdb;
  const saved = {};
  const ENV = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_ENDPOINT', 'INTEGRATION_ENC_KEY'];
  beforeAll(async () => {
    ENV.forEach((k) => { saved[k] = process.env[k]; });
    fake = await require('../helpers/fake-s3').start();
    Object.assign(process.env, { R2_ACCOUNT_ID: 'a', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's', R2_BUCKET: 'b', R2_ENDPOINT: fake.url,
      INTEGRATION_ENC_KEY: process.env.INTEGRATION_ENC_KEY || 'b'.repeat(64) });
    pool = require('../../db');
    await loadSchema(pool);
    const { Pool } = require('pg');
    const u = new URL(process.env.DATABASE_URL);
    tdb = u.pathname.slice(1) + '_restore_' + process.pid;
    admin = new Pool({ connectionString: process.env.DATABASE_URL });
    await admin.query('DROP DATABASE IF EXISTS ' + tdb);
    await admin.query('CREATE DATABASE ' + tdb);
    u.pathname = '/' + tdb;
    target = u.toString();
  });
  afterAll(async () => {
    try { await require('../../services/systemBackup').removeTriggers(pool); } catch (_) {}
    try { await admin.query('DROP DATABASE IF EXISTS ' + tdb); } catch (_) {}
    if (admin) await admin.end();
    if (fake) fake.server.close();
    ENV.forEach((k) => { if (saved[k] == null) delete process.env[k]; else process.env[k] = saved[k]; });
  });

  test('teljes + 2 változás-mentés → üres adatbázisba visszaállítva, adat egyezik', async () => {
    const sys = require('../../services/systemBackup');
    const rst = require('../../services/systemRestore');
    await pool.query('DELETE FROM system_backup_runs').catch(() => {});
    const cid = (await pool.query(`INSERT INTO companies (nev) VALUES ('SysTest') RETURNING id`)).rows[0].id;
    await pool.query(`INSERT INTO orders (id, company_id, client, status, pret) VALUES ('ST1',$1,'a','Disponibil',100),('ST2',$1,'b','Disponibil',200)`, [cid]);
    expect((await sys.run({ trigger: 'manual', forceFull: true })).ok).toBe(true);
    await pool.query(`UPDATE orders SET pret=999 WHERE id='ST1'`);
    await pool.query(`DELETE FROM orders WHERE id='ST2'`);
    await pool.query(`INSERT INTO orders (id, company_id, client, status, route_geo) VALUES ('ST3',$1,'c','Alocat','{"km":12,"w":[1,2]}')`, [cid]);
    await pool.query(`INSERT INTO inbound_orders (company_id, pdf_name, pdf_data, status, extracted) VALUES ($1,'a.pdf',$2,'pending','{"a":[1]}')`, [cid, Buffer.from([0, 1, 255])]);
    const d1 = await sys.run({ trigger: 'manual' });
    expect(d1).toMatchObject({ ok: true, kind: 'delta' });
    await pool.query(`UPDATE orders SET status='Finalizat' WHERE id='ST3'`);
    expect((await sys.run({ trigger: 'manual' })).kind).toBe('delta');

    const r = await rst.restore({ targetUrl: target });
    expect(r.deltas).toBe(2);
    const { Pool } = require('pg');
    const tp = new Pool({ connectionString: target });
    try {
      const q = `SELECT id, pret, status, route_geo FROM orders WHERE company_id=$1 ORDER BY id`;
      expect((await tp.query(q, [cid])).rows).toEqual((await pool.query(q, [cid])).rows);
      const q2 = `SELECT pdf_data, extracted FROM inbound_orders WHERE company_id=$1`;
      expect((await tp.query(q2, [cid])).rows).toEqual((await pool.query(q2, [cid])).rows);
      const n = (await tp.query(`INSERT INTO companies (nev) VALUES ('x') RETURNING id`)).rows[0].id;
      expect(n).toBeGreaterThan(cid);   // a sorozat is folytatódik
    } finally { await tp.end(); }
  });
});
