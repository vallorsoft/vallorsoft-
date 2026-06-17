// ============================================================
//  VallorSoft — handlers/mailLog.js
//  Levél-napló (mail_log) — a ténylegesen kiküldött e-mailek listája.
//
//  A címzett-e-mail SZEMÉLYES ADAT → a lista CSAK Admin/Manager részére
//  érhető el, cégre szűrve, paraméteres SQL-lel.
//
//  A `logMail(...)` segédet a services/email.js hívja a tényleges küldés
//  végén (best-effort, try/catch-be csomagolva) — soha nem dob.
// ============================================================
const pool = require('../db');

const handlers = {};

function isAdminManager(u) {
  return u && (u.pozicio === 'Admin' || u.pozicio === 'Manager');
}

// A cég levél-naplója (legújabb elöl), opcionális dátum-szűréssel, max 200.
handlers.mailLogList = async function (req, res, args) {
  try {
    const u = req.session && req.session.user;
    if (!isAdminManager(u)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const a = Array.isArray(args) ? (args[0] || {}) : (args || {});
    const params = [u.company_id];
    let where = 'company_id = $1';
    if (a.from) { params.push(String(a.from).slice(0, 10)); where += ` AND created_at >= $${params.length}`; }
    if (a.to)   { params.push(String(a.to).slice(0, 10));   where += ` AND created_at < $${params.length}`; }
    const r = await pool.query(
      `SELECT id, to_email, subject, type, status, provider_id, created_at
         FROM mail_log
        WHERE ${where}
        ORDER BY created_at DESC
        LIMIT 200`,
      params
    );
    return res.json({ result: { ok: true, items: r.rows } });
  } catch (err) {
    console.error('mailLogList hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// ────────────────────────────────────────────────────────────
//  Újrahasznosítható belső segéd — a küldő kódból hívható, hogy
//  egy kiküldött e-mailt naplózzon. Paraméteres, best-effort (sosem dob).
//  logMail(pool, { company_id, to_email, subject, type, status, provider_id })
// ────────────────────────────────────────────────────────────
async function logMail(dbc, opts) {
  try {
    const o = opts || {};
    const cid = parseInt(o.company_id, 10);
    if (!cid) return false;                 // company_id nélkül NEM naplózunk (multi-tenant)
    const q = dbc || pool;
    await q.query(
      `INSERT INTO mail_log (company_id, to_email, subject, type, status, provider_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        cid,
        o.to_email ? String(o.to_email).slice(0, 320) : null,
        o.subject ? String(o.subject).slice(0, 500) : null,
        o.type ? String(o.type).slice(0, 64) : null,
        o.status ? String(o.status).slice(0, 32) : null,
        o.provider_id ? String(o.provider_id).slice(0, 128) : null,
      ]
    );
    return true;
  } catch (err) {
    console.warn('logMail beszúrás hiba:', err.message);
    return false;
  }
}

// A `logMail` belső segéd NEM-enumerálható → nem hívható /api/execute-on
// át (másféle szignatúra: logMail(pool, opts)), de require-rel elérhető.
module.exports = handlers;
Object.defineProperty(module.exports, 'logMail', { enumerable: false, value: logMail });
