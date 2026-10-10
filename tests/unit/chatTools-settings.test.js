// ============================================================
//  Unit-teszt — lib/chatTools/settings.js (5. kör): e-CMR, kampány,
//  GDPR, előfizetés, PDF-sablon, időzített riport, integrációk, megnyitók.
//  DB + handlerek mockolva.
// ============================================================
let mockRules = [];
const mockDbQuery = jest.fn(async (sql, params) => {
  for (const r of mockRules) if (r.match.test(sql)) return r.fn ? r.fn(sql, params) : { rows: r.rows || [] };
  return { rows: [] };
});
jest.mock('../../db', () => ({ query: (...a) => mockDbQuery(...a) }));
jest.mock('../../lib/featureEnabled', () => ({ featureEnabled: async () => true }));
jest.mock('../../lib/audit', () => ({ fromReq: jest.fn(async () => {}) }));
jest.mock('../../handlers/permissions', () => ({ hasPerm: async () => true }));
const j = (x) => jest.fn((req, res) => res.json({ result: x }));
const mockH = {
  ecmr: { ecmrList: j({ ok: true, items: [] }), ecmrSign: j({ ok: true, status: 'partial' }) },
  emailBuilder: { ebTemplateList: j({ ok: true, templates: [] }), ebContactList: j({ ok: true, contacts: [] }), ebContactSave: j({ ok: true, id: 11 }), ebContactDelete: j({ ok: true }), ebSend: j({ ok: true, sent: 2, errors: [] }) },
  gdpr: { anonymizeUser: j({ ok: true }), getGdprSettings: j({ ok: true, settings: { privacy_notice: 'Régi', dpo_contact: 'dpo@x.ro', gps_business_only: true, retention_note: '1 év' } }), saveGdprSettings: j({ ok: true }) },
  billingHandlers: { getMySubscription: j({ ok: true, status: 'active', plan_name: 'Pro', paid_until: '2026-11-01', days_left: 22, cancel_pending: false, can_cancel: true }), cancelSubscription: j({ ok: true }), reactivateSubscription: j({ ok: true }) },
  pdfTemplates: { pdfTemplateGet: j({ ok: true, template: { doc_type: 'waybill', header_text: 'Fej', footer_text: null, accent_color: '#111111', show_logo: true } }), pdfTemplateSave: j({ ok: true }) },
  statsReports: { statsReportScheduleList: j({ ok: true, schedules: [] }), statsReportScheduleSave: j({ ok: true, id: 3 }), statsReportScheduleDelete: j({ ok: true }) },
};
for (const m of Object.keys(mockH)) {
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
const NOW = new Date(2026, 9, 10, 12, 0, 0);
const ctxOf = (u, text) => router.makeCtx(req(u), 'hu', text || 'teszt', [], {}, NOW);
const tokOf = (html) => /data-tok="([^"]+)"/.exec(html)[1].replace(/&amp;/g, '&');

beforeEach(() => {
  mockRules = [
    { match: /FROM order_ecmr WHERE company_id/, rows: [{ id: 40, order_id: 'CMD-1', status: 'draft', carrier_signed_at: null }] },
    { match: /FROM email_builder_templates WHERE company_id/, rows: [{ id: 8, name: 'Októberi akció', subject: 'Akció' }] },
    { match: /FROM email_template_pairings/, rows: [{ n: 3 }] },
    { match: /FROM email_contacts WHERE company_id = \$1$/, rows: [{ id: 1, name: 'Kovács Anna', email: 'anna@p.ro' }, { id: 2, name: 'Szabó Béla', email: 'bela@p.ro' }] },
    { match: /FROM users WHERE company_id = \$1 AND COALESCE\(pozicio_dev/, rows: [{ id: 20, nume: 'Volt Sofőr', email: 'volt@x.ro', pozicio: 'Sofer' }, { id: 3, nume: 'Admin Ádám', email: 'a@x.ro', pozicio: 'Admin' }] },
    { match: /FROM stats_report_schedules WHERE company_id = \$1 AND LOWER\(name\) = /, rows: [] },
    { match: /FROM stats_report_schedules WHERE company_id = \$1 AND LOWER\(name\) LIKE/, rows: [{ id: 3, name: 'Havi riport' }] },
    { match: /FROM billing_integrations/, rows: [{ display_name: 'SmartBill', provider: 'smartbill', is_active: true }] },
    { match: /FROM company_integrations/, rows: [{ provider: 'cargotrack', category: 'gps', enabled: true, status: 'ok' }, { provider: 'email_sender', category: 'email', enabled: false, status: null }] },
    { match: /FROM mail_accounts/, rows: [{ n: 2 }] },
    { match: /INSERT INTO chat_action_log/, rows: [{ id: 1 }] },
    { match: /chat_learned_intents/, rows: [] },
  ];
  for (const m of Object.values(mockH)) for (const f of Object.values(m)) f.mockClear();
});

const prep = (u, tool, args, text) => tools.prepare(ctxOf(u, text), { tool, args });

test('a regiszterben benne vannak az új tool-ok', () => {
  const names = tools.all().map((t) => t.name);
  for (const n of ['ecmr.list', 'ecmr.sign', 'campaign.send', 'campaign.contact_add', 'gdpr.export', 'gdpr.anonymize', 'gdpr.settings', 'subscription.status', 'subscription.cancel',
    'subscription.reactivate', 'pdf_template.update', 'stats_report.save', 'stats_report.delete', 'integrations.status', 'open.order_import', 'open.fuel_import', 'open.sign_pdf', 'carrier.docs']) expect(names).toContain(n);
});

describe('e-CMR aláírás', () => {
  test('névvel → ecmrSign a megfelelő féllel', async () => {
    mockRules.unshift({ match: /FROM orders/, rows: [{ id: 'CMD-1', fuvar_no: 'CMD-2026-0042', status: 'In Curs' }] });
    const r = await prep(ADMIN, 'ecmr.sign', { order: 'CMD-2026-0042', party: 'carrier', name: 'Teszt Elek' });
    expect(r.html).toContain('data-tok=');
    const x = await ops.executeAction(req(ADMIN), tokOf(r.html), {}, 'hu');
    expect(x.ok).toBe(true);
    expect(mockH.ecmr.ecmrSign.mock.calls[0][2][0]).toMatchObject({ ecmr_id: 40, party: 'carrier', name: 'Teszt Elek' });
  });
});

describe('e-mail kampány', () => {
  test('párosítottaknak → ebSend üres contact_ids-szel, veszélyes (IGEN kell)', async () => {
    const r = await prep(ADMIN, 'campaign.send', { template: 'októberi', to: 'párosítottak' });
    expect(r.html).toContain('data-input=');
    expect(mockH.emailBuilder.ebSend).not.toHaveBeenCalled();
  });
  test('név szerint + e-mail cím', async () => {
    const r = await prep(ADMIN, 'campaign.send', { template: 'Októberi akció', to: 'Kovács, extra@p.ro' });
    const x = await ops.executeAction(req(ADMIN), tokOf(r.html), { input: 'IGEN' }, 'hu');
    expect(x.ok).toBe(true);
    expect(mockH.emailBuilder.ebSend.mock.calls[0][2][0]).toMatchObject({ template_id: 8, contact_ids: [1], extra_emails: ['extra@p.ro'] });
  });
  test('ismeretlen kontakt → hiba', async () => {
    const r = await prep(ADMIN, 'campaign.send', { template: 'Októberi akció', to: 'Nemlétező' });
    expect(r.html || '').not.toContain('data-tok=');
  });
});

describe('GDPR', () => {
  test('anonimizálás csak Adminnak', async () => {
    const r = await prep(MANAGER, 'gdpr.anonymize', { user: 'Volt Sofőr' });
    expect(r.html || '').not.toContain('data-tok=');
  });
  test('saját magát nem', async () => {
    const r = await prep(ADMIN, 'gdpr.anonymize', { user: 'a@x.ro' });
    expect(r.html || '').not.toContain('data-tok=');
  });
  test('beállítás: csak a megadott mező változik', async () => {
    const r = await prep(ADMIN, 'gdpr.settings', { dpo: 'uj@x.ro' });
    const x = await ops.executeAction(req(ADMIN), tokOf(r.html), {}, 'hu');
    expect(x.ok).toBe(true);
    expect(mockH.gdpr.saveGdprSettings.mock.calls[0][2][0]).toEqual({ privacy_notice: 'Régi', dpo_contact: 'uj@x.ro', gps_business_only: true, retention_note: '1 év' });
  });
});

describe('előfizetés', () => {
  test('lemondás → cancelSubscription', async () => {
    const r = await prep(ADMIN, 'subscription.cancel', {});
    const x = await ops.executeAction(req(ADMIN), tokOf(r.html), { input: 'IGEN' }, 'hu');
    expect(x.ok).toBe(true);
    expect(mockH.billingHandlers.cancelSubscription).toHaveBeenCalled();
  });
  test('visszavonás lemondás nélkül → hiba', async () => {
    const r = await prep(ADMIN, 'subscription.reactivate', {});
    expect(r.html || '').not.toContain('data-tok=');
  });
});

test('PDF-sablon: a többi mező megmarad', async () => {
  const r = await prep(ADMIN, 'pdf_template.update', { doc: 'waybill', footer: 'Köszönjük!' });
  const x = await ops.executeAction(req(ADMIN), tokOf(r.html), {}, 'hu');
  expect(x.ok).toBe(true);
  expect(mockH.pdfTemplates.pdfTemplateSave.mock.calls[0][2][0]).toEqual({ docType: 'waybill', headerText: 'Fej', footerText: 'Köszönjük!', accentColor: '#111111', showLogo: true });
});

describe('időzített riport', () => {
  test('mentés', async () => {
    const r = await prep(ADMIN, 'stats_report.save', { schedule: 'monthly', recipients: 'fonok@p.ro, b@p.ro' });
    const x = await ops.executeAction(req(ADMIN), tokOf(r.html), {}, 'hu');
    expect(x.ok).toBe(true);
    expect(mockH.statsReports.statsReportScheduleSave.mock.calls[0][2][0]).toMatchObject({ id: null, schedule: 'monthly', recipients: ['fonok@p.ro', 'b@p.ro'], enabled: true });
  });
  test('törlés az id-vel', async () => {
    const r = await prep(ADMIN, 'stats_report.delete', { name: 'havi' });
    await ops.executeAction(req(ADMIN), tokOf(r.html), {}, 'hu');
    expect(mockH.statsReports.statsReportScheduleDelete.mock.calls[0][2]).toEqual([3]);
  });
});

test('integrációk: állapot, kulcs nélkül', async () => {
  const r = await prep(ADMIN, 'integrations.status', {});
  expect(r.html).toContain('SmartBill');
  expect(r.html).toContain('CargoTrack');
  expect(mockDbQuery.mock.calls.some(([sql]) => /credentials/i.test(sql))).toBe(false);
});

test('megnyitók UI-paranccsal', async () => {
  const r = await prep(ADMIN, 'open.order_import', {});
  expect(r.ui).toEqual({ op: 'orderImport' });
  const g = await prep(ADMIN, 'gdpr.export', {});
  expect(g.ui).toEqual({ op: 'gdprExport' });
  expect(require('../../lib/chatTools/nav').UI_OPS).toEqual(expect.arrayContaining(['orderImport', 'gdprExport', 'carrierDocs']));
});
