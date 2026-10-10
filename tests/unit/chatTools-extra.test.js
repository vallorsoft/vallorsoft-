// ============================================================
//  Unit-teszt — lib/chatTools/extra.js (6. kör). DB + handlerek mockolva.
// ============================================================
let mockRules = [];
const mockDbQuery = jest.fn(async (sql, params) => {
  for (const r of mockRules) if (r.match.test(sql)) return r.fn ? r.fn(sql, params) : { rows: r.rows || [] };
  return { rows: [] };
});
jest.mock('../../db', () => ({ query: (...a) => mockDbQuery(...a) }));
jest.mock('../../lib/featureEnabled', () => ({ featureEnabled: async () => true }));
jest.mock('../../lib/audit', () => ({ fromReq: jest.fn(async () => {}) }));
jest.mock('../../handlers/permissions', () => {
  const o = { hasPerm: async () => true, setUserPermission: (...a) => mockH.permissions.setUserPermission(...a) };
  Object.defineProperty(o, 'hasPerm', { enumerable: false, value: async () => true });
  return o;
});
const j = (x) => jest.fn((req, res) => res.json({ result: x }));
const mockH = {
  fleet: { extDriverCreate: j({ ok: true, id: 31 }), extDriverUpdate: j({ ok: true }), extDriverDelete: j({ ok: true }) },
  documents: { reassignDriverWaybills: j({ ok: true }), purgeDriverData: j({ ok: true }), getWaybillKmGaps: j({ ok: true, gaps: [] }) },
  permissions: { setUserPermission: j({ ok: true }) },
  receiptScan: { setBonScanEnabled: j({ ok: true }) },
};
for (const m of ['fleet', 'documents', 'receiptScan']) {
  jest.doMock('../../handlers/' + m, () => {
    const o = {};
    for (const k of Object.keys(mockH[m])) o[k] = (...a) => mockH[m][k](...a);
    return o;
  });
}

const tools = require('../../lib/chatTools');
const router = require('../../lib/chatRouter');
const ops = require('../../lib/chatOps');

const ADMIN = { id: 3, company_id: 7, pozicio: 'Admin', email: 'a@x.ro' };
const MANAGER = { id: 4, company_id: 7, pozicio: 'Manager', email: 'm@x.ro' };
const req = (u) => ({ session: { user: Object.assign({}, u) }, headers: {}, ip: '1.1.1.1' });
const ctxOf = (u) => router.makeCtx(req(u), 'hu', 'teszt', [], {}, new Date(2026, 9, 10, 12));
const tokOf = (html) => /data-tok="([^"]+)"/.exec(html)[1].replace(/&amp;/g, '&');
const prep = (u, tool, args) => tools.prepare(ctxOf(u), { tool, args });

beforeEach(() => {
  mockRules = [
    { match: /FROM external_drivers/, rows: [{ id: 31, nume: 'Kovács Béla', firma: 'Rapid Kft', telefon: '07', email: null, rendszam_camion: null, rendszam_remorca: null, nota: null }] },
    { match: /FROM fuvarlevelek\s+WHERE company_id = \$1 AND COALESCE\(email_sofer/, rows: [{ email: 'regi@x.ro', nume: 'Régi Sofőr', n: 12 }] },
    { match: /FROM users WHERE company_id = \$1 AND pozicio = 'Manager'/, rows: [{ id: 4, nume: 'Menedzser Mari', email: 'm@x.ro' }] },
    { match: /FROM user_permissions/, rows: [] },
    { match: /INSERT INTO chat_action_log/, rows: [{ id: 1 }] },
    { match: /chat_learned_intents/, rows: [] },
  ];
  for (const m of Object.values(mockH)) for (const f of Object.values(m)) f.mockClear();
});

test('regiszter: az új tool-ok megvannak', () => {
  const names = tools.all().map((t) => t.name);
  for (const n of ['extdriver.add', 'extdriver.update', 'extdriver.delete', 'earning_kind.add', 'waybill.km_gaps', 'waybill.reassign', 'driver.purge_data',
    'permission.set', 'finance.eur_ron_set', 'docreg.group_save', 'order.template_delete', 'campaign.pair', 'whatsapp.set', 'bonscan.toggle', 'mail.sync']) expect(names).toContain(n);
});

test('külső sofőr módosítása: csak a megadott mező megy át', async () => {
  const r = await prep(ADMIN, 'extdriver.update', { driver: 'Kovács', phone: '0740' });
  const x = await ops.executeAction(req(ADMIN), tokOf(r.html), {}, 'hu');
  expect(x.ok).toBe(true);
  expect(mockH.fleet.extDriverUpdate.mock.calls[0][2]).toEqual([31, { telefon: '0740' }]);
});

test('menetlevél-átrendezés: IGEN kell, a régi e-mailről az új sofőrre', async () => {
  mockRules.unshift({ match: /FROM users/, rows: [{ id: 20, nume: 'Gondos Imre', email: 'gondos@x.ro', pozicio: 'Sofer', tel: '1' }] });
  const r = await prep(ADMIN, 'waybill.reassign', { from: 'Régi', to: 'Gondos Imre' });
  expect(r.html).toContain('data-input=');
  const x = await ops.executeAction(req(ADMIN), tokOf(r.html), { input: 'IGEN' }, 'hu');
  expect(x.ok).toBe(true);
  expect(mockH.documents.reassignDriverWaybills.mock.calls[0][2]).toEqual(['regi@x.ro', 'gondos@x.ro']);
});

test('adat-törlés és jogosultság csak Adminnak', async () => {
  expect((await prep(MANAGER, 'driver.purge_data', { email: 'regi@x.ro' })).html || '').not.toContain('data-tok=');
  expect((await prep(MANAGER, 'permission.set', { user: 'Menedzser', perm: 'invoice_issue' })).html || '').not.toContain('data-tok=');
});

test('jogosultság beállítása a Managerre', async () => {
  const r = await prep(ADMIN, 'permission.set', { user: 'Menedzser', perm: 'invoice_issue', enabled: true });
  const x = await ops.executeAction(req(ADMIN), tokOf(r.html), {}, 'hu');
  expect(x.ok).toBe(true);
  expect(mockH.permissions.setUserPermission.mock.calls[0][2]).toEqual({ user_id: 4, perm_key: 'invoice_issue', enabled: true });
});

test('AI bon-scan kikapcsolás csak a fehérlistás kulccsal', async () => {
  const r = await prep(MANAGER, 'bonscan.toggle', { enabled: false });
  await ops.executeAction(req(MANAGER), tokOf(r.html), {}, 'hu');
  expect(mockH.receiptScan.setBonScanEnabled.mock.calls[0][2]).toEqual([{ key: 'ai-bon-scan', enabled: false }]);
});

test('egyik tool sem hív titkot érintő handlert', () => {
  const fs = require('fs'); const path = require('path'); const dir = path.join(__dirname, '../../lib/chatTools');
  const src = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  for (const bad of ['ebSenderGet', 'ebSenderSave', 'saveBillingIntegration', 'saveEmailIntakeConfig', 'mailAccountSave', 'devSaveCompanyMaps', 'settingsChangePassword', 'settings2faDisable', 'credentials_enc', 'getCompanyBillingIntegration', 'getEmailIntakeConfig', 'mailAccountList']) expect(src).not.toContain(bad);
});
