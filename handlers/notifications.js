// ============================================================
//  VallorSoft — handlers/notifications.js
//  Értesítési központ (notifications). Minden lekérdezés cégre (és a
//  belépett felhasználóra) szűr, paraméteres SQL-lel. Az írásokat
//  best-effort audit-naplózzuk.
//
//  Az értesítés a céghez tartozik; user_id NULL = az egész cégnek szól
//  (minden Admin/Manager látja). A `notify(...)` segédet más modulok is
//  hívhatják (pl. routes/portal.js, services/scheduler.js) — best-effort
//  beszúrás, soha nem dob.
// ============================================================
const pool = require('../db');
const audit = require('../lib/audit');

const handlers = {};

// Egy felhasználó által látott értesítések szűrő-feltétele:
// a cég közös (user_id IS NULL) VAGY kifejezetten neki szóló.
const SCOPE = 'company_id = $1 AND (user_id IS NULL OR user_id = $2)';

// A belépett felhasználó értesítései (legújabb elöl), max 100.
handlers.notifList = async function (req, res) {
  try {
    const u = req.session && req.session.user;
    if (!u) return res.json({ result: { ok: false, err: 'Nu sunteti autentificat' } });
    const r = await pool.query(
      `SELECT id, type, title, body, link_tab, read_at, created_at
         FROM notifications
        WHERE ${SCOPE}
        ORDER BY created_at DESC
        LIMIT 100`,
      [u.company_id, u.id]
    );
    return res.json({ result: { ok: true, items: r.rows } });
  } catch (err) {
    console.error('notifList hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// Olvasatlan értesítések száma a felhasználó/cég körében.
handlers.notifUnreadCount = async function (req, res) {
  try {
    const u = req.session && req.session.user;
    if (!u) return res.json({ result: { ok: false, err: 'Nu sunteti autentificat' } });
    const r = await pool.query(
      `SELECT COUNT(*)::int AS c
         FROM notifications
        WHERE ${SCOPE} AND read_at IS NULL`,
      [u.company_id, u.id]
    );
    return res.json({ result: { ok: true, count: (r.rows[0] && r.rows[0].c) || 0 } });
  } catch (err) {
    console.error('notifUnreadCount hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// Egy értesítés olvasottra állítása (cégre + felhasználóra szűrve).
handlers.notifMarkRead = async function (req, res, args) {
  try {
    const u = req.session && req.session.user;
    if (!u) return res.json({ result: { ok: false, err: 'Nu sunteti autentificat' } });
    const a = Array.isArray(args) ? (args[0] || {}) : (args || {});
    const id = parseInt(a.id, 10);
    if (!id) return res.json({ result: { ok: false, err: 'Identificator lipsa' } });
    const r = await pool.query(
      `UPDATE notifications SET read_at = NOW()
        WHERE id = $3 AND ${SCOPE} AND read_at IS NULL
        RETURNING id`,
      [u.company_id, u.id, id]
    );
    if (r.rowCount) audit.fromReq(req, 'notif.read', 'notification', id);
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('notifMarkRead hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// Az összes (a felhasználó körébe tartozó) értesítés olvasottra állítása.
handlers.notifMarkAllRead = async function (req, res) {
  try {
    const u = req.session && req.session.user;
    if (!u) return res.json({ result: { ok: false, err: 'Nu sunteti autentificat' } });
    const r = await pool.query(
      `UPDATE notifications SET read_at = NOW()
        WHERE ${SCOPE} AND read_at IS NULL`,
      [u.company_id, u.id]
    );
    audit.fromReq(req, 'notif.read_all', 'company', u.company_id, { count: r.rowCount });
    return res.json({ result: { ok: true, count: r.rowCount } });
  } catch (err) {
    console.error('notifMarkAllRead hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// ────────────────────────────────────────────────────────────
//  Újrahasznosítható belső segéd — más modulok ezt hívják, hogy
//  értesítést szúrjanak be. Paraméteres, best-effort (sosem dob).
//  notify(pool, { company_id, user_id?, type, title, body, link_tab })
// ────────────────────────────────────────────────────────────
async function notify(dbc, opts) {
  try {
    const o = opts || {};
    const cid = parseInt(o.company_id, 10);
    if (!cid) return false;
    const q = dbc || pool;
    await q.query(
      `INSERT INTO notifications (company_id, user_id, type, title, body, link_tab)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        cid,
        o.user_id != null ? parseInt(o.user_id, 10) : null,
        o.type ? String(o.type).slice(0, 64) : null,
        o.title ? String(o.title).slice(0, 300) : null,
        o.body ? String(o.body).slice(0, 2000) : null,
        o.link_tab ? String(o.link_tab).slice(0, 64) : null,
      ]
    );
    return true;
  } catch (err) {
    // best-effort: az értesítés-beszúrás soha ne buktassa a fő műveletet
    console.warn('notify beszúrás hiba:', err.message);
    return false;
  }
}

// A dispatcher-registry CSAK a req/res/args-jellegű handlereket kapja
// (Object.assign az enumerálható kulcsokat másolja). A `notify` belső
// segéd NEM-enumerálható → NEM hívható /api/execute-on át (másféle
// szignatúra: notify(pool, opts)), de require-rel elérhető.
module.exports = handlers;
Object.defineProperty(module.exports, 'notify', { enumerable: false, value: notify });
