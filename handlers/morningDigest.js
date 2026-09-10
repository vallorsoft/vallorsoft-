// handlers/morningDigest.js — reggeli összefoglaló beállítás CRUD.
// A `companies.digest_*` mezőket kezeli (be/ki, időpont, extra címzettek).
// Olvasás: Admin/Manager (cégre szűrt); írás: Admin only (Manager NEM állítja).

const pool = require('../db');
const audit = require('../lib/audit');

const handlers = {};
const _am = (u) => u && ['Admin','Manager'].includes(u.pozicio);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

handlers.getMorningDigest = async function (req, res, args) {
  try {
    if (!_am(req.session.user)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = req.session.user.company_id;
    const r = await pool.query(
      `SELECT COALESCE(digest_enabled, false) AS enabled,
              COALESCE(digest_time, '07:00'::time)::text AS time,
              COALESCE(digest_recipients, '[]'::jsonb) AS recipients,
              digest_last_sent_at AS last_sent_at
         FROM companies WHERE id=$1`, [cid]);
    if (!r.rows.length) return res.json({ result: { ok: false, err: 'Firma nu a fost gasita.' } });
    const row = r.rows[0];
    return res.json({ result: { ok: true,
      enabled: !!row.enabled,
      time: String(row.time || '07:00').slice(0, 5),
      recipients: Array.isArray(row.recipients) ? row.recipients : [],
      last_sent_at: row.last_sent_at
    }});
  } catch (err) {
    // Migráció-hiány esetén értelmes fallback: minden „off"-nak látszik, a
    // saveMorningDigest majd hiányzó oszlopnál értelmes hibaüzenetet ad.
    if (err && err.code === '42703') {
      return res.json({ result: { ok: true, enabled: false, time: '07:00', recipients: [], last_sent_at: null, migration_pending: true } });
    }
    console.error('getMorningDigest hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

handlers.saveMorningDigest = async function (req, res, args) {
  try {
    if (!req.session.user || req.session.user.pozicio !== 'Admin') {
      return res.json({ result: { ok: false, err: 'Doar administratorul poate modifica sumarul zilnic.' } });
    }
    const cid = req.session.user.company_id;
    const a = (args && args[0]) || {};
    const enabled = !!a.enabled;
    let time = String(a.time || '07:00').trim();
    if (!/^\d{2}:\d{2}$/.test(time)) time = '07:00';
    // Extra címzettek (max 20, egyedi, EMAIL_RE-validáció; duplikátumok/érvénytelen ki).
    var raw = Array.isArray(a.recipients) ? a.recipients : [];
    var seen = new Set();
    var recipients = [];
    for (var i = 0; i < raw.length && recipients.length < 20; i++) {
      var e = String(raw[i] || '').trim().toLowerCase();
      if (!e || seen.has(e) || !EMAIL_RE.test(e)) continue;
      seen.add(e); recipients.push(e);
    }
    try {
      await pool.query(
        `UPDATE companies SET digest_enabled=$1, digest_time=$2::time, digest_recipients=$3
          WHERE id=$4`,
        [enabled, time, JSON.stringify(recipients), cid]);
      try { audit.fromReq(req, 'company.morning_digest.set', 'company', String(cid), { enabled, time, recipients_count: recipients.length }); } catch(_){}
      return res.json({ result: { ok: true, enabled, time, recipients } });
    } catch (err) {
      if (err && err.code === '42703') {
        return res.json({ result: { ok: false, err: 'Coloanele digest_* lipsesc — repornește serverul pentru a rula migrațiile.' } });
      }
      throw err;
    }
  } catch (err) {
    console.error('saveMorningDigest hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

module.exports = handlers;
