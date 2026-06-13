// ============================================================
//  UIT deep-link handlerek (valódi DB)
// ============================================================
const { loadSchema, hasDb } = require('../helpers/real-db');
const pool = require('../../db');
const h = require('../../handlers/uitDeeplink');

function makeRes() { const res = { body: null }; res.json = (o) => { res.body = o; return res; }; res.status = () => res; return res; }

const d = hasDb() ? describe : describe.skip;

d('UIT deep-link (valódi DB)', () => {
  jest.setTimeout(40000);
  let cid;
  const admin = () => ({ session: { user: { company_id: cid, email: 'a@x.hu', pozicio: 'Admin' } } });

  beforeAll(async () => { await loadSchema(pool); });
  afterAll(async () => { await pool.end(); });
  beforeEach(async () => {
    await pool.query('TRUNCATE orders, companies RESTART IDENTITY CASCADE');
    const c = await pool.query("INSERT INTO companies (nev) VALUES ('T') RETURNING id");
    cid = c.rows[0].id;
  });

  test('nincs sablon → reason:not-configured', async () => {
    await pool.query("INSERT INTO orders (id, company_id, status) VALUES ('CMD-1', $1, 'Alocat')", [cid]);
    const res = makeRes();
    await h.getUitDeeplink(admin(), res, ['CMD-1']);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.reason).toBe('not-configured');
  });

  test('setUitDeeplinkConfig + getUitDeeplink URL-t épít', async () => {
    await h.setUitDeeplinkConfig(admin(), makeRes(), [{ template: 'https://ct.ro/uit?plate={rendszam}' }]);
    await pool.query("INSERT INTO orders (id, company_id, status, rendszam_camion) VALUES ('CMD-2', $1, 'Alocat', 'B104VLR')", [cid]);
    const res = makeRes();
    await h.getUitDeeplink(admin(), res, ['CMD-2']);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.url).toBe('https://ct.ro/uit?plate=B104VLR');
  });

  test('setUitDeeplinkConfig elutasít nem-http sablont', async () => {
    const res = makeRes();
    await h.setUitDeeplinkConfig(admin(), res, [{ template: 'ftp://bad' }]);
    expect(res.body.result.ok).toBe(false);
  });

  test('Sofőr CSAK a saját fuvarjához kap linket', async () => {
    await h.setUitDeeplinkConfig(admin(), makeRes(), [{ template: 'https://ct.ro/{id}' }]);
    await pool.query("INSERT INTO orders (id, company_id, status, email_sofer) VALUES ('CMD-3', $1, 'In Curs', 'sofor@x.hu')", [cid]);
    const own = { session: { user: { company_id: cid, email: 'sofor@x.hu', pozicio: 'Sofer' } } };
    const other = { session: { user: { company_id: cid, email: 'masik@x.hu', pozicio: 'Sofer' } } };
    const r1 = makeRes(); await h.getUitDeeplink(own, r1, ['CMD-3']);
    expect(r1.body.result.ok).toBe(true);
    const r2 = makeRes(); await h.getUitDeeplink(other, r2, ['CMD-3']);
    expect(r2.body.result.ok).toBe(false);
  });

  test('getUitDeeplinkConfig csak Admin', async () => {
    const res = makeRes();
    await h.getUitDeeplinkConfig({ session: { user: { company_id: cid, pozicio: 'Manager' } } }, res);
    expect(res.body.result.ok).toBe(false);
  });
});
