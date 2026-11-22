// handlers/docArchive.js — kötelező éves cég-dokumentum archívum (lib/docArchive).
// Admin/Manager; minden lekérdezés a saját cégre szűr; audit.

const pool = require('../db');
const audit = require('../lib/audit');
const arch = require('../lib/docArchive');

const handlers = {};
const _am = (u) => u && ['Admin', 'Manager'].includes(u.pozicio) && u.company_id;

// docArchiveStatus() → { phase:'ok'|'warn'|'lock', days_left, due_at, history[] }
handlers.docArchiveStatus = async function (req, res) {
  try {
    const u = req.session.user;
    if (!_am(u)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const st = await arch.status(u.company_id);
    if (!st) return res.json({ result: { ok: false, err: 'Firma nu a fost găsită.' } });
    let history = [];
    try {
      const h = await pool.query(
        `SELECT id, created_by, created_at, completed, file_count, total_bytes, confirmed_at, confirmed_by
           FROM company_doc_archives WHERE company_id=$1 ORDER BY created_at DESC LIMIT 20`, [u.company_id]);
      history = h.rows;
    } catch (e) { if (!(e && e.code === '42P01')) throw e; }
    return res.json({ result: Object.assign({ ok: true, history }, st) });
  } catch (err) {
    console.error('docArchiveStatus hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// docArchiveConfirm({ code }) — a ZIP-ben lévő KOD-ARHIVA.txt kódja → új 1 éves ciklus.
handlers.docArchiveConfirm = async function (req, res, args) {
  try {
    const u = req.session.user;
    if (!_am(u)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const a = (args && args[0]) || {};
    const r = await arch.confirm(u.company_id, a.code, u.email || u.nume);
    audit.fromReq(req, r.ok ? 'doc_archive.confirm' : 'doc_archive.confirm_fail', 'company', u.company_id,
      r.ok ? { archive_id: r.archive_id, due_at: r.due_at } : {});
    return res.json({ result: r });
  } catch (err) {
    console.error('docArchiveConfirm hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

module.exports = handlers;
