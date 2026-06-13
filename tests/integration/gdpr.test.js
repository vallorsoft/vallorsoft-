// ============================================================
//  GDPR handlerek (valódi DB): export + anonymizeUser
// ============================================================
const { loadSchema, hasDb } = require('../helpers/real-db');
const pool = require('../../db');
const h = require('../../handlers/gdpr');

function makeRes() { const res = { body: null }; res.json = (o) => { res.body = o; return res; }; res.status = () => res; return res; }

const d = hasDb() ? describe : describe.skip;

d('GDPR (valódi DB)', () => {
  jest.setTimeout(40000);
  let cid, uid;
  // az admin id-je szándékosan NEM ütközik a beszúrt user id-jével
  const admin = (extra) => ({ session: { user: Object.assign({ company_id: cid, email: 'admin@x.hu', pozicio: 'Admin', id: 999 }, extra || {}) } });

  beforeAll(async () => { await loadSchema(pool); });
  afterAll(async () => { await pool.end(); });
  beforeEach(async () => {
    await pool.query('TRUNCATE users, orders, clients, vehicles, carriers, companies, audit_log RESTART IDENTITY CASCADE');
    const c = await pool.query("INSERT INTO companies (nev) VALUES ('Acme') RETURNING id");
    cid = c.rows[0].id;
    const u = await pool.query("INSERT INTO users (nume, email, tel, pozicio, password_hash, company_id) VALUES ('Sofor Bela', 'bela@x.hu', '0712', 'Sofer', 'h', $1) RETURNING id", [cid]);
    uid = u.rows[0].id;
  });

  test('exportCompanyData: cégre szűrt adat, jelszó-hash nélkül; nem-admin tiltva', async () => {
    const res = makeRes();
    await h.exportCompanyData(admin(), res);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.data.company.nev).toBe('Acme');
    expect(res.body.result.data.users.length).toBe(1);
    expect(res.body.result.data.users[0]).not.toHaveProperty('password_hash');

    const res2 = makeRes();
    await h.exportCompanyData({ session: { user: { company_id: cid, pozicio: 'Manager' } } }, res2);
    expect(res2.body.result.ok).toBe(false);
  });

  test('anonymizeUser: PII törlés + tiltás', async () => {
    const res = makeRes();
    await h.anonymizeUser(admin(), res, [uid]);
    expect(res.body.result.ok).toBe(true);
    const u = (await pool.query('SELECT nume, email, tel, blocked FROM users WHERE id = $1', [uid])).rows[0];
    expect(u.nume).toBe('(anonimizat)');
    expect(u.email).toContain('anonimizat.local');
    expect(u.tel).toBeNull();
    expect(u.blocked).toBe(true);
  });

  test('anonymizeUser: önmagát nem, ismeretlen → hiba', async () => {
    const r1 = makeRes();
    await h.anonymizeUser(admin({ id: uid }), r1, [uid]); // self
    expect(r1.body.result.ok).toBe(false);
    const r2 = makeRes();
    await h.anonymizeUser(admin(), r2, [999999]);
    expect(r2.body.result.ok).toBe(false);
  });
});
