// ============================================================
//  VallorSoft — handlers/statsReports.js
//  Statisztika 2.0 — Időzített PDF-/HTML-riport (mentett nézet → e-mail)
//
//  CRUD a `stats_report_schedules` táblához (PR #1 létrehozta).
//  A scheduler (services/scheduler.js `startStatsReportScheduler`) használja
//  a `stats_report_schedules.enabled=true` sorokat.
//
//  Írás: Admin only; olvasás: Admin/Manager.
// ============================================================
const pool = require('../db');
const audit = require('../lib/audit');

const handlers = {};

function _am(req) { return !!(req.session.user && ['Admin', 'Manager'].includes(req.session.user.pozicio)); }
function _isAdmin(req) { return !!(req.session.user && (req.session.user.pozicio === 'Admin' || req.session.user.is_dev)); }
function _deny(res) { return res.json({ result: { ok: false, err: 'Acces interzis' } }); }
function _err(res, msg) { return res.json({ result: { ok: false, err: msg || 'Eroare de server' } }); }
function _ok(res, extra) { return res.json({ result: Object.assign({ ok: true }, extra || {}) }); }
function _str(x, n) { const s = x == null ? null : String(x).trim().slice(0, n); return s || null; }
function _bool(x) { return x === true || x === 'true' || x === 1 || x === '1'; }

const SCHEDULES = new Set(['daily', 'weekly', 'monthly']);
const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

function _normalizeRecipients(raw) {
  if (!raw) return [];
  if (typeof raw === 'string') raw = raw.split(/[,;\s]+/);
  if (!Array.isArray(raw)) return [];
  return raw
    .map(function (e) { return String(e || '').trim().toLowerCase(); })
    .filter(function (e) { return e && EMAIL_RE.test(e); })
    .slice(0, 20);   // észszerű felső határ
}

// Lista — Admin/Manager
handlers.statsReportScheduleList = async function (req, res) {
  try {
    if (!_am(req)) return _deny(res);
    const me = req.session.user;
    const r = await pool.query(
      `SELECT s.id, s.name, s.schedule, s.recipients, s.enabled, s.last_run_at,
              s.view_id, s.user_id, s.created_at, s.updated_at,
              v.name AS view_name
       FROM stats_report_schedules s
       LEFT JOIN stats_views v ON v.id = s.view_id
       WHERE s.company_id = $1
       ORDER BY s.updated_at DESC`, [me.company_id]);
    return _ok(res, { schedules: r.rows });
  } catch (err) { console.error('statsReportScheduleList hiba:', err); return _err(res); }
};

// Létrehozás / frissítés — Admin only
// args: [{ id?, name, view_id?, schedule, recipients, enabled }]
handlers.statsReportScheduleSave = async function (req, res, args) {
  try {
    if (!_isAdmin(req)) return _deny(res);
    const me = req.session.user;
    const a = (args && args[0]) || {};
    const name = _str(a.name, 120);
    const schedule = _str(a.schedule, 20) || 'monthly';
    if (!name) return _err(res, 'Numele este obligatoriu.');
    if (!SCHEDULES.has(schedule)) return _err(res, 'Frecvență invalidă.');
    const recipients = _normalizeRecipients(a.recipients);
    if (!recipients.length) return _err(res, 'Cel puțin un destinatar e-mail este necesar.');
    const enabled = _bool(a.enabled);
    let viewId = null;
    if (a.view_id) {
      viewId = parseInt(a.view_id, 10) || null;
      if (viewId) {
        // Csak SAJÁT cég nézetére hivatkozhat
        const own = await pool.query(
          `SELECT 1 FROM stats_views WHERE id=$1 AND company_id=$2`, [viewId, me.company_id]);
        if (!own.rowCount) return _err(res, 'Vederea nu a fost găsită.');
      }
    }

    if (a.id) {
      const id = parseInt(a.id, 10);
      const own = await pool.query(
        `SELECT 1 FROM stats_report_schedules WHERE id=$1 AND company_id=$2`,
        [id, me.company_id]);
      if (!own.rowCount) return _err(res, 'Programarea nu a fost găsită.');
      await pool.query(
        `UPDATE stats_report_schedules
         SET name=$1, view_id=$2, schedule=$3, recipients=$4::jsonb, enabled=$5, updated_at=NOW()
         WHERE id=$6 AND company_id=$7`,
        [name, viewId, schedule, JSON.stringify(recipients), enabled, id, me.company_id]);
      audit.fromReq(req, 'stats.report_schedule.update', 'stats_report_schedule', id, { name, schedule, enabled });
      return _ok(res, { id });
    }
    const ins = await pool.query(
      `INSERT INTO stats_report_schedules (company_id, user_id, view_id, name, schedule, recipients, enabled)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7) RETURNING id`,
      [me.company_id, me.id, viewId, name, schedule, JSON.stringify(recipients), enabled]);
    audit.fromReq(req, 'stats.report_schedule.create', 'stats_report_schedule', ins.rows[0].id, { name, schedule, enabled });
    return _ok(res, { id: ins.rows[0].id });
  } catch (err) { console.error('statsReportScheduleSave hiba:', err); return _err(res); }
};

// Törlés — Admin only
handlers.statsReportScheduleDelete = async function (req, res, args) {
  try {
    if (!_isAdmin(req)) return _deny(res);
    const me = req.session.user;
    const id = parseInt((args && (args[0] || args.id)) || 0, 10);
    if (!id) return _err(res, 'ID lipsă.');
    const r = await pool.query(
      `DELETE FROM stats_report_schedules WHERE id=$1 AND company_id=$2`, [id, me.company_id]);
    if (!r.rowCount) return _err(res, 'Programarea nu a fost găsită.');
    audit.fromReq(req, 'stats.report_schedule.delete', 'stats_report_schedule', id, {});
    return _ok(res);
  } catch (err) { console.error('statsReportScheduleDelete hiba:', err); return _err(res); }
};

// Segéd: e-mail cím validációnak közzététele (a scheduler is használja)
handlers.statsReportScheduleSave._EMAIL_RE = EMAIL_RE;
handlers.statsReportScheduleSave._SCHEDULES = SCHEDULES;

module.exports = handlers;
