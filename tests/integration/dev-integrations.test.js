// ============================================================
//  Developer per-cég integrációk: maps provider + UIT deep-link (valódi DB)
// ============================================================
process.env.INTEGRATION_ENC_KEY = process.env.INTEGRATION_ENC_KEY || require('crypto').randomBytes(32).toString('hex');
const { loadSchema, hasDb } = require('../helpers/real-db');
const pool = require('../../db');
const h = require('../../handlers/mapsProvider');

function makeRes() { const res = { body: null }; res.json = (o) => { res.body = o; return res; }; res.status = () => res; return res; }

const d = hasDb() ? describe : describe.skip;

d('Developer per-cég integrációk (valódi DB)', () => {
  jest.setTimeout(40000);
  let cid;
  const dev = () => ({ session: { user: { is_dev: true, pozicio: 'Admin' } } });

  beforeAll(async () => { await loadSchema(pool); });
  afterAll(async () => { await pool.end(); });
  beforeEach(async () => {
    await pool.query('TRUNCATE company_integrations, companies RESTART IDENTITY CASCADE');
    const c = await pool.query("INSERT INTO companies (nev) VALUES ('Acme') RETURNING id");
    cid = c.rows[0].id;
  });

  test('alapból free, kulcs/sablon nélkül', async () => {
    const res = makeRes();
    await h.devGetCompanyIntegrations(dev(), res, [cid]);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.maps.vendor).toBe('free');
    expect(res.body.result.maps.has_key).toBe(false);
    expect(res.body.result.uit_template).toBeNull();
  });

  test('devSaveCompanyMaps HERE+kulcs → vendor=here, has_key=true; üres újra-mentés megőrzi', async () => {
    await h.devSaveCompanyMaps(dev(), makeRes(), [cid, { vendor: 'here', key: 'SECRET123' }]);
    let res = makeRes();
    await h.devGetCompanyIntegrations(dev(), res, [cid]);
    expect(res.body.result.maps.vendor).toBe('here');
    expect(res.body.result.maps.has_key).toBe(true);
    await h.devSaveCompanyMaps(dev(), makeRes(), [cid, { vendor: 'here', key: '' }]);
    res = makeRes();
    await h.devGetCompanyIntegrations(dev(), res, [cid]);
    expect(res.body.result.maps.has_key).toBe(true);
  });

  test('vendor=free letiltja', async () => {
    await h.devSaveCompanyMaps(dev(), makeRes(), [cid, { vendor: 'here', key: 'K' }]);
    await h.devSaveCompanyMaps(dev(), makeRes(), [cid, { vendor: 'free' }]);
    const res = makeRes();
    await h.devGetCompanyIntegrations(dev(), res, [cid]);
    expect(res.body.result.maps.vendor).toBe('free');
  });

  test('devSaveCompanyUit ment + http-validáció', async () => {
    await h.devSaveCompanyUit(dev(), makeRes(), [cid, { template: 'https://ct.ro/{rendszam}' }]);
    const res = makeRes();
    await h.devGetCompanyIntegrations(dev(), res, [cid]);
    expect(res.body.result.uit_template).toBe('https://ct.ro/{rendszam}');
    const bad = makeRes();
    await h.devSaveCompanyUit(dev(), bad, [cid, { template: 'ftp://x' }]);
    expect(bad.body.result.ok).toBe(false);
  });

  test('nem-dev tiltva', async () => {
    const res = makeRes();
    await h.devGetCompanyIntegrations({ session: { user: { pozicio: 'Admin' } } }, res, [cid]);
    expect(res.body.result.ok).toBe(false);
  });
});
