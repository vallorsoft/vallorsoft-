// ============================================================
//  VallorSoft — handlers/permissions.js
//  Granulált jogosultságok (Manager-engedélyek) — a MEGLÉVŐ
//  `user_permissions` táblára épül (db/order-payments.sql), nem
//  duplikál. A perm_key egy FIX fehérlista; az Admin mindig átmegy.
//
//  - getCompanyPermissions  (Admin): a cég Manager-ei + flag-jeik
//  - setUserPermission      (Admin): egy flag állítása, ownership-ellenőrzéssel + audit
//  - hasPerm(pool,cid,uid,key) — NEM-enumerálható segéd (NEM /api/execute-ról),
//    a server-oldali kapukhoz; Admin → mindig true.
//
//  Minden SQL company_id-szűrt + paraméteres (multi-tenant).
// ============================================================
const pool = require('../db');
const audit = require('../lib/audit');

const handlers = {};

// FIX fehérlista — csak ezek a kulcsok engedélyezettek (a setUserPermission ezt
// kényszeríti ki; tetszőleges perm_key NEM szúrható be).
const PERM_KEYS = ['stats_finance', 'orders_delete', 'invoice_issue', 'data_export', 'users_manage'];

function _isAdmin(req) {
  return req.session && req.session.user && req.session.user.pozicio === 'Admin';
}
function _deny(res) { return res.json({ result: { ok: false, err: 'Acces interzis' } }); }

// ── Admin: a cég Manager-ei + minden perm-flag (mátrix-nézethez) ──
handlers.getCompanyPermissions = async function (req, res, args) {
  try {
    if (!_isAdmin(req)) return _deny(res);
    const cid = req.session.user.company_id;
    // Egy lekérdezés: minden Manager + a hozzá tartozó engedélyezett kulcsok tömbje.
    const r = await pool.query(
      `SELECT u.id, u.nume, u.email, u.pozicio,
              COALESCE(
                ARRAY_AGG(up.perm_key) FILTER (WHERE up.enabled = TRUE), '{}'
              ) AS perms
         FROM users u
         LEFT JOIN user_permissions up ON up.user_id = u.id
        WHERE u.company_id = $1 AND u.pozicio = 'Manager'
        GROUP BY u.id, u.nume, u.email, u.pozicio
        ORDER BY u.nume`,
      [cid]
    );
    const users = r.rows.map(function (u) {
      const set = new Set(u.perms || []);
      const flags = {};
      PERM_KEYS.forEach(function (k) { flags[k] = set.has(k); });
      return { id: u.id, nume: u.nume, email: u.email, pozicio: u.pozicio, flags: flags };
    });
    return res.json({ result: { ok: true, users: users, keys: PERM_KEYS } });
  } catch (err) {
    console.error('getCompanyPermissions hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// ── Admin: egy jogosultság-flag állítása ──
// args: { user_id, perm_key, enabled }  (vagy tömb-kompatibilis)
handlers.setUserPermission = async function (req, res, args) {
  try {
    if (!_isAdmin(req)) return _deny(res);
    const cid = req.session.user.company_id;
    const a = (args && !Array.isArray(args)) ? args : (args || {});
    const userId = parseInt(a.user_id, 10);
    const permKey = String(a.perm_key || '');
    const enabled = !!a.enabled;
    if (!Number.isFinite(userId)) return res.json({ result: { ok: false, err: 'Utilizator incorect' } });
    // Fehérlista-kényszerítés: tetszőleges perm_key NEM állítható.
    if (PERM_KEYS.indexOf(permKey) === -1) return res.json({ result: { ok: false, err: 'Permisiune necunoscută' } });
    // Ownership: csak a SAJÁT cég Manager-e állítható (cross-tenant write védelem).
    const ur = await pool.query(
      `SELECT id FROM users WHERE id = $1 AND company_id = $2 AND pozicio = 'Manager'`,
      [userId, cid]
    );
    if (!ur.rows.length) return res.json({ result: { ok: false, err: 'Utilizatorul nu a fost gasit' } });
    await pool.query(
      `INSERT INTO user_permissions (company_id, user_id, perm_key, enabled, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (user_id, perm_key)
       DO UPDATE SET enabled = $4, updated_at = NOW()`,
      [cid, userId, permKey, enabled]
    );
    audit.fromReq(req, 'permission.set', 'user', userId, { perm_key: permKey, enabled: enabled });
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('setUserPermission hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// ────────────────────────────────────────────────────────────
//  Újrahasznosítható server-oldali kapu — a write-handlerekből hívható.
//  hasPerm(pool, companyId, userId, key) → boolean
//  Az ADMIN (a session-ben Admin) mindig átmegy → ezt a HÍVÓ dönti el a
//  pozíció alapján; itt a user_permissions-t nézzük (Manager-eknek).
//  NEM-enumerálható → NEM hívható /api/execute-ról (mint a logMail minta).
// ────────────────────────────────────────────────────────────
async function hasPerm(dbc, companyId, userId, key) {
  try {
    if (PERM_KEYS.indexOf(key) === -1) return false;
    const cid = parseInt(companyId, 10);
    const uid = parseInt(userId, 10);
    if (!cid || !uid) return false;
    const q = dbc || pool;
    const r = await q.query(
      `SELECT up.enabled
         FROM user_permissions up
         JOIN users u ON u.id = up.user_id
        WHERE up.user_id = $1 AND u.company_id = $2 AND up.perm_key = $3`,
      [uid, cid, key]
    );
    return !!(r.rows.length && r.rows[0].enabled);
  } catch (err) {
    console.warn('hasPerm hiba:', err.message);
    return false;
  }
}

module.exports = handlers;
// A `hasPerm` segéd NEM-enumerálható → nem hívható /api/execute-on át, de
// require-rel elérhető a szerver-oldali kapukhoz (mint a mailLog.logMail).
Object.defineProperty(module.exports, 'hasPerm', { enumerable: false, value: hasPerm });
Object.defineProperty(module.exports, 'PERM_KEYS', { enumerable: false, value: PERM_KEYS });
