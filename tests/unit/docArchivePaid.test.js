// Fizetős felhő-archiválás: sávos ár, kérés/aktiválás, türelmi idő, R2-feltöltés.
jest.mock('../../db', () => ({ query: jest.fn() }));
const pool = require('../../db');
const arch = require('../../lib/docArchive');
const GB = 1024 * 1024 * 1024;

describe('éves díj sávosan', () => {
  test.each([
    [0.3, 10], [1, 10], [1.5, 20], [2, 20], [5, 20], [5.1, 32], [15, 32], [15.5, 68], [50, 68],
  ])('%s GB → %s EUR / év', (gb, eur) => { expect(arch.tierFor(gb * GB).eur).toBe(eur); });
  test('50 GB felett → konzultáció', () => { expect(arch.tierFor(50.01 * GB)).toBeNull(); });
});

describe('kérés + türelmi idő', () => {
  beforeEach(() => { pool.query.mockReset(); arch.invalidate(5); });
  test('függő kérés mellett nem lehet újat kérni', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    const r = await arch.createOrder(5, 1, 'a@b.ro');
    expect(r.ok).toBe(false);
    expect(pool.query.mock.calls[0][1]).toEqual([5]);
  });
  test('50 GB felett nincs kérés (konzultáció)', async () => {
    pool.query.mockImplementation((sql) => {
      if (/status='pending' AND pay_until > NOW\(\) LIMIT 1/.test(sql)) return Promise.resolve({ rows: [] });
      if (/FROM order_documents/.test(sql)) return Promise.resolve({ rows: [{ n: 60 * GB }] });
      return Promise.resolve({ rows: [{ n: 0 }] });
    });
    const r = await arch.createOrder(5, 2, 'a@b.ro');
    expect(r).toMatchObject({ ok: false, consult: true });
    expect(pool.query.mock.calls.some((c) => /INSERT INTO doc_archive_orders/.test(c[0]))).toBe(false);
  });
  const statusWith = async (dueDays, order, paidUntil) => {
    pool.query.mockImplementation((sql) => {
      if (/SELECT created_at, doc_archive_due_at/.test(sql)) return Promise.resolve({ rows: [{ created_at: null, doc_archive_due_at: new Date(Date.now() + dueDays * 86400000) }] });
      if (/SELECT doc_archive_paid_until/.test(sql)) return Promise.resolve({ rows: [{ doc_archive_paid_until: paidUntil || null }] });
      if (/FROM doc_archive_orders WHERE company_id=\$1 ORDER BY/.test(sql)) return Promise.resolve({ rows: order ? [order] : [] });
      return Promise.resolve({ rows: [{}] });
    });
    return arch.status(5);
  };
  test('zár + függő (48 órán belüli) kérés → grace, nincs zár', async () => {
    expect((await statusWith(2, { status: 'pending', pay_until: new Date(Date.now() + 3600000) })).phase).toBe('grace');
    arch.invalidate(5);
    expect(await arch.isLocked(5)).toBe(false);
  });
  test('lejárt kérés → újra zár', async () => {
    expect((await statusWith(2, { status: 'expired' })).phase).toBe('lock');
  });
  test('aktív fizetett archiválás → paid, nincs figyelmeztetés', async () => {
    expect((await statusWith(2, { status: 'paid' }, new Date(Date.now() + 100 * 86400000))).phase).toBe('paid');
  });
});

describe('Cloudflare R2 feltöltés (hamis S3-szerver)', () => {
  let fake;
  const env = {};
  beforeAll(async () => {
    fake = await require('../helpers/fake-s3').start();
    Object.assign(env, process.env);
    Object.assign(process.env, { R2_ACCOUNT_ID: 'acc', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's', R2_BUCKET: 'b', R2_ENDPOINT: fake.url });
  });
  afterAll(() => { fake.server.close(); ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_ENDPOINT'].forEach((k) => { if (env[k] == null) delete process.env[k]; else process.env[k] = env[k]; }); });

  test('darabolt feltöltés (több rész) + letöltés + törlés', async () => {
    const r2 = require('../../lib/r2');
    expect(r2.configured()).toBe(true);
    const data = require('crypto').randomBytes(r2.PART + 1234);
    const w = r2.createUploadStream('doc-archives/5/x.zip.enc');
    await new Promise((ok, ko) => { w.on('finish', ok); w.on('error', ko); w.write(data.subarray(0, 1000)); w.end(data.subarray(1000)); });
    expect(fake.objects.get('doc-archives/5/x.zip.enc').equals(data)).toBe(true);
    const got = Buffer.from(await (await r2.getObject('doc-archives/5/x.zip.enc')).arrayBuffer());
    expect(got.equals(data)).toBe(true);
    await r2.deleteObject('doc-archives/5/x.zip.enc');
    expect(fake.objects.has('doc-archives/5/x.zip.enc')).toBe(false);
  }, 30000);

  test('nincs beállítva → configured() false', () => {
    const save = process.env.R2_BUCKET; delete process.env.R2_BUCKET;
    expect(require('../../lib/r2').configured()).toBe(false);
    process.env.R2_BUCKET = save;
  });
});
