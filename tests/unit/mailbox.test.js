// ============================================================
//  Unit-teszt — handlers/mailbox.js + services/mailbox.js (📥 Levelek)
//  Ellenőrzi: csak-fejléc lista, jogok, feladó-szűrés, a válasz címzettje a
//  szerverről jön, levélszál-fejlécek, és hogy az AI-chat válasznál a levél
//  (feladó/tárgy/szöveg) NEM kerül az AI-hoz.
// ============================================================
let mockRules = [];
const mockDbQuery = jest.fn(async (sql, params) => {
  for (const r of mockRules) if (r.match.test(sql)) return r.fn ? r.fn(sql, params) : { rows: r.rows || [], rowCount: (r.rows || []).length };
  return { rows: [], rowCount: 0 };
});
jest.mock('../../db', () => ({ query: (...a) => mockDbQuery(...a) }));
jest.mock('../../lib/audit', () => ({ fromReq: async () => {} }));
jest.mock('../../lib/featureEnabled', () => ({ featureEnabled: async () => true }));
const mockExtract = jest.fn();
jest.mock('../../lib/geminiJson', () => ({ extractJson: (...a) => mockExtract(...a) }));
jest.mock('../../handlers/orders', () => ({ comCreate: jest.fn(), comUpdate: jest.fn() }));
const mockMailerSend = jest.fn(async () => ({ ok: true }));
jest.mock('../../services/email', () => ({
  getCompanyMailer: async () => ({ ok: true, send: (...a) => mockMailerSend(...a) }),
  sendClientEmail: async () => ({ ok: true }),
  wrapBrandedEmail: (h) => '<wrap>' + h + '</wrap>',
}));
const mockRead = jest.fn(async () => ({ text: 'Holnap 8-ra tudnak jönni?\nTitkos ár: 900 EUR', attachments: [], references: '' }));
jest.mock('../../services/mailbox', () => {
  const real = jest.requireActual('../../services/mailbox');
  return Object.assign({}, real, { readMessage: (...a) => mockRead(...a), accCreds: () => ({ email: 'iroda@ceg.ro', password: 'secret1' }) });
});

const mailboxH = require('../../handlers/mailbox');
const orderChat = require('../../handlers/orderChat');
const mailChat = require('../../handlers/mailChat');
const svc = jest.requireActual('../../services/mailbox');

function call(mod, fn, user, args) {
  return new Promise((resolve) => { mod[fn]({ session: { user } }, { json: (p) => resolve(p.result) }, args); });
}
const ADMIN = { id: 1, email: 'a@ceg.ro', pozicio: 'Admin', company_id: 7 };
const MANAGER = { id: 2, email: 'm@ceg.ro', pozicio: 'Manager', company_id: 7 };
const SOFER = { id: 3, email: 's@ceg.ro', pozicio: 'Sofer', company_id: 7 };
const HDR = { id: 5, company_id: 7, account_id: 1, folder: 'INBOX', uid: 44, message_id: '<abc@kovacs.ro>', refs: null,
  from_email: 'logistica@kovacs.ro', from_name: 'Kovács Trans', subject: 'Rakodás holnap?', received_at: '2026-10-07T08:00:00Z',
  order_id: null, acc: { id: 1, company_id: 7, use_inbox: true, use_orders: false } };

beforeEach(() => {
  mockRules = [{ match: /FROM mail_headers h JOIN mail_accounts/, fn: (sql, p) => ({ rows: p[1] === 7 && p[0] === 5 ? [HDR] : [] }) }];
  mockDbQuery.mockClear(); mockMailerSend.mockClear(); mockExtract.mockReset(); mockRead.mockClear();
  mailboxH._sendReply && mailChat._sendLimiter._reset();
});

describe('feladó-szűrés (services/mailbox buildAllowFn)', () => {
  test("'list' mód: csak a megadott cím / domain", async () => {
    const f = await svc.buildAllowFn({ query: async () => ({ rows: [] }) }, { allow_mode: 'list', allow_list: 'a@x.ro, @mol.ro' });
    expect(f('a@x.ro')).toBe(true); expect(f('b@mol.ro')).toBe(true); expect(f('c@evil.com')).toBe(false);
  });
  test("'known' mód: a cég ügyfél/alvállalkozó/kontakt címei", async () => {
    const pool = { query: async (sql) => ({ rows: /clients/.test(sql) ? [{ e: 'Office@Bilka.ro' }] : [] }) };
    const f = await svc.buildAllowFn(pool, { allow_mode: 'known', company_id: 7 });
    expect(f('office@bilka.ro')).toBe(true); expect(f('spam@x.com')).toBe(false);
  });
  test("'all' mód: mindenki", async () => {
    const f = await svc.buildAllowFn({}, { allow_mode: 'all' });
    expect(f('barki@x.com')).toBe(true);
  });
});

describe('jogok', () => {
  test('sofőr nem éri el a levéllistát és nem nyithat meg levelet', async () => {
    expect((await call(mailboxH, 'mailInboxList', SOFER, [{}])).ok).toBe(false);
    expect((await call(mailboxH, 'mailOpen', SOFER, [{ id: 5 }])).ok).toBe(false);
  });
  test('postafiókot csak Admin menthet', async () => {
    const r = await call(mailboxH, 'mailAccountSave', MANAGER, [{ provider: 'gmail', email: 'a@b.ro', password: 'x123456' }]);
    expect(r.ok).toBe(false);
  });
  test('idegen cég levele nem nyitható meg', async () => {
    const r = await call(mailboxH, 'mailOpen', { ...ADMIN, company_id: 8 }, [{ id: 5 }]);
    expect(r.ok).toBe(false);
    expect(mockRead).not.toHaveBeenCalled();
  });
  test('a lista csak fejléc-mezőket kér le (törzs nélkül)', async () => {
    let seen = '';
    mockRules.unshift({ match: /FROM mail_headers h\s+JOIN/, fn: (sql) => { seen = sql; return { rows: [] }; } });
    await call(mailboxH, 'mailInboxList', ADMIN, [{}]);
    expect(seen).toMatch(/h\.from_email/);
    expect(seen).not.toMatch(/text|body|source/i);
    expect(seen).toMatch(/h\.company_id=\$1/);
  });
});

describe('↩️ válasz', () => {
  test('a címzett mindig a levél feladója + levélszál-fejlécek', async () => {
    const r = await call(mailboxH, 'mailReply', ADMIN, [{ id: 5, body: 'Igen, 8-kor ott leszünk.', to_email: 'hacker@evil.com' }]);
    expect(r.ok).toBe(true);
    const opts = mockMailerSend.mock.calls[0][0];
    expect(opts.to).toBe('logistica@kovacs.ro');
    expect(opts.subject).toBe('Re: Rakodás holnap?');
    expect(opts.inReplyTo).toBe('<abc@kovacs.ro>');
    expect(opts.html).toContain('&gt; Holnap 8-ra');
  });
  test('üres válasz nem megy ki', async () => {
    const r = await call(mailboxH, 'mailReply', ADMIN, [{ id: 5, body: '  ' }]);
    expect(r.ok).toBe(false);
    expect(mockMailerSend).not.toHaveBeenCalled();
  });
});

describe('💬 válasz AI-val — az AI a levelet nem látja', () => {
  test('a prompt nem tartalmazza a feladót, a tárgyat és a levél szövegét; a címzett a szerverről jön', async () => {
    mockExtract.mockResolvedValue({ model: 'm', json: { reply: 'Kész.', draft: { body: 'Bună ziua, ne vedem mâine la 8.', lang: 'ro' } } });
    const r = await call(orderChat, 'orderChatTurn', ADMIN, [{ messages: [{ role: 'user', text: 'írd meg, hogy holnap 8-kor ott vagyunk' }],
      draft: { mode: 'email', reply_mail_id: 5, to_email: 'hacker@evil.com' } }]);
    expect(r.ok).toBe(true);
    const sent = JSON.stringify(mockExtract.mock.calls[0][0]);
    expect(sent).not.toMatch(/kovacs/i);
    expect(sent).not.toMatch(/Rakodás/);
    expect(sent).not.toMatch(/900 EUR/);
    expect(mockRead).not.toHaveBeenCalled();
    expect(r.draft.to_email).toBe('logistica@kovacs.ro');
    expect(r.draft.subject).toBe('Re: Rakodás holnap?');
    expect(r.ready).toBe(true);
  });
  test('küldés a chatből → a válasz-motor, a feladónak', async () => {
    const r = await call(mailChat, 'mailChatSend', ADMIN, [{ draft: { mode: 'email', reply_mail_id: 5, body: 'Ok, 8-kor.', to_email: 'hacker@evil.com' } }]);
    expect(r.ok).toBe(true);
    expect(mockMailerSend.mock.calls[0][0].to).toBe('logistica@kovacs.ro');
  });
});

describe('📤 Elküldött mappa (appendSent)', () => {
  test('Gmail SMTP + Gmail IMAP → kihagyja (a szolgáltató maga menti)', () => {
    expect(svc._autoSavesSent('smtp.gmail.com', 'imap.gmail.com')).toBe(true);
    expect(svc._autoSavesSent('smtp.ceg.ro', 'imap.gmail.com')).toBe(false);
    expect(svc._autoSavesSent(undefined, 'imap.ceg.ro')).toBe(false);
  });
  test('nincs fiók → nem csatlakozik', async () => {
    const r = await svc.appendSent({ query: async () => ({ rows: [] }) }, 7, { from: 'a@b.ro', to: 'x@y.ro', subject: 's', html: 'h' }, { method: 'brevo' });
    expect(r.skipped).toBe('no-account');
  });
  test('a lekérdezés cégre szűr', async () => {
    let params = null;
    await svc.appendSent({ query: async (sql, p) => { params = p; return { rows: [] }; } }, 9, { from: 'a@b.ro' }, {});
    expect(params).toEqual([9]);
  });
});

describe('📤 Elküldött levelek + 💬 levélszál', () => {
  test('mailSentList: Sofőr nem éri el', async () => {
    const r = await call(mailboxH, 'mailSentList', SOFER, [{}]);
    expect(r.ok).toBe(false);
  });
  test('mailSentList: cégre szűr, a teszt-küldés kimarad', async () => {
    let seen = null;
    mockRules = [{ match: /FROM mail_sent s/, fn: (sql, p) => { seen = { sql, p }; return { rows: [{ id: 1, to_email: 'x@y.ro', subject: 'S' }] }; } }];
    const r = await call(mailboxH, 'mailSentList', MANAGER, [{ q: 'x' }]);
    expect(r.ok).toBe(true);
    expect(r.items.length).toBe(1);
    expect(seen.p[0]).toBe(7);
    expect(seen.sql).toMatch(/s\.company_id=\$1/);
    expect(seen.sql).toMatch(/builder_test/);
  });
  test('mailThread: beérkezett levélhez a mi válaszunk (In-Reply-To), a beérkezett törzse NEM jön', async () => {
    mockRules = [
      { match: /SELECT id, message_id, refs FROM mail_headers WHERE id=\$1/, rows: [{ id: 5, message_id: '<a1@kov.ro>', refs: null }] },
      { match: /FROM mail_headers h JOIN mail_accounts/, rows: [{ id: 5, message_id: '<a1@kov.ro>', refs: null, from_email: 'l@kov.ro', subject: 'Ajánlat', received_at: '2026-10-01T08:00:00Z' }] },
      { match: /FROM mail_sent WHERE company_id=\$1 AND \(message_id/, fn: (sql, p) => ({ rows: p[1].includes('<a1@kov.ro>') ? [{ id: 9, message_id: '<b2@ceg.ro>', in_reply_to: '<a1@kov.ro>', to_email: 'l@kov.ro', subject: 'Re: Ajánlat', body_text: 'Ok, 8-kor.', attachments: [], status: 'sent', created_at: '2026-10-01T09:00:00Z' }] : [] }) },
    ];
    const r = await call(mailboxH, 'mailThread', ADMIN, [{ kind: 'in', id: 5 }]);
    expect(r.ok).toBe(true);
    expect(r.items.map((x) => x.dir)).toEqual(['in', 'out']);
    expect(r.items[0].text).toBeUndefined();
    expect(r.items[1].text).toBe('Ok, 8-kor.');
    expect(mockRead).not.toHaveBeenCalled();
  });
  test('mailThread: más cég levele → nem található', async () => {
    mockRules = [];
    const r = await call(mailboxH, 'mailThread', ADMIN, [{ kind: 'out', id: 999 }]);
    expect(r.ok).toBe(false);
  });
  test('válasz: a küldő (sentBy) rögzítésre kerül', async () => {
    mockRules = [{ match: /FROM mail_headers h JOIN mail_accounts m ON m.id=h.account_id AND m.company_id=h.company_id\s+WHERE h.id=\$1/, rows: [{ id: 5, from_email: 'l@kov.ro', subject: 'S', message_id: '<a1@kov.ro>', acc: { use_inbox: true } }] }];
    const r = await call(mailboxH, 'mailReply', ADMIN, [{ id: 5, body: 'Ok', quote: false }]);
    expect(r.ok).toBe(true);
    expect(mockMailerSend.mock.calls.slice(-1)[0][0].sentBy).toBe('a@ceg.ro');
  });
});
