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

module.exports = handlers;
