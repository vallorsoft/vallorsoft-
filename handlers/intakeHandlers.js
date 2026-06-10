// ============================================================
//  VallorSoft — handlers/intakeHandlers.js
//  Megrendelés e-mail fiók (IMAP) beállítása CÉGENKÉNT, a weboldalon.
//  Tárolás: company_integrations (provider='email_intake'),
//  a credentials AES-256-GCM-mel titkosítva (credentials_enc), SOHA nem
//  kerül vissza nyíltan a kliensre — csak maszkolt megjelenítési infó.
// ============================================================
const pool = require('../db');
const { encrypt, decrypt } = require('../lib/crypto');
const intake = require('../services/email-intake');

const handlers = {};

function isAdminOrDev(u) {
  return !!(u && (u.pozicio === 'Admin' || u.is_dev || u.pozicio === 'Developer'));
}
function argOf(args) { return Array.isArray(args) ? (args[0] || {}) : (args || {}); }

// "rendeles@cegem.com" -> "r***@cegem.com"
function maskEmail(email) {
  const s = String(email || '');
  const at = s.indexOf('@');
  if (at <= 0) return s ? (s[0] + '***') : '';
  return s[0] + '***' + s.slice(at);
}

function validEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim()); }

// A cég mentett (titkosított) e-mail intake credentials-e -> objektum (vagy null).
async function loadCreds(companyId) {
  const { rows } = await pool.query(
    `SELECT credentials_enc FROM company_integrations WHERE company_id=$1 AND provider='email_intake'`, [companyId]);
  if (!rows.length || !rows[0].credentials_enc) return null;
  try { return JSON.parse(decrypt(rows[0].credentials_enc)); } catch (_) { return null; }
}

// A beküldött args -> credentials objektum a tárolt szolgáltató-formátum szerint. Hibát dob, ha érvénytelen.
function buildCreds(a) {
  const provider = String(a.provider || '').trim().toLowerCase();
  if (['gmail', 'outlook', 'custom'].indexOf(provider) < 0) throw new Error('Ismeretlen szolgáltató.');
  const email = String(a.email || '').trim();
  if (!validEmail(email)) throw new Error('Érvénytelen e-mail cím.');
  const password = String(a.password || '');
  if (password.length < 6) throw new Error('A jelszó legalább 6 karakter legyen.');
  const mailbox = String(a.mailbox || 'INBOX').trim() || 'INBOX';

  if (provider === 'gmail') return { provider, email, app_password: password, mailbox };
  if (provider === 'outlook') return { provider, email, password, mailbox };
  // custom
  const host = String(a.host || '').trim();
  const port = parseInt(a.port, 10);
  if (!host) throw new Error('Egyedi IMAP esetén a szerver megadása kötelező.');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Érvénytelen port.');
  const tls = !(a.tls === false || String(a.tls) === 'false');
  return { provider, host, port, tls, email, password, mailbox };
}

// ─── Állapot lekérése (credentials NÉLKÜL) — Admin/Manager/Dev ───
handlers.getEmailIntakeConfig = async function (req, res, args) {
  try {
    const u = req.session.user;
    if (!u) return res.json({ result: { ok: false, err: 'Nincs bejelentkezve' } });
    const { rows } = await pool.query(
      `SELECT provider, enabled, meta, updated_at, last_check FROM company_integrations
       WHERE company_id=$1 AND provider='email_intake'`, [u.company_id]);
    if (!rows.length) return res.json({ result: { ok: true, configured: false } });
    const r = rows[0];
    const meta = r.meta || {};
    return res.json({ result: {
      ok: true, configured: true,
      provider: meta.provider || null,
      email: meta.email_masked || null,
      mailbox: meta.mailbox || 'INBOX',
      enabled: r.enabled !== false,
      configured_at: r.updated_at,
      since: meta.since || null,
      last_polled_at: r.last_check,
    } });
  } catch (err) {
    console.error('getEmailIntakeConfig hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
  }
};

// ─── Mentés (titkosítva) — csak Admin/Dev ───
handlers.saveEmailIntakeConfig = async function (req, res, args) {
  try {
    const u = req.session.user;
    if (!isAdminOrDev(u)) return res.json({ result: { ok: false, err: 'Csak Admin módosíthatja.' } });
    let creds;
    try { creds = buildCreds(argOf(args)); } catch (e) { return res.json({ result: { ok: false, err: e.message } }); }

    // Aktiválás időpontja: INNENTŐL dolgozza fel a beérkező leveleket (a korábbiakat nem).
    // Megőrizzük, ha már be volt állítva (szerkesztéskor nem nullázódik); új beállításnál = MOST.
    const prev = await pool.query(
      `SELECT meta FROM company_integrations WHERE company_id=$1 AND provider='email_intake'`, [u.company_id]);
    const prevSince = prev.rows[0] && prev.rows[0].meta && prev.rows[0].meta.since;
    const since = prevSince || new Date().toISOString();

    const enc = encrypt(JSON.stringify(creds));
    const meta = { provider: creds.provider, email_masked: maskEmail(creds.email), mailbox: creds.mailbox, since: since };
    await pool.query(
      `INSERT INTO company_integrations (company_id, provider, category, enabled, credentials_enc, meta, updated_at)
       VALUES ($1,'email_intake','intake',true,$2,$3,now())
       ON CONFLICT (company_id, provider)
       DO UPDATE SET credentials_enc=$2, meta=$3, enabled=true, updated_at=now()`,
      [u.company_id, enc, JSON.stringify(meta)]);
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('saveEmailIntakeConfig hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
  }
};

// ─── Kapcsolat tesztelése — Admin/Dev ───
// Ha az args tartalmaz jelszót, az ÉPP beírt adatokat teszteli (mentés előtt);
// különben a DB-ben tárolt credentials-t.
handlers.testEmailIntakeConfig = async function (req, res, args) {
  try {
    const u = req.session.user;
    if (!isAdminOrDev(u)) return res.json({ result: { ok: false, err: 'Csak Admin tesztelheti.' } });
    const a = argOf(args);
    let creds;
    if (a && a.password) {
      try { creds = buildCreds(a); } catch (e) { return res.json({ result: { ok: false, err: e.message } }); }
    } else {
      creds = await loadCreds(u.company_id);
      if (!creds) return res.json({ result: { ok: false, err: 'Nincs mentett beállítás. Add meg az adatokat és teszteld.' } });
    }
    try {
      const r = await intake.testConnection(creds);
      return res.json({ result: { ok: true, message: 'Kapcsolat sikeres! ' + (r.count || 0) + ' email található a postafiókban.' } });
    } catch (e) {
      return res.json({ result: { ok: false, err: 'Kapcsolódási hiba: ' + (e.message || 'ismeretlen') } });
    }
  } catch (err) {
    console.error('testEmailIntakeConfig hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
  }
};

// ─── Törlés — Admin/Dev ───
handlers.deleteEmailIntakeConfig = async function (req, res, args) {
  try {
    const u = req.session.user;
    if (!isAdminOrDev(u)) return res.json({ result: { ok: false, err: 'Csak Admin törölheti.' } });
    await pool.query(
      `DELETE FROM company_integrations WHERE company_id=$1 AND provider='email_intake'`, [u.company_id]);
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('deleteEmailIntakeConfig hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
  }
};

module.exports = handlers;
