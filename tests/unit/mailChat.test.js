// ============================================================
//  Unit-teszt — handlers/mailChat.js (💬 AI-chat ✉️ e-mail ága)
//  DB, AI és az orderEmail-handlerek mockolva — nincs valódi hálózat.
// ============================================================
let mockRules = [];
const mockDbQuery = jest.fn(async (sql, params) => {
  for (const r of mockRules) {
    if (r.match.test(sql)) return r.fn ? r.fn(sql, params) : { rows: r.rows || [] };
  }
  return { rows: [] };
});
jest.mock('../../db', () => ({ query: (...a) => mockDbQuery(...a) }));
jest.mock('../../lib/audit', () => ({ fromReq: async () => {} }));
let mockFeatureOn = true;
jest.mock('../../lib/featureEnabled', () => ({ featureEnabled: async () => mockFeatureOn }));
const mockExtract = jest.fn();
jest.mock('../../lib/geminiJson', () => ({ extractJson: (...a) => mockExtract(...a) }));
jest.mock('../../handlers/orders', () => ({ comCreate: jest.fn(), comUpdate: jest.fn() }));
const mockSend = jest.fn(async (req, res) => res.json({ result: { ok: true } }));
const mockMailerSend = jest.fn(async () => ({ ok: true }));
const mockClientEmail = jest.fn(async () => ({ ok: true }));
jest.mock('../../services/email', () => ({
  getCompanyMailer: async () => ({ ok: true, send: (...a) => mockMailerSend(...a) }),
  sendClientEmail: (...a) => mockClientEmail(...a),
  wrapBrandedEmail: (h) => '<wrap>' + h + '</wrap>',
}));
const mockData = jest.fn(async (req, res) => res.json({ result: { ok: true,
  attachments: [{ key: 'inv-5', label: 'Factură F 12', kind: 'invoice' }, { key: 'od-3-signed', label: 'CMR — semnat', kind: 'doc' }],
  builder_templates: [{ id: 9, name: 'Napnyugta' }], tracking_available: true } }));
jest.mock('../../handlers/orderEmail', () => ({
  getOrderEmailData: (...a) => mockData(...a),
  sendOrderEmail: (...a) => mockSend(...a),
}));

const orderChat = require('../../handlers/orderChat');
const mailChat = require('../../handlers/mailChat');

function call(mod, fn, user, args) {
  return new Promise((resolve) => {
    mod[fn]({ session: { user } }, { json: (p) => resolve(p.result) }, args);
  });
}
const ADMIN = { id: 1, email: 'a@x.ro', pozicio: 'Admin', company_id: 7 };
const ORDER = { id: 'CMD-X1', fuvar_no: 'CMD-2026-0042', client: 'Bilka Steel SRL', client_id: 11, status: 'In Curs',
  loc_incarcare: 'Brașov', loc_descarcare: 'Bicske', client_email: 'office@bilka.ro', carrier_nev: null, carrier_email: null };

beforeEach(() => {
  mockFeatureOn = true;
  mockRules = [{ match: /FROM orders o/, fn: (sql, p) => ({ rows: p[0] === 7 && /CMD-2026-0042|CMD-X1/.test(p[1]) ? [ORDER] : [] }) }];
  mockDbQuery.mockClear(); mockExtract.mockReset(); mockSend.mockClear(); mockData.mockClear(); mockMailerSend.mockClear(); mockClientEmail.mockClear();
  mailChat._sendLimiter._reset();
});

describe('e-mail szándék felismerése', () => {
  test('e-mail kérés → igen; fuvar-leírás → nem', () => {
    expect(mailChat.isEmailIntent('küldd el a CMD-2026-0042 megrendelőjének a számlát emailben')).toBe(true);
    expect(mailChat.isEmailIntent('írj egy levelet az ügyfélnek')).toBe(true);
    expect(mailChat.isEmailIntent('trimite mail clientului')).toBe(true);
    expect(mailChat.isEmailIntent('felrakó Bilka Brassó, lerakó Bicske hétfőn, FTL')).toBe(false);
  });
});

describe('orderChatTurn — e-mail ág', () => {
  test('levél-vázlat: címzett a szerverről, ismeretlen csatolmány/sablon eldobva, AI nem kap e-mail címet', async () => {
    mockExtract.mockResolvedValue({ model: 'm', json: { reply: 'Kész.', draft: {
      recipient: 'client', to_email: 'hacker@evil.com', lang: 'ro', subject: 'Factura CMD-2026-0042', body: 'Bună ziua…',
      attachments: ['inv-5', 'inv-999'], include_tracking: true, builder_template_id: 77 } } });
    const r = await call(orderChat, 'orderChatTurn', ADMIN, [{ messages: [{ role: 'user', text: 'küldd el a CMD-2026-0042 megrendelőjének a számlát emailben' }] }]);
    expect(r.ok).toBe(true);
    expect(r.mode).toBe('email');
    expect(r.draft.to_email).toBe('office@bilka.ro');
    expect(r.draft.attachments).toEqual(['inv-5']);
    expect(r.draft.builder_template_id).toBeNull();
    expect(r.ready).toBe(true);
    const prompt = mockExtract.mock.calls[0][0].systemPrompt + mockExtract.mock.calls[0][0].parts[0].text;
    expect(prompt).not.toContain('office@bilka.ro');
  });

  test('„más" címet csak a felhasználó által beírt címként fogad el', async () => {
    mockExtract.mockResolvedValue({ model: 'm', json: { draft: { recipient: 'other', to_email: 'x@y.ro', subject: 'S', body: 'B' } } });
    const r = await call(orderChat, 'orderChatTurn', ADMIN, [{ messages: [{ role: 'user', text: 'küldj levelet a CMD-2026-0042 fuvarról a könyvelőnek' }] }]);
    expect(r.draft.to_email).toBeNull();
    expect(r.missing).toContain('recipient');
  });

  test('idegen cég fuvarja nem található', async () => {
    const r = await call(orderChat, 'orderChatTurn', { ...ADMIN, company_id: 8 }, [{ messages: [{ role: 'user', text: 'e-mail a CMD-2026-0042 fuvarról' }] }]);
    expect(r.mode).toBe('email');
    expect(r.missing).toContain('order');
    expect(mockExtract).not.toHaveBeenCalled();
  });

  test('csomag-kapu: a funkció nélkül tiltva', async () => {
    mockFeatureOn = false;
    const r = await call(orderChat, 'orderChatTurn', ADMIN, [{ messages: [{ role: 'user', text: 'email a CMD-2026-0042-ről' }] }]);
    expect(r.ok).toBe(false);
  });
});

describe('mailChatSend', () => {
  const DRAFT = { mode: 'email', order_id: 'CMD-X1', recipient: 'client', to_email: 'office@bilka.ro', subject: 'S', body: 'B', attachments: ['inv-5'] };

  test('valós küldés a meglévő sendOrderEmail-en + tanulás', async () => {
    const r = await call(mailChat, 'mailChatSend', ADMIN, [{ draft: DRAFT }]);
    expect(r.ok).toBe(true);
    const a = mockSend.mock.calls[0][2][0];
    expect(a).toMatchObject({ order_id: 'CMD-X1', to_email: 'office@bilka.ro', attachments: ['inv-5'], test: false });
    expect(mockDbQuery.mock.calls.some((c) => /order_chat_memory/.test(c[0]) && c[1][1] === 'mail_pref')).toBe(true);
  });

  test('teszt-küldés: nem tanul', async () => {
    await call(mailChat, 'mailChatSend', ADMIN, [{ draft: DRAFT, test: true }]);
    expect(mockSend.mock.calls[0][2][0].test).toBe(true);
    expect(mockDbQuery.mock.calls.some((c) => /order_chat_memory/.test(c[0]))).toBe(false);
  });

  test('érvénytelen cím → nem küld', async () => {
    const r = await call(mailChat, 'mailChatSend', ADMIN, [{ draft: { ...DRAFT, to_email: 'nem-email' } }]);
    expect(r.ok).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('rate-limit: 20/óra/felhasználó', async () => {
    for (let i = 0; i < 20; i++) await call(mailChat, 'mailChatSend', ADMIN, [{ draft: DRAFT }]);
    const r = await call(mailChat, 'mailChatSend', ADMIN, [{ draft: DRAFT }]);
    expect(r.ok).toBe(false);
    expect(mockSend).toHaveBeenCalledTimes(20);
  });

  test('Sofer nem küldhet', async () => {
    const r = await call(mailChat, 'mailChatSend', { ...ADMIN, pozicio: 'Sofer' }, [{ draft: DRAFT }]);
    expect(r.ok).toBe(false);
  });
});

describe('fuvar nélküli (általános) levél', () => {
  const GEN = (draft, reply) => mockExtract.mockResolvedValue({ model: 'm', json: { reply: reply || 'Ok', draft } });

  test('név → a cég saját ügyfél-listájából feloldott cím; AI nem kap listát', async () => {
    mockRules.push({ match: /FROM clients WHERE company_id/, fn: (sql, p) => ({ rows: p[0] === 7 ? [{ name: 'Bilka Steel SRL', email: 'office@bilka.ro' }] : [] }) });
    GEN({ recipient: 'named', recipient_name: 'Bilka', subject: 'Capacitate liberă', body: 'Bună ziua…' });
    const r = await call(orderChat, 'orderChatTurn', ADMIN, [{ messages: [{ role: 'user', text: 'írj egy emailt a Bilkának, hogy jövő héten van szabad kapacitásunk' }] }]);
    expect(r.ok).toBe(true);
    expect(r.mode).toBe('email');
    expect(r.draft.order_id).toBeNull();
    expect(r.draft.to_email).toBe('office@bilka.ro');
    expect(r.ready).toBe(true);
    const sent = mockExtract.mock.calls[0][0];
    expect(sent.systemPrompt + sent.parts[0].text).not.toContain('office@bilka.ro');
  });

  test('több találat → választó kérdés, kattintásra a kiválasztott cím', async () => {
    mockRules.push({ match: /FROM clients WHERE company_id/, rows: [{ name: 'Bilka A', email: 'a@bilka.ro' }, { name: 'Bilka B', email: 'b@bilka.ro' }] });
    GEN({ recipient: 'named', recipient_name: 'Bilka', subject: 'S', body: 'B' });
    const r1 = await call(orderChat, 'orderChatTurn', ADMIN, [{ messages: [{ role: 'user', text: 'email a Bilkának' }] }]);
    expect(r1.draft.to_email).toBeNull();
    expect(r1.questions[0].options).toEqual(['Bilka A <a@bilka.ro>', 'Bilka B <b@bilka.ro>']);
    GEN({ recipient: 'named', recipient_name: 'Bilka B', subject: 'S', body: 'B' });
    const r2 = await call(orderChat, 'orderChatTurn', ADMIN, [{ draft: r1.draft, messages: [
      { role: 'user', text: 'email a Bilkának' }, { role: 'assistant', text: 'Melyik?' }, { role: 'user', text: 'Bilka B <b@bilka.ro>' }] }]);
    expect(r2.draft.to_email).toBe('b@bilka.ro');
    expect(r2.ready).toBe(true);
  });

  test('ismeretlen név → kéri a címet', async () => {
    GEN({ recipient: 'named', recipient_name: 'Senki Kft', subject: 'S', body: 'B' });
    const r = await call(orderChat, 'orderChatTurn', ADMIN, [{ messages: [{ role: 'user', text: 'mail a Senki Kft-nek' }] }]);
    expect(r.draft.to_email).toBeNull();
    expect(r.missing).toContain('recipient');
  });

  test('küldés: a cég saját feladó-fiókjáról, arculattal; teszt a közös címről a saját címre', async () => {
    const D = { mode: 'email', recipient: 'other', to_email: 'x@y.ro', subject: 'S', body: 'Szia <b>' };
    const r = await call(mailChat, 'mailChatSend', ADMIN, [{ draft: D }]);
    expect(r.ok).toBe(true);
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockMailerSend.mock.calls[0][0].to).toBe('x@y.ro');
    expect(mockMailerSend.mock.calls[0][0].html).toContain('Szia &lt;b&gt;');
    await call(mailChat, 'mailChatSend', ADMIN, [{ draft: D, test: true }]);
    expect(mockClientEmail.mock.calls[0][0].to).toBe('a@x.ro');
  });
});

describe('kinézet: színek/elrendezés + alapértelmezett', () => {
  const ms = require('../../lib/mailStyle');

  test('fehérlista: csak #rrggbb és felsorolt értékek', () => {
    expect(ms.sanitizeStyle({ accent: '#2563EB', bg: 'red;x:expression()', align: 'center', header: '<script>', width: 'wide' }))
      .toEqual({ accent: '#2563eb', align: 'center', width: 'wide' });
    const html = ms.renderStyled('<p>Szia</p>', { accent: '#2563eb', header: 'band', align: 'center' }, { senderName: 'A&B' });
    expect(html).toContain('background:#2563eb');
    expect(html).toContain('A&amp;B');
  });

  test('kért szín + mentés alapértelmezettnek → user-kulcson tárolva, a következő levél ezzel indul', async () => {
    const store = {};
    mockRules.push({ match: /INSERT INTO order_chat_memory/, fn: (sql, p) => { store[p[1] + '|' + p[2]] = JSON.parse(p[3]); return { rows: [] }; } });
    mockRules.push({ match: /SELECT value FROM order_chat_memory/, fn: (sql, p) => ({ rows: store[p[1] + '|' + p[2]] ? [{ value: store[p[1] + '|' + p[2]] }] : [] }) });
    mockExtract.mockResolvedValue({ model: 'm', json: { save_default: true, draft: { recipient: 'other', to_email: 'x@y.ro', subject: 'S', body: 'B', style: { accent: '#2563eb', header: 'band' } } } });
    const r1 = await call(orderChat, 'orderChatTurn', ADMIN, [{ messages: [{ role: 'user', text: 'email a x@y.ro címre, kék fejléc-sávval, mentsd el alapértelmezettnek' }] }]);
    expect(r1.draft.style).toEqual({ accent: '#2563eb', header: 'band' });
    expect(r1.draft.style_default).toBe(true);
    expect(store['mail_style|user:1']).toEqual({ style: { accent: '#2563eb', header: 'band' }, builder_template_id: null });

    mockExtract.mockResolvedValue({ model: 'm', json: { draft: { recipient: 'other', to_email: 'z@y.ro', subject: 'S2', body: 'B2', style: null } } });
    const r2 = await call(orderChat, 'orderChatTurn', ADMIN, [{ messages: [{ role: 'user', text: 'új email a z@y.ro címre' }] }]);
    expect(r2.draft.style).toEqual({ accent: '#2563eb', header: 'band' });
    expect(r2.draft.style_default).toBe(true);
    // más felhasználó nem kapja meg
    const r3 = await call(orderChat, 'orderChatTurn', { ...ADMIN, id: 2 }, [{ messages: [{ role: 'user', text: 'új email a z@y.ro címre' }] }]);
    expect(r3.draft.style).toBeNull();
  });

  test('a stílus a küldésbe is bekerül (általános levél)', async () => {
    const D = { mode: 'email', recipient: 'other', to_email: 'x@y.ro', subject: 'S', body: 'B', style: { accent: '#16a34a', header: 'band' } };
    await call(mailChat, 'mailChatSend', ADMIN, [{ draft: D }]);
    expect(mockMailerSend.mock.calls[0][0].html).toBe('<wrap><div style="font-size:14px;line-height:1.6;white-space:pre-wrap;">B</div></wrap>');
  });

  test('fuvaros levélnél a sendOrderEmail megkapja a stílust', async () => {
    const D = { mode: 'email', order_id: 'CMD-X1', recipient: 'client', to_email: 'office@bilka.ro', subject: 'S', body: 'B', style: { accent: '#16a34a' } };
    await call(mailChat, 'mailChatSend', ADMIN, [{ draft: D }]);
    expect(mockSend.mock.calls[0][2][0].style).toEqual({ accent: '#16a34a' });
  });
});

describe('kötelező céges lábléc + kontraszt', () => {
  const ms = require('../../lib/mailStyle');
  test('lábléc: cégnév, CUI, J, telefon, e-mail, cím, logó; escape-elve; jelölővel', () => {
    const f = ms.companyFooterHtml({ nev: 'Vallor <Team>', cui: 'RO47859317', reg_com: 'J2023000114142', telefon: '0769', email_contact: 'a@b.ro', adresa: 'Arcuș' }, 'https://x.ro/branding/logo/7.png');
    expect(f).toContain('Vallor &lt;Team&gt;');
    expect(f).toContain('CUI RO47859317');
    expect(f).toContain('J2023000114142');
    expect(f).toContain('Arcuș');
    expect(f).toContain('https://x.ro/branding/logo/7.png');
    expect(ms.hasFooter(f)).toBe(true);
    expect(ms.companyFooterHtml({}, null)).toBe('');
  });
  test('kontraszt: sötét háttéren világos, világoson sötét szöveg; rossz szín felülírva', () => {
    expect(ms.readableOn('#1e3a8a')).toBe('#ffffff');
    expect(ms.readableOn('#fde68a')).toBe('#111827');
    expect(ms.ensureText('#ffffff', '#ffffff')).toBe('#111827');
    expect(ms.ensureText('#1e3a8a', '#ffffff')).toBe('#1e3a8a');
    const h = ms.renderStyled('x', { card: '#111827', text: '#1f2937', accent: '#fde68a', header: 'band' }, {});
    expect(h).toContain('color:#ffffff;');          // sötét lapon fehér szöveg
    expect(h).toContain('background:#fde68a;color:#111827'); // világos sávon sötét felirat
  });
});
