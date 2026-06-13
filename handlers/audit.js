// ============================================================
//  VallorSoft — handlers/audit.js
//  Audit-napló olvasása (Admin, saját cégre szűrve, lapozva).
//  Hívás a /api/execute-on: getAuditLog [{ limit?, offset?, action? }]
// ============================================================
const pool = require('../db');

const handlers = {};

handlers.getAuditLog = async function (req, res, args) {
  try {
    if (!req.session.user || req.session.user.pozicio !== 'Admin') {
      return res.json({ result: { ok: false, err: 'Acces interzis' } });
    }
    const cid = req.session.user.company_id;
    const a = (args && args[0]) || {};
    const limit = Math.min(Math.max(parseInt(a.limit, 10) || 100, 1), 500);
    const offset = Math.max(parseInt(a.offset, 10) || 0, 0);

    const params = [cid];
    let where = 'company_id = $1';
    if (a.action) { params.push(String(a.action).slice(0, 64)); where += ' AND action = $' + params.length; }
    params.push(limit); const limIdx = params.length;
    params.push(offset); const offIdx = params.length;

    const r = await pool.query(
      `SELECT id, user_email, action, entity_type, entity_id, detail, ip, created_at
         FROM audit_log
        WHERE ${where}
        ORDER BY created_at DESC, id DESC
        LIMIT $${limIdx} OFFSET $${offIdx}`,
      params);
    return res.json({ result: { ok: true, rows: r.rows } });
  } catch (err) {
    console.error('getAuditLog hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

module.exports = handlers;
