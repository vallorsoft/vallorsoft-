// ============================================================
//  VallorSoft — Auth route-ok: login / 2FA / jelszó-visszaállítás
//  Kivágva a régi server.js-ből, a kód-törzs változatlan.
// ============================================================
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const pool = require('../db');
const { requireLogin } = require('../middleware/auth');
const { sendResetEmail } = require('../services/email');

// 2FA (TOTP) — opcionális csomagok, ahogy az eredeti server.js-ben
let speakeasy = null, qrcode = null;
try { speakeasy = require('speakeasy'); } catch (e) { speakeasy = null; }
try { qrcode = require('qrcode'); } catch (e) { qrcode = null; }

router.post('/api/forgot-password', async (req, res) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    const genericMsg = { success: true, message: 'Dacă există un cont cu această adresă de email, am trimis linkul de resetare.' };
    if (!email) return res.json(genericMsg);

    const result = await pool.query(
      'SELECT u.id, u.nume, c.email_lang FROM users u LEFT JOIN companies c ON c.id = u.company_id WHERE u.email = $1', [email]);
    if (result.rows.length === 0) {
      return res.json(genericMsg); // nem letezik - de ugyanazt valaszoljuk (biztonsag)
    }
    const user = result.rows[0];
    const lang = user.email_lang === 'hu' ? 'hu' : 'ro';

    const token = crypto.randomBytes(32).toString('hex');
    const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1 ora

    await pool.query(
      'UPDATE users SET reset_token = $1, reset_token_expiry = $2 WHERE id = $3',
      [token, expiry, user.id]
    );

    const resetUrl = (process.env.APP_URL || 'http://localhost:3000') + '/reset-password?token=' + token;
    sendResetEmail(email, user.nume, resetUrl, lang).catch(e => console.error('Reset email hatter hiba:', e.message));

    return res.json(genericMsg);
  } catch (err) {
    console.error('Forgot password hiba:', err);
    return res.json({ success: false, message: 'Eroare de server. Încercați din nou mai târziu.' });
  }
});

// Uj jelszo beallitasa token-nel
router.post('/api/reset-password', async (req, res) => {
  try {
    const token = (req.body.token || '').trim();
    const newPassword = req.body.password || '';

    if (!token || !newPassword) {
      return res.json({ success: false, message: 'Date lipsă.' });
    }
    if (newPassword.length < 6) {
      return res.json({ success: false, message: 'Parola trebuie să aibă cel puțin 6 caractere.' });
    }

    const result = await pool.query(
      'SELECT id, reset_token_expiry FROM users WHERE reset_token = $1',
      [token]
    );
    if (result.rows.length === 0) {
      return res.json({ success: false, message: 'Link invalid sau deja folosit.' });
    }
    const user = result.rows[0];

    if (!user.reset_token_expiry || new Date(user.reset_token_expiry) < new Date()) {
      return res.json({ success: false, message: 'Linkul a expirat. Solicitați un nou link de resetare.' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await pool.query(
      'UPDATE users SET password_hash = $1, reset_token = NULL, reset_token_expiry = NULL WHERE id = $2',
      [passwordHash, user.id]
    );

    return res.json({ success: true, message: 'Parola a fost schimbată cu succes. Acum vă puteți autentifica.' });
  } catch (err) {
    console.error('Reset password hiba:', err);
    return res.json({ success: false, message: 'Eroare de server. Încercați din nou mai târziu.' });
  }
});

router.post('/api/login', async (req, res) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';

    if (!email || !password) {
      return res.json({ success: false, message: 'Emailul și parola sunt obligatorii!' });
    }

    const result = await pool.query(
      'SELECT id, nume, email, tel, pozicio, password_hash, company_id, pozicio_dev, totp_secret, totp_enabled, blocked FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      // Időzítés-kiegyenlítés: nem létező emailnél is fusson egy bcrypt-összehasonlítás,
      // hogy a válaszidőből ne lehessen fiókok létezésére következtetni.
      await bcrypt.compare(password, '$2b$10$C6UzMDM.H6dfI/f/IKcEeO7ZdVdkPYqBkN1FW3sZBPq4P5l5l5l5l');
      return res.json({ success: false, message: 'Email sau parolă incorectă!' });
    }

    const user = result.rows[0];
    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
      return res.json({ success: false, message: 'Email sau parolă incorectă!' });
    }

    // Tiltott felhasznalo (developer nem tilthato)
    if (user.blocked && !user.pozicio_dev) {
      return res.json({ success: false, message: 'Contul tău este blocat. Vă rugăm să contactați administratorul.' });
    }

    // Ceg ellenorzese (ha nem developer)
    if (!user.pozicio_dev && user.company_id) {
      const ceg = await pool.query('SELECT subscription_status, paid_until FROM companies WHERE id = $1', [user.company_id]);
      if (ceg.rows.length > 0) {
        const c = ceg.rows[0];
        if (c.subscription_status === 'inactive' || c.subscription_status === 'cancelled') {
          return res.json({ success: false, message: 'Abonamentul firmei a expirat sau a fost anulat. Vă rugăm să contactați administratorul.' });
        }
        if (c.paid_until && new Date(c.paid_until) < new Date()) {
          return res.json({ success: false, message: 'Abonamentul firmei a expirat (' + new Date(c.paid_until).toLocaleDateString('ro-RO') + '). Vă rugăm să achitați perioada următoare.' });
        }
      }
    }

    // ===== 2FA KAPU =====
    // A jelszo helyes. Most a 2FA allapot dont.
    // Atmeneti "pre-auth" session - csak a 2FA lepeshez
    if (speakeasy) {
      // ⚠️ IDEIGLENES: Sofer szerepkornél 2FA kihagyva (visszakapcsoláshoz töröld az && feltételt)
      if (user.totp_enabled && user.totp_secret && user.pozicio !== 'Sofer') {
        // 2FA be van kapcsolva -> kodot kerunk
        req.session.pendingUser = {
          id: user.id, nume: user.nume, email: user.email, tel: user.tel,
          pozicio: user.pozicio, company_id: user.company_id,
          is_dev: user.pozicio_dev || false,
        };
        return res.json({ success: true, need2fa: true });
      }
      // 2FA nincs beallitva vagy ki van kapcsolva -> egyenesen belep
      // Bekapcsolas onkentes, a Beallitasokbol (settings2faEnable)
    }

    // Ha speakeasy nincs telepitve, fallback a regi viselkedeshez
    req.session.user = {
      id: user.id,
      nume: user.nume,
      email: user.email,
      tel: user.tel,
      pozicio: user.pozicio,
      company_id: user.company_id,
      is_dev: user.pozicio_dev || false,
    };

    let redirect = '/sofer';
    if (user.pozicio_dev) redirect = '/developer';
    else if (user.pozicio === 'Admin') redirect = '/admin';
    else if (user.pozicio === 'Manager') redirect = '/manager';
    else if (user.pozicio === 'Konyvelo') redirect = '/konyvelo';

    return res.json({
      success: true,
      redirect: redirect,
      user: req.session.user,
    });

  } catch (err) {
    console.error('Login hiba:', err);
    return res.status(500).json({ success: false, message: 'Eroare de server' });
  }
});

// ===== 2FA: helper - redirect kiszamitasa =====
function calc2faRedirect(u) {
  if (u.is_dev) return '/developer';
  if (u.pozicio === 'Admin') return '/admin';
  if (u.pozicio === 'Manager') return '/manager';
  if (u.pozicio === 'Konyvelo') return '/konyvelo';
  return '/sofer';
}


// ===== 2FA SETTINGS-BŐL: QR generálás (már bejelentkezett user) =====
router.post('/api/2fa/settings-setup', requireLogin, async (req, res) => {
  try {
    if (!speakeasy || !qrcode) return res.json({ success: false, message: '2FA indisponibil' });
    const email = req.session.user.email;
    const secret = speakeasy.generateSecret({ name: 'VallorSoft (' + email + ')', length: 20 });
    req.session.pending2faSecret = secret.base32;
    const qrDataUrl = await qrcode.toDataURL(secret.otpauth_url);
    return res.json({ success: true, qr: qrDataUrl, secret: secret.base32 });
  } catch (err) {
    return res.json({ success: false, message: 'Eroare de server' });
  }
});

// ===== 2FA SETTINGS-BŐL: Megerősítés + bekapcsolás =====
router.post('/api/2fa/settings-verify', requireLogin, async (req, res) => {
  try {
    if (!speakeasy) return res.json({ success: false, message: '2FA indisponibil' });
    const token = (req.body.token || '').trim().replace(/\s/g, '');
    const secret = req.session.pending2faSecret;
    if (!secret) return res.json({ success: false, message: 'Nu există o configurare 2FA în curs. Reia de la început.' });
    const verified = speakeasy.totp.verify({ secret, encoding: 'base32', token, window: 2 });
    if (!verified) return res.json({ success: false, message: 'Cod incorect. Încearcă din nou.' });
    const backupCodes = [];
    for (let i = 0; i < 8; i++) backupCodes.push(crypto.randomBytes(4).toString('hex').toUpperCase());
    const hashedBackup = await Promise.all(backupCodes.map(c => bcrypt.hash(c, 8)));
    await pool.query(
      'UPDATE users SET totp_secret = $1, totp_enabled = TRUE, totp_backup_codes = $2 WHERE id = $3',
      [secret, JSON.stringify(hashedBackup), req.session.user.id]
    );
    delete req.session.pending2faSecret;
    return res.json({ success: true, backupCodes });
  } catch (err) {
    return res.json({ success: false, message: 'Eroare de server' });
  }
});

// ===== 2FA SETUP: QR kod generalas (pre-auth session-bol) =====
router.post('/api/2fa/setup', async (req, res) => {
  try {
    if (!speakeasy || !qrcode) return res.json({ success: false, message: '2FA indisponibil' });
    if (!req.session.pendingUser) return res.json({ success: false, message: 'Nu există o autentificare în curs' });

    const email = req.session.pendingUser.email;
    const secret = speakeasy.generateSecret({
      name: 'VallorSoft (' + email + ')',
      length: 20
    });

    // Ideiglenesen a pending session-be tesszuk, csak verify utan mentjuk DB-be
    req.session.pending2faSecret = secret.base32;

    const otpauthUrl = secret.otpauth_url;
    const qrDataUrl = await qrcode.toDataURL(otpauthUrl);

    return res.json({
      success: true,
      qr: qrDataUrl,
      secret: secret.base32  // manualis bevitelhez
    });
  } catch (err) {
    console.error('2fa setup hiba:', err);
    return res.json({ success: false, message: 'Eroare de server' });
  }
});

// ===== 2FA SETUP VERIFY: elso kod ellenorzese + mentes + bejelentkezes =====
router.post('/api/2fa/setup-verify', async (req, res) => {
  try {
    if (!speakeasy) return res.json({ success: false, message: '2FA indisponibil' });
    if (!req.session.pendingUser || !req.session.pending2faSecret) {
      return res.json({ success: false, message: 'Nu există o configurare 2FA în curs' });
    }
    const token = (req.body.token || '').trim().replace(/\s/g, '');
    const secret = req.session.pending2faSecret;

    const verified = speakeasy.totp.verify({
      secret: secret,
      encoding: 'base32',
      token: token,
      window: 2
    });

    if (!verified) {
      return res.json({ success: false, message: 'Cod incorect. Încearcă din nou.' });
    }

    // Backup kodok generalasa (8 db)
    const backupCodes = [];
    for (let i = 0; i < 8; i++) {
      backupCodes.push(crypto.randomBytes(4).toString('hex').toUpperCase());
    }
    const hashedBackup = await Promise.all(backupCodes.map(c => bcrypt.hash(c, 8)));

    // Mentes DB-be
    await pool.query(
      'UPDATE users SET totp_secret = $1, totp_enabled = TRUE, totp_backup_codes = $2 WHERE id = $3',
      [secret, JSON.stringify(hashedBackup), req.session.pendingUser.id]
    );

    // Bejelentkezes vegleges
    req.session.user = req.session.pendingUser;
    delete req.session.pendingUser;
    delete req.session.pending2faSecret;

    return res.json({
      success: true,
      redirect: calc2faRedirect(req.session.user),
      backupCodes: backupCodes  // egyszer megmutatjuk a usernek
    });
  } catch (err) {
    console.error('2fa setup-verify hiba:', err);
    return res.json({ success: false, message: 'Eroare de server' });
  }
});

// ===== 2FA LOGIN VERIFY: bejelentkezeskor a kod ellenorzese =====
router.post('/api/2fa/verify', async (req, res) => {
  try {
    if (!speakeasy) return res.json({ success: false, message: '2FA indisponibil' });
    if (!req.session.pendingUser) {
      return res.json({ success: false, message: 'Nu există o autentificare în curs' });
    }
    const token = (req.body.token || '').trim().replace(/\s/g, '');
    const userId = req.session.pendingUser.id;

    const r = await pool.query('SELECT totp_secret, totp_backup_codes FROM users WHERE id = $1', [userId]);
    if (!r.rows.length || !r.rows[0].totp_secret) {
      return res.json({ success: false, message: 'Eroare: 2FA nu este configurat' });
    }
    const secret = r.rows[0].totp_secret;

    let verified = speakeasy.totp.verify({
      secret: secret,
      encoding: 'base32',
      token: token,
      window: 2
    });

    // Ha a TOTP nem jo, probaljuk backup kodkent
    if (!verified && r.rows[0].totp_backup_codes) {
      try {
        const codes = typeof r.rows[0].totp_backup_codes === 'string'
          ? JSON.parse(r.rows[0].totp_backup_codes)
          : r.rows[0].totp_backup_codes;
        for (let i = 0; i < codes.length; i++) {
          if (codes[i] && await bcrypt.compare(token.toUpperCase(), codes[i])) {
            verified = true;
            // Felhasznalt backup kod torlese (null-ra)
            codes[i] = null;
            await pool.query('UPDATE users SET totp_backup_codes = $1 WHERE id = $2',
              [JSON.stringify(codes), userId]);
            break;
          }
        }
      } catch(e) {}
    }

    if (!verified) {
      return res.json({ success: false, message: 'Cod incorect.' });
    }

    // Sikeres -> vegleges bejelentkezes
    req.session.user = req.session.pendingUser;
    delete req.session.pendingUser;

    return res.json({
      success: true,
      redirect: calc2faRedirect(req.session.user)
    });
  } catch (err) {
    console.error('2fa verify hiba:', err);
    return res.json({ success: false, message: 'Eroare de server' });
  }
});

module.exports = router;
