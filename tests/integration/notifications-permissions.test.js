// ============================================================
//  Notifications + mailLog + permissions handlerek
//
//  - notifList, notifUnreadCount, notifMarkRead, notifMarkAllRead
//    (session-hez kötött szűrő: cégre közös VAGY nekem címzett)
//  - mailLogList (Admin/Manager, dátum-szűrő clamp)
//  - getCompanyPermissions, setUserPermission (Admin only, whitelist)
//
//  Külön ellenőrizzük, hogy a `notify` és `logMail` NEM-enumerable
//  belső segédek NEM hívhatók /api/execute-on át.
// ============================================================
jest.mock('../../db', () => require('../helpers/db-mock').pool);

const request = require('supertest');
const express = require('express');
const { pool, rows, reset } = require('../helpers/db-mock');
const { setUser, sessionMiddleware, fixtures } = require('../helpers/session-mock');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(sessionMiddleware);
app.use(require('../../routes/execute'));

function call(fn, args) {
  return request(app).post('/api/execute').send({ functionName: fn, arguments: args });
}

const CID = 1;
const ADMIN = { ...fixtures.admin, company_id: CID };
const MANAGER = { ...fixtures.manager, company_id: CID };
const SOFER = { ...fixtures.sofer, company_id: CID };

beforeEach(() => reset());

// ═══ NOTIFICATIONS ═══════════════════════════════════════════
describe('notifications', () => {
  test('notifList — company_id + user_id szűrés', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([
      { id: 1, type: 'info', title: 'Új értesítés', read_at: null },
    ]));
    const res = await call('notifList', []);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.items).toHaveLength(1);
    // WHERE: company_id=$1 AND (user_id IS NULL OR user_id=$2)
    const [sql, params] = pool.query.mock.calls[0];
    expect(String(sql)).toMatch(/company_id = \$1.*user_id.*IS NULL.*user_id = \$2/is);
    expect(params).toEqual([CID, ADMIN.id]);
  });

  test('notifList — Sofer szerep is látja a sajátjait', async () => {
    setUser(SOFER);
    pool.query.mockResolvedValueOnce(rows([]));
    const res = await call('notifList', []);
    expect(res.body.result.ok).toBe(true);
    expect(pool.query.mock.calls[0][1]).toEqual([CID, SOFER.id]);
  });

  test('notifUnreadCount — 0-ra normalizál', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([]));
    const res = await call('notifUnreadCount', []);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.count).toBe(0);
  });

  test('notifUnreadCount — visszaadja a számot', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([{ c: 7 }]));
    const res = await call('notifUnreadCount', []);
    expect(res.body.result.count).toBe(7);
  });

  test('notifMarkRead — ID nélkül elutasít', async () => {
    setUser(ADMIN);
    const res = await call('notifMarkRead', [{}]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/lipsa/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('notifMarkRead — sikeres, csak a saját scope-ban frissít', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([{ id: 5 }])) // UPDATE RETURNING
      .mockResolvedValueOnce({ rowCount: 1 }); // audit
    const res = await call('notifMarkRead', [{ id: 5 }]);
    expect(res.body.result.ok).toBe(true);
    const [sql, params] = pool.query.mock.calls[0];
    expect(String(sql)).toMatch(/UPDATE notifications.*read_at = NOW/is);
    expect(params).toEqual([CID, ADMIN.id, 5]);
  });

  test('notifMarkAllRead — count visszaadva', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce({ rowCount: 4 })
      .mockResolvedValueOnce({ rowCount: 1 }); // audit
    const res = await call('notifMarkAllRead', []);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.count).toBe(4);
  });

  test('notify NEM hívható /api/execute-on át (NEM-enumerable segéd)', async () => {
    setUser(ADMIN);
    const res = await call('notify', [{ company_id: CID, title: 'x' }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/necunoscut/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('session nélkül elutasít', async () => {
    setUser(null);
    const res = await call('notifList', []);
    expect(res.status).toBe(401);
  });
});

// ═══ MAIL LOG ════════════════════════════════════════════════
describe('mailLogList', () => {
  test('Sofer nem hívhatja (PII védelem)', async () => {
    setUser(SOFER);
    const res = await call('mailLogList', []);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/interzis/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('Manager hívhatja — company_id + LIMIT 200', async () => {
    setUser(MANAGER);
    pool.query.mockResolvedValueOnce(rows([
      { id: 1, to_email: 'x@x.hu', subject: 'Y', type: 'invite', status: 'sent' },
    ]));
    const res = await call('mailLogList', []);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.items).toHaveLength(1);
    const [sql, params] = pool.query.mock.calls[0];
    expect(String(sql)).toMatch(/FROM mail_log.*WHERE company_id.*LIMIT 200/is);
    expect(params).toEqual([CID]);
  });

  test('dátum-szűrő from/to bekerül a paraméterekbe', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([]));
    await call('mailLogList', [{ from: '2026-01-01', to: '2026-12-31' }]);
    const [sql, params] = pool.query.mock.calls[0];
    expect(params).toEqual([CID, '2026-01-01', '2026-12-31']);
    expect(String(sql)).toMatch(/created_at >= \$2/);
    expect(String(sql)).toMatch(/created_at < \$3/);
  });

  test('logMail NEM hívható /api/execute-on át', async () => {
    setUser(ADMIN);
    const res = await call('logMail', [{ company_id: CID, to_email: 'x@x.hu' }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/necunoscut/i);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

// ═══ PERMISSIONS ═════════════════════════════════════════════
describe('permissions', () => {
  test('getCompanyPermissions — Manager NEM hívhatja', async () => {
    setUser(MANAGER);
    const res = await call('getCompanyPermissions', []);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/interzis/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('getCompanyPermissions — Admin: user + flags mátrix', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([
      { id: 20, nume: 'M', email: 'm@ceg.hu', pozicio: 'Manager',
        perms: ['stats_finance', 'orders_delete'] },
      { id: 21, nume: 'M2', email: 'm2@ceg.hu', pozicio: 'Manager', perms: [] },
    ]));
    const res = await call('getCompanyPermissions', []);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.users).toHaveLength(2);
    expect(res.body.result.users[0].flags.stats_finance).toBe(true);
    expect(res.body.result.users[0].flags.orders_delete).toBe(true);
    expect(res.body.result.users[0].flags.invoice_issue).toBe(false);
    expect(res.body.result.users[1].flags.stats_finance).toBe(false);
    expect(res.body.result.keys).toEqual(
      expect.arrayContaining(['stats_finance', 'orders_delete', 'invoice_issue', 'data_export', 'users_manage'])
    );
  });

  test('setUserPermission — Manager NEM hívhatja', async () => {
    setUser(MANAGER);
    const res = await call('setUserPermission', [{
      user_id: 21, perm_key: 'stats_finance', enabled: true,
    }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/interzis/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  // A gas() a setUserPermission-t nyers objekttel hívja (nem tömbben) —
  // a handler kifejezetten ezt a formát dolgozza fel: `!Array.isArray(args)
  // ? args : args||{}`. A teszt is ugyanúgy hívja.
  test('setUserPermission — érvénytelen user_id', async () => {
    setUser(ADMIN);
    const res = await call('setUserPermission',
      { user_id: 'abc', perm_key: 'stats_finance', enabled: true });
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/Utilizator incorect/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('setUserPermission — whitelist-en kívüli perm_key', async () => {
    setUser(ADMIN);
    const res = await call('setUserPermission',
      { user_id: 21, perm_key: 'DELETE_ALL_DATA', enabled: true });
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/necunoscut/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('setUserPermission — idegen cég Manager-e nem beállítható', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([])); // ownership SELECT üres
    const res = await call('setUserPermission',
      { user_id: 999, perm_key: 'stats_finance', enabled: true });
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/gasit/i);
    expect(pool.query).toHaveBeenCalledTimes(1);
    const sqls = pool.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /INSERT INTO user_permissions/i.test(s))).toBe(false);
  });

  test('setUserPermission — sikeres UPSERT + audit', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([{ id: 21 }])) // ownership OK
      .mockResolvedValueOnce({ rowCount: 1 })    // UPSERT
      .mockResolvedValueOnce({ rowCount: 1 });  // audit
    const res = await call('setUserPermission',
      { user_id: 21, perm_key: 'invoice_issue', enabled: true });
    expect(res.body.result.ok).toBe(true);
    const sqls = pool.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /INSERT INTO user_permissions.*ON CONFLICT.*DO UPDATE/is.test(s))).toBe(true);
  });

  test('hasPerm NEM hívható /api/execute-on át', async () => {
    setUser(ADMIN);
    const res = await call('hasPerm', [CID, ADMIN.id, 'stats_finance']);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/necunoscut/i);
  });

  test('mind az 5 érvényes perm_key elfogadva', async () => {
    for (const key of ['stats_finance', 'orders_delete', 'invoice_issue', 'data_export', 'users_manage']) {
      reset();
      setUser(ADMIN);
      pool.query
        .mockResolvedValueOnce(rows([{ id: 21 }]))
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rowCount: 1 });
      const res = await call('setUserPermission',
        { user_id: 21, perm_key: key, enabled: true });
      expect(res.body.result.ok).toBe(true);
    }
  });
});
