// ============================================================
//  VallorSoft — lib/audit.js
//  Best-effort audit-bejegyzés a kritikus műveletekhez. SOHA nem dob
//  (a fő műveletet nem buktatja) — hibánál csak warn-naplóz.
//  Tárolás: audit_log tábla (db/audit-log.sql).
// ============================================================
const pool = require('../db');
const log = require('./logger');

async function record(entry, dbc) {
  const q = dbc || pool;
  const e = entry || {};
  try {
    await q.query(
      `INSERT INTO audit_log (company_id, user_email, action, entity_type, entity_id, detail, ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        e.company_id || null,
        e.user_email ? String(e.user_email).slice(0, 255) : null,
        String(e.action || 'unknown').slice(0, 64),
        e.entity_type ? String(e.entity_type).slice(0, 64) : null,
        e.entity_id != null ? String(e.entity_id).slice(0, 64) : null,
        e.detail ? JSON.stringify(e.detail) : null,
        e.ip ? String(e.ip).slice(0, 64) : null,
      ]);
    return true;
  } catch (err) {
    log.warn('audit-write-failed', { err: err.message, action: e.action });
    return false;
  }
}

// A kérés (req) session-/IP-adataiból összeállít és rögzít egy bejegyzést.
function fromReq(req, action, entityType, entityId, detail) {
  const u = (req && req.session && req.session.user) || {};
  const rawIp = req && (req.headers && req.headers['x-forwarded-for']
    || (req.socket && req.socket.remoteAddress));
  return record({
    company_id: u.company_id || (detail && detail.company_id) || null,
    user_email: u.email || (detail && detail.email) || null,
    action: action,
    entity_type: entityType,
    entity_id: entityId,
    detail: detail || null,
    ip: rawIp ? String(rawIp).split(',')[0].trim() : null,
  });
}

module.exports = { record, fromReq };
