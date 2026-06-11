// ============================================================
//  services/invoicing.js — K09 híd az univerzális számlázó-keretrendszerhez
//  (fuvar-számlázás: billing_integrations elsőbbség, legacy FGO fallback)
// ============================================================
const crypto = require('crypto');
process.env.INTEGRATION_ENC_KEY = process.env.INTEGRATION_ENC_KEY || crypto.randomBytes(32).toString('hex');
const { encrypt } = require('../../lib/crypto');
const svc = require('../../services/invoicing');

// Fake pool: sorrendben adja vissza a beállított eredményeket.
function fakePool(results) {
  let i = 0;
  return { query: async () => results[i++] || { rows: [] } };
}

const LEGACY_PAYLOAD = {
  serie: 'BV',
  issueDate: '2026-06-10',
  dueDate: '2026-06-25',
  currency: 'EUR',
  notes: 'megjegyzés',
  client: { name: 'Teszt Kft', cui: 'RO123456', address: 'Str. X 1', email: 'a@b.ro' },
  lines: [{ name: 'Transport marfă', description: 'Comanda CMD-1', unit: 'BUC', qty: 1, vatRate: 21, unitPrice: 100 }],
  reverseCharge: false,
};

describe('toFrameworkInvoice — legacy payload → keretrendszer-formátum', () => {
  test('mező-leképezés (cui→vat_code, qty→quantity, unitPrice→price_net)', () => {
    const d = svc.toFrameworkInvoice(LEGACY_PAYLOAD);
    expect(d.issue_date).toBe('2026-06-10');
    expect(d.due_date).toBe('2026-06-25');
    expect(d.currency).toBe('EUR');
    expect(d.client.vat_code).toBe('RO123456');
    expect(d.items[0].quantity).toBe(1);
    expect(d.items[0].price_net).toBe(100);
    expect(d.items[0].vat_percent).toBe(21);
  });

  test('fordított adózás: ÁFA 0 + Taxare inversă megjegyzés', () => {
    const d = svc.toFrameworkInvoice({ ...LEGACY_PAYLOAD, reverseCharge: true });
    expect(d.items[0].vat_percent).toBe(0);
    expect(d.notes).toContain('Taxare inversă');
  });

  test('hiányzó dueDate esetén az issue_date a lejárat', () => {
    const d = svc.toFrameworkInvoice({ ...LEGACY_PAYLOAD, dueDate: '' });
    expect(d.due_date).toBe('2026-06-10');
  });
});

describe('emitViaProvider — keretrendszer-út', () => {
  test('FGO hiányzó CodUnic-kal hálózat nélkül hibát ad (nem dob)', async () => {
    const cfg = { source: 'framework', provider: 'fgo', creds: { api_key: 'x' } };
    const r = await svc.emitViaProvider(cfg, LEGACY_PAYLOAD);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('CodUnic');
  });
});

describe('getInvoiceConfig — konfig-forrás elsőbbség', () => {
  test('aktív billing_integrations esetén a keretrendszer nyer', async () => {
    const creds = { username: 'u', token: 't', company_vat_code: 'RO1', serie: 'vs', default_tva: '11', currency: 'eur' };
    const pool = fakePool([
      { rows: [{ provider: 'smartbill', credentials: { enc: encrypt(JSON.stringify(creds)) } }] },
    ]);
    const cfg = await svc.getInvoiceConfig(pool, 1);
    expect(cfg.source).toBe('framework');
    expect(cfg.provider).toBe('smartbill');
    expect(cfg.series).toEqual(['vs']);
    expect(cfg.defaultTva).toBe(11);
    expect(cfg.currency).toBe('EUR');
    expect(cfg.creds.token).toBe('t');
  });

  test('számla-beállítások nélkül észszerű alapértékek', async () => {
    const pool = fakePool([
      { rows: [{ provider: 'oblio', credentials: { enc: encrypt(JSON.stringify({ email: 'e', secret: 's' })) } }] },
    ]);
    const cfg = await svc.getInvoiceConfig(pool, 1);
    expect(cfg.series).toEqual([]);
    expect(cfg.defaultTva).toBe(21);
    expect(cfg.currency).toBe('RON');
    expect(cfg.vatPayer).toBe(true);
  });

  test('keretrendszer-konfig híján a legacy (FGO) fallback él', async () => {
    const pool = fakePool([
      { rows: [] }, // billing_integrations: nincs
      { rows: [{ credentials_enc: encrypt(JSON.stringify({ CodUnic: 'RO9', PrivateKey: 'pk' })), enabled: true, meta: { provider: 'fgo', serie: 'BV', default_tva: 21 } }] },
    ]);
    const cfg = await svc.getInvoiceConfig(pool, 1);
    expect(cfg.source).toBe('legacy');
    expect(cfg.provider).toBe('fgo');
    expect(cfg.series).toEqual(['BV']);
    expect(cfg.creds.CodUnic).toBe('RO9');
  });

  test('egyik forrás sincs → null', async () => {
    const pool = fakePool([{ rows: [] }, { rows: [] }]);
    expect(await svc.getInvoiceConfig(pool, 1)).toBeNull();
  });
});
