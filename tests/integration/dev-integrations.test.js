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
    // Új API: provider-szintű sablon-map (üres) + legacy oszlop (null) + GPS-katalógus.
    expect(res.body.result.uit_templates).toEqual({});
    expect(res.body.result.uit_template_legacy).toBeNull();
    expect(Array.isArray(res.body.result.gps_providers)).toBe(true);
    expect(res.body.result.gps_providers.length).toBeGreaterThan(0);
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

  test('devSaveCompanyUit provider-szintű mentés + olvasás vissza', async () => {
    // CargoTrack sablon mentése a provider-map-be.
    const s = makeRes();
    await h.devSaveCompanyUit(dev(), s, [cid, { provider: 'cargotrack', template: 'https://ct.ro/{rendszam}' }]);
    expect(s.body.result.ok).toBe(true);
    const res = makeRes();
    await h.devGetCompanyIntegrations(dev(), res, [cid]);
    expect(res.body.result.uit_templates.cargotrack).toBe('https://ct.ro/{rendszam}');

    // Második provider (fomco) — a két sablon egymás mellett él meg.
    await h.devSaveCompanyUit(dev(), makeRes(), [cid, { provider: 'fomco', template: 'https://fomco.ro/{uit}' }]);
    const res2 = makeRes();
    await h.devGetCompanyIntegrations(dev(), res2, [cid]);
    expect(res2.body.result.uit_templates.cargotrack).toBe('https://ct.ro/{rendszam}');
    expect(res2.body.result.uit_templates.fomco).toBe('https://fomco.ro/{uit}');

    // Üres sablon → a provider-kulcs törlődik a map-ből.
    await h.devSaveCompanyUit(dev(), makeRes(), [cid, { provider: 'fomco', template: '' }]);
    const res3 = makeRes();
    await h.devGetCompanyIntegrations(dev(), res3, [cid]);
    expect(res3.body.result.uit_templates.fomco).toBeUndefined();
    expect(res3.body.result.uit_templates.cargotrack).toBe('https://ct.ro/{rendszam}');
  });

  test('devSaveCompanyUit validációk: http-séma + GPS-provider', async () => {
    // Nem http(s) séma → elutasít.
    const bad = makeRes();
    await h.devSaveCompanyUit(dev(), bad, [cid, { provider: 'cargotrack', template: 'ftp://x' }]);
    expect(bad.body.result.ok).toBe(false);
    // Ismeretlen GPS-provider → elutasít.
    const badProv = makeRes();
    await h.devSaveCompanyUit(dev(), badProv, [cid, { provider: 'nincs_ilyen', template: 'https://x.ro' }]);
    expect(badProv.body.result.ok).toBe(false);
  });

  test('devSaveCompanyUit legacy (provider nélküli) út a régi oszlopra', async () => {
    await h.devSaveCompanyUit(dev(), makeRes(), [cid, { template: 'https://legacy.ro/{rendszam}' }]);
    const res = makeRes();
    await h.devGetCompanyIntegrations(dev(), res, [cid]);
    expect(res.body.result.uit_template_legacy).toBe('https://legacy.ro/{rendszam}');
  });

  test('nem-dev tiltva', async () => {
    const res = makeRes();
    await h.devGetCompanyIntegrations({ session: { user: { pozicio: 'Admin' } } }, res, [cid]);
    expect(res.body.result.ok).toBe(false);
  });
});
