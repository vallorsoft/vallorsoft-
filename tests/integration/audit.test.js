// ============================================================
//  Audit-napló (valódi DB) — record + getAuditLog cég-szűrés
// ============================================================
const { loadSchema, hasDb } = require('../helpers/real-db');
const pool = require('../../db');
const auditLib = require('../../lib/audit');
const auditH = require('../../handlers/audit');

function makeRes() { const res = { body: null }; res.json = (o) => { res.body = o; return res; }; res.status = () => res; return res; }
function reqAs(user) { return { session: { user } }; }

const d = hasDb() ? describe : describe.skip;

d('Audit-napló (valódi DB)', () => {
  jest.setTimeout(40000);
  let companyId;
  beforeAll(async () => { await loadSchema(pool); });
  afterAll(async () => { await pool.end(); });
  beforeEach(async () => {
    await pool.query('TRUNCATE audit_log RESTART IDENTITY');
    const c = await pool.query("INSERT INTO companies (nev) VALUES ('Teszt Kft') RETURNING id");
    companyId = c.rows[0].id;
  });

  test('record beír egy sort; getAuditLog (Admin) CSAK a saját céget adja vissza', async () => {
    expect(await auditLib.record({ company_id: companyId, user_email: 'a@x.hu', action: 'order.delete', entity_type: 'order', entity_id: 'CMD-1' })).toBe(true);
    await auditLib.record({ company_id: companyId + 999, action: 'order.delete', entity_id: 'CMD-2' }); // másik cég
    const res = makeRes();
    await auditH.getAuditLog(reqAs({ company_id: companyId, email: 'a@x.hu', pozicio: 'Admin' }), res, [{}]);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.rows.length).toBe(1);
    expect(res.body.result.rows[0].action).toBe('order.delete');
    expect(res.body.result.rows[0].entity_id).toBe('CMD-1');
  });

  test('getAuditLog action-szűrővel', async () => {
    await auditLib.record({ company_id: companyId, action: 'login.success' });
    await auditLib.record({ company_id: companyId, action: 'order.delete' });
    const res = makeRes();
    await auditH.getAuditLog(reqAs({ company_id: companyId, pozicio: 'Admin' }), res, [{ action: 'login.success' }]);
    expect(res.body.result.rows.length).toBe(1);
    expect(res.body.result.rows[0].action).toBe('login.success');
  });

  test('nem-Admin nem olvashatja → ok:false', async () => {
    const res = makeRes();
    await auditH.getAuditLog(reqAs({ company_id: companyId, pozicio: 'Manager' }), res, [{}]);
    expect(res.body.result.ok).toBe(false);
  });
});
