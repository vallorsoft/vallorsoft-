// ============================================================
//  Unit-teszt — services/mailbox.syncHeaders + üres lista diagnosztika
//  • a legújabb, még nem ismert leveleket tölti be (nem ragad a legrégebbieken)
//  • a „Kiktől” szűrő által elrejtett darabszámot rögzíti (last_skipped)
//  • üres Levelek-listánál a szerver visszaadja a fiókonkénti okot
// ============================================================
let mockRules = [];
const mockDbQuery = jest.fn(async (sql, params) => {
  for (const r of mockRules) if (r.match.test(sql)) return r.fn ? r.fn(sql, params) : { rows: r.rows || [], rowCount: (r.rows || []).length };
  return { rows: [], rowCount: 0 };
});
jest.mock('../../db', () => ({ query: (...a) => mockDbQuery(...a) }));
jest.mock('../../lib/audit', () => ({ fromReq: async () => {} }));
jest.mock('../../lib/featureEnabled', () => ({ featureEnabled: async () => true }));
jest.mock('../../lib/crypto', () => ({ decrypt: () => JSON.stringify({ provider: 'custom', host: 'imap.x', port: 993, email: 'i@ceg.ro', password: 'secret1' }), encrypt: (s) => 'enc:' + s }));

let mockFetchedRange = null;
const mockMsgs = {
  10: { uid: 10, envelope: { from: [{ address: 'client@known.ro', name: 'Ügyfél' }], subject: 'Régi', date: new Date('2026-10-01') } },
  11: { uid: 11, envelope: { from: [{ address: 'idegen@spam.ro' }], subject: 'Reklám', date: new Date('2026-10-02') } },
  12: { uid: 12, envelope: { from: [{ address: 'client@known.ro' }], subject: 'Új levél CMD-2026-0005', date: new Date('2026-10-06') } },
};
jest.mock('../../services/email-intake', () => ({
  resolveImap: (c) => ({ host: c.host, user: c.email, pass: c.password }),
  makeClient: () => ({
    connect: async () => {},
    logout: async () => {},
    getMailboxLock: async () => ({ release() {} }),
    search: async () => [10, 11, 12],
    fetch: async function* (range) { mockFetchedRange = range; for (const u of String(range).split(',')) yield mockMsgs[u]; },
  }),
}));

const svc = require('../../services/mailbox');
const mailboxH = require('../../handlers/mailbox');
function call(fn, user, args) { return new Promise((r) => mailboxH[fn]({ session: { user } }, { json: (p) => r(p.result) }, args)); }
const ADMIN = { id: 1, email: 'a@ceg.ro', pozicio: 'Admin', company_id: 7 };

beforeEach(() => { mockRules = []; mockDbQuery.mockClear(); mockFetchedRange = null; });

test('syncHeaders: csak a nem ismert UID-k, legújabb elöl; a szűrt darab rögzítve', async () => {
  const inserted = [];
  let diag = null;
  mockRules = [
    { match: /FROM clients/, rows: [{ e: 'client@known.ro' }] },
    { match: /SELECT uid FROM mail_headers/, rows: [{ uid: '10' }] },
    { match: /INSERT INTO mail_headers/, fn: (s, p) => { inserted.push(p); return { rowCount: 1, rows: [] }; } },
    { match: /SET last_seen/, fn: (s, p) => { diag = p; return { rowCount: 1, rows: [] }; } },
  ];
  const r = await svc.syncHeaders(require('../../db'), { id: 1, company_id: 7, creds_enc: 'x', folders: 'INBOX', allow_mode: 'known', since: '2026-09-01' });
  expect(mockFetchedRange).toBe('12,11');           // 10 már ismert; legújabb elöl
  expect(inserted.map((p) => p[3])).toEqual([12]);  // az idegen feladó nem tárolódik
  expect(r).toEqual({ added: 1, seen: 3, skipped: 1 });
  expect(diag).toEqual([1, 3, 1]);
});

test('mailInboxList: üres listánál fiókonkénti ok (diag)', async () => {
  mockRules = [
    { match: /FROM mail_headers h/, rows: [] },
    { match: /FROM mail_accounts WHERE company_id=\$1 ORDER BY id/, fn: (s, p) => ({ rows: p[0] === 7 ? [
      { id: 1, label: 'Megrendelések', use_inbox: false, use_orders: true, allow_mode: 'all', since: '2026-10-01', enabled: true, last_check: '2026-10-07', last_error: null, last_seen: 4, last_skipped: 0 },
    ] : [] }) },
  ];
  const r = await call('mailInboxList', ADMIN, [{}]);
  expect(r.ok).toBe(true);
  expect(r.items).toEqual([]);
  expect(r.diag[0]).toMatchObject({ label: 'Megrendelések', use_inbox: false, last_seen: 4 });
});

test('mailAccountSave: history_days → since visszaállítva, idegen érték nem', async () => {
  const sinceCalls = [];
  mockRules = [
    { match: /INSERT INTO mail_accounts/, rows: [{ id: 9 }] },
    { match: /SET since = now\(\)/, fn: (s, p) => { sinceCalls.push(p); return { rowCount: 1, rows: [] }; } },
  ];
  const base = { provider: 'gmail', email: 'i@ceg.ro', password: 'secret12' };
  expect((await call('mailAccountSave', ADMIN, [Object.assign({ history_days: '30' }, base)])).ok).toBe(true);
  expect(sinceCalls).toEqual([[30, 9, 7]]);
  await call('mailAccountSave', ADMIN, [Object.assign({ history_days: '5000' }, base)]);
  expect(sinceCalls.length).toBe(1);
});
