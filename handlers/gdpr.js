// ============================================================
//  VallorSoft — handlers/gdpr.js
//  GDPR: adat-export (hozzáférés/hordozhatóság) + felhasználó-
//  anonimizálás (törléshez való jog). Mindkettő Admin, cégre szűrve,
//  és audit-naplózva. Az export NEM tartalmaz jelszó-hasht/TOTP-titkot.
// ============================================================
const pool = require('../db');
const audit = require('../lib/audit');

const handlers = {};

handlers.exportCompanyData = async function (req, res) {
  try {
    if (!req.session.user || req.session.user.pozicio !== 'Admin') {
      return res.json({ result: { ok: false, err: 'Acces interzis' } });
    }
    const cid = req.session.user.company_id;
    const rows = async (sql) => {
      try { return (await pool.query(sql, [cid])).rows; } catch (e) { return []; }
    };
    const companyR = await pool.query('SELECT * FROM companies WHERE id = $1', [cid]).catch(() => ({ rows: [] }));
    const data = {
      company: companyR.rows[0] || null,
      users: await rows('SELECT id, nume, email, tel, pozicio, blocked, created_at FROM users WHERE company_id = $1'),
      clients: await rows('SELECT * FROM clients WHERE company_id = $1'),
      vehicles: await rows('SELECT * FROM vehicles WHERE company_id = $1'),
      orders: await rows('SELECT * FROM orders WHERE company_id = $1'),
      carriers: await rows('SELECT * FROM carriers WHERE company_id = $1'),
      // Portál-belépők (személyes adat: e-mail/név) — jelszó-hash és invite-token KIZÁRVA.
      client_portal_users: await rows('SELECT id, client_id, email, nev, activ, last_login, created_at FROM client_users WHERE company_id = $1'),
      carrier_portal_users: await rows('SELECT id, carrier_id, email, nev, activ, last_login, created_at FROM carrier_users WHERE company_id = $1'),
    };
    audit.fromReq(req, 'gdpr.export', 'company', cid, { counts: {
      users: data.users.length, clients: data.clients.length, vehicles: data.vehicles.length, orders: data.orders.length,
      client_portal_users: data.client_portal_users.length, carrier_portal_users: data.carrier_portal_users.length,
    } });
    return res.json({ result: { ok: true, generated_at: new Date().toISOString(), data } });
  } catch (err) {
    console.error('exportCompanyData hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

handlers.anonymizeUser = async function (req, res, args) {
  try {
    if (!req.session.user || req.session.user.pozicio !== 'Admin') {
      return res.json({ result: { ok: false, err: 'Acces interzis' } });
    }
    const uid = parseInt(args && args[0], 10);
    if (!uid) return res.json({ result: { ok: false, err: 'ID-ul utilizatorului este obligatoriu.' } });
    const cid = req.session.user.company_id;
    if (uid === req.session.user.id) {
      return res.json({ result: { ok: false, err: 'Nu te poți anonimiza pe tine însuți.' } });
    }
    // PII törlése (nume/email/tel), tiltás. Developer NEM anonimizálható.
    // A historikus üzemeltetési hivatkozások (pl. fuvar-archívum) megmaradnak.
    const r = await pool.query(
      `UPDATE users
          SET nume = '(anonimizat)', email = $3, tel = NULL, blocked = true
        WHERE id = $1 AND company_id = $2 AND COALESCE(pozicio_dev, false) = false
        RETURNING id`,
      [uid, cid, 'deleted-' + uid + '@anonimizat.local']);
    if (!r.rowCount) {
      return res.json({ result: { ok: false, err: 'Utilizatorul nu a fost gasit sau nu poate fi anonimizat.' } });
    }
    audit.fromReq(req, 'gdpr.anonymize', 'user', uid);
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('anonymizeUser hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// ════════════════════════════════════════════════════════════
//  Adatvédelmi (GDPR) cég-beállítások + sofőr-tájékoztató visszaigazolás
// ════════════════════════════════════════════════════════════

// Admin/Manager olvashatja a cég adatvédelmi beállításait.
handlers.getGdprSettings = async function (req, res) {
  try {
    const u = req.session.user;
    if (!u || (u.pozicio !== 'Admin' && u.pozicio !== 'Manager')) {
      return res.json({ result: { ok: false, err: 'Acces interzis' } });
    }
    const r = await pool.query('SELECT privacy_notice, dpo_contact, gps_business_only, retention_note, updated_at FROM gdpr_settings WHERE company_id = $1', [u.company_id]);
    return res.json({ result: { ok: true, settings: r.rows[0] || null } });
  } catch (err) {
    console.error('getGdprSettings hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// Csak Admin mentheti a cég adatvédelmi beállításait.
handlers.saveGdprSettings = async function (req, res, args) {
  try {
    const u = req.session.user;
    if (!u || u.pozicio !== 'Admin') return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const f = (args && args[0]) || {};
    const notice = f.privacy_notice ? String(f.privacy_notice).slice(0, 8000) : null;
    const dpo = f.dpo_contact ? String(f.dpo_contact).slice(0, 500) : null;
    const ret = f.retention_note ? String(f.retention_note).slice(0, 2000) : null;
    const gpsBiz = !!f.gps_business_only;
    await pool.query(
      `INSERT INTO gdpr_settings (company_id, privacy_notice, dpo_contact, gps_business_only, retention_note, updated_at)
       VALUES ($1,$2,$3,$4,$5, now())
       ON CONFLICT (company_id) DO UPDATE
         SET privacy_notice = EXCLUDED.privacy_notice, dpo_contact = EXCLUDED.dpo_contact,
             gps_business_only = EXCLUDED.gps_business_only, retention_note = EXCLUDED.retention_note,
             updated_at = now()`,
      [u.company_id, notice, dpo, gpsBiz, ret]);
    audit.fromReq(req, 'gdpr.settings_save', 'company', u.company_id, { gps_business_only: gpsBiz });
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('saveGdprSettings hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// Bármely belépett felhasználó lekéri a saját cége adatvédelmi tájékoztatóját
// + hogy visszaigazolta-e már (a tájékoztató módosítása után újra kell).
handlers.getMyPrivacyNotice = async function (req, res) {
  try {
    const u = req.session.user;
    if (!u) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const s = await pool.query('SELECT privacy_notice, dpo_contact, gps_business_only, updated_at FROM gdpr_settings WHERE company_id = $1', [u.company_id]);
    const st = s.rows[0];
    if (!st || !st.privacy_notice) return res.json({ result: { ok: true, notice: null } });
    const c = await pool.query('SELECT acknowledged_at FROM gdpr_consents WHERE company_id = $1 AND user_id = $2 AND kind = $3', [u.company_id, u.id, 'privacy_notice']);
    const ack = c.rows[0] && new Date(c.rows[0].acknowledged_at) >= new Date(st.updated_at);
    return res.json({ result: { ok: true, notice: st.privacy_notice, dpo_contact: st.dpo_contact, gps_business_only: st.gps_business_only, acknowledged: !!ack } });
  } catch (err) {
    console.error('getMyPrivacyNotice hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// A felhasználó visszaigazolja a tájékoztató elolvasását (időbélyeg + IP, audit).
handlers.ackPrivacyNotice = async function (req, res) {
  try {
    const u = req.session.user;
    if (!u) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const rawIp = req.headers && (req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress));
    const ip = rawIp ? String(rawIp).split(',')[0].trim().slice(0, 64) : null;
    await pool.query(
      `INSERT INTO gdpr_consents (company_id, user_id, kind, acknowledged_at, ip)
       VALUES ($1,$2,$3, now(), $4)
       ON CONFLICT (company_id, user_id, kind) DO UPDATE SET acknowledged_at = now(), ip = EXCLUDED.ip`,
      [u.company_id, u.id, 'privacy_notice', ip]);
    audit.fromReq(req, 'gdpr.consent_ack', 'user', u.id);
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('ackPrivacyNotice hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

module.exports = handlers;
