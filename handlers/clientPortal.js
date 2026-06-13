// ============================================================
//  VallorSoft — handlers/clientPortal.js
//  Az ügyfél-portál HOZZÁFÉRÉSEINEK kezelése a fuvarozó (admin/manager)
//  oldaláról: kapcsolattartó meghívása (jelszó-beállító linkkel),
//  lista, le-/visszakapcsolás. RPC: /api/execute.
// ============================================================
const pool = require('../db');
const crypto = require('crypto');
const portal = require('../routes/portal');
const { emailLang } = require('../lib/companyLang');

const handlers = {};

const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// args: [clientId?] — a cég portál-hozzáférései (opcionálisan egy ügyfélre szűrve)
handlers.clientPortalList = async function (req, res, args) {
  try {
    if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
      return res.json({ result: { ok: false, err: 'Acces interzis' } });
    }
    const cid = req.session.user.company_id;
    const clientId = args && args[0] ? parseInt(args[0], 10) : null;
    const params = [cid];
    let where = 'cu.company_id = $1';
    if (clientId) { params.push(clientId); where += ' AND cu.client_id = $2'; }
    const r = await pool.query(
      `SELECT cu.id, cu.email, cu.nev, cu.activ, cu.last_login, cu.client_id,
              (cu.pass_hash IS NOT NULL) AS has_password,
              (cu.invite_token IS NOT NULL) AS pending_invite,
              c.nev AS client_nev
       FROM client_users cu
       JOIN clients c ON c.id = cu.client_id AND c.company_id = cu.company_id
       WHERE ${where}
       ORDER BY cu.created_at DESC`, params);
    return res.json({ result: { ok: true, items: r.rows } });
  } catch (err) {
    console.error('clientPortalList hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// args: [{ client_id, email, nev? }] — meghívó (vagy újra-meghívó) létrehozása
handlers.clientPortalInvite = async function (req, res, args) {
  try {
    if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
      return res.json({ result: { ok: false, err: 'Acces interzis' } });
    }
    const cid = req.session.user.company_id;
    const a = (args && args[0]) || {};
    const clientId = parseInt(a.client_id, 10);
    const email = String(a.email || '').trim().toLowerCase();
    const nev = a.nev ? String(a.nev).trim().slice(0, 120) : null;
    if (!clientId) return res.json({ result: { ok: false, err: 'Selectează un client.' } });
    if (!EMAIL_RE.test(email)) return res.json({ result: { ok: false, err: 'Adresă de e-mail invalidă.' } });

    // az ügyfél a saját cégé legyen
    const cl = await pool.query('SELECT id, nev FROM clients WHERE id = $1 AND company_id = $2', [clientId, cid]);
    if (!cl.rows.length) return res.json({ result: { ok: false, err: 'Clientul nu a fost găsit.' } });

    // foglalt-e az e-mail (globálisan egyedi)
    const ex = await pool.query('SELECT id, company_id FROM client_users WHERE LOWER(email) = $1', [email]);
    if (ex.rows.length && ex.rows[0].company_id !== cid) {
      return res.json({ result: { ok: false, err: 'Acest e-mail este deja înregistrat la alt transportator.' } });
    }

    const token = crypto.randomBytes(24).toString('hex');
    const expires = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    if (ex.rows.length) {
      await pool.query(
        `UPDATE client_users SET client_id = $1, nev = COALESCE($2, nev), invite_token = $3,
           invite_expires = $4, activ = TRUE WHERE id = $5`,
        [clientId, nev, token, expires, ex.rows[0].id]);
    } else {
      await pool.query(
        `INSERT INTO client_users (company_id, client_id, email, nev, invite_token, invite_expires)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [cid, clientId, email, nev, token, expires]);
    }

    const link = APP_URL + '/portal?token=' + token;
    let emailed = false;
    try { emailed = await portal._sendInvite(email, nev, link, await emailLang(cid)); } catch (_) { emailed = false; }
    return res.json({ result: { ok: true, link, emailed } });
  } catch (err) {
    console.error('clientPortalInvite hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// args: [id, activ(bool)] — hozzáférés le-/visszakapcsolása
handlers.clientPortalSetActive = async function (req, res, args) {
  try {
    if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
      return res.json({ result: { ok: false, err: 'Acces interzis' } });
    }
    const cid = req.session.user.company_id;
    const id = parseInt(args && args[0], 10);
    const activ = !!(args && args[1]);
    if (!id) return res.json({ result: { ok: false, err: 'ID-ul este obligatoriu.' } });
    const r = await pool.query(
      'UPDATE client_users SET activ = $1 WHERE id = $2 AND company_id = $3', [activ, id, cid]);
    if (!r.rowCount) return res.json({ result: { ok: false, err: 'Nu a fost găsit.' } });
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('clientPortalSetActive hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

module.exports = handlers;
