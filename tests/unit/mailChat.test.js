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
  mockDbQuery.mockClear(); mockExtract.mockReset(); mockSend.mockClear(); mockData.mockClear();
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
  test('fuvarszám nélkül visszakérdez, AI-hívás nélkül', async () => {
    const r = await call(orderChat, 'orderChatTurn', ADMIN, [{ messages: [{ role: 'user', text: 'írj levelet az ügyfélnek' }] }]);
    expect(r.ok).toBe(true);
    expect(r.mode).toBe('email');
    expect(r.missing).toContain('order');
    expect(mockExtract).not.toHaveBeenCalled();
  });

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
