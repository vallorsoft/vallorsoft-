// ============================================================
//  VallorSoft — Nyilvános regisztráció (SaaS trial)
//  POST /api/public-register — nyílt végpont, nincs auth
//  GET  /api/public-plans    — előfizetési csomagok (nyílt)
//  GET  /api/me              — session-ellenőrzés (kliens-oldali)
// ============================================================
const express = require('express');
const bcrypt  = require('bcrypt');
const pool    = require('../db');
const { sendClientEmail, getEmailTemplate } = require('../services/email');

const router = express.Router();

// Rate-limit — opcionális (ha nincs express-rate-limit, simán fut tovább)
let rateLimit = null;
try { rateLimit = require('express-rate-limit'); } catch (e) { /* nincs telepítve */ }

const publicRegLimiter = rateLimit
  ? rateLimit({ windowMs: 60 * 60 * 1000, max: 3, standardHeaders: true, legacyHeaders: false,
      message: { ok: false, err: 'Prea multe cereri. Încercați mai târziu. / Túl sok kérés, próbálja később.' } })
  : (req, res, next) => next();

// ── POST /api/public-register ─────────────────────────────────
router.post('/api/public-register', publicRegLimiter, async (req, res) => {
  try {
    const { cegNev, email, jelszo, nume, tel } = req.body || {};

    // --- Validáció ---
    if (!cegNev || String(cegNev).trim().length < 2)
      return res.json({ ok: false, err: 'Numele companiei trebuie să aibă minim 2 caractere. / A cégnév min. 2 karakter.' });
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRe.test(String(email).trim()))
      return res.json({ ok: false, err: 'Adresă de e-mail invalidă. / Érvénytelen e-mail cím.' });
    if (!jelszo || String(jelszo).length < 6)
      return res.json({ ok: false, err: 'Parola trebuie să aibă minim 6 caractere. / A jelszónak min. 6 karakter kell.' });
    if (!nume || String(nume).trim().length < 1)
      return res.json({ ok: false, err: 'Numele este obligatoriu. / A név megadása kötelező.' });

    const cleanEmail = String(email).trim().toLowerCase();
    const cleanNume  = String(nume).trim();
    const cleanCeg   = String(cegNev).trim();
    const cleanTel   = tel ? String(tel).trim() : null;

    // --- E-mail egyediség ellenőrzés ---
    const exists = await pool.query('SELECT id FROM users WHERE email=$1', [cleanEmail]);
    if (exists.rows.length > 0)
      return res.json({ ok: false, err: 'Această adresă de e-mail este deja înregistrată. / Ez az e-mail már regisztrált.' });

    // --- Jelszó hash ---
    const hash = await bcrypt.hash(jelszo, 10);

    // --- DB tranzakció: cég + admin user ---
    const client = await pool.connect();
    let companyId;
    try {
      await client.query('BEGIN');

      // Cég létrehozása 14 napos trial-lal
      const cegRes = await client.query(
        `INSERT INTO companies (nev, subscription_status, paid_until, email_contact)
         VALUES ($1, 'trial', NOW() + INTERVAL '14 days', $2)
         RETURNING id`,
        [cleanCeg, cleanEmail]
      );
      companyId = cegRes.rows[0].id;

      // Admin user létrehozása
      await client.query(
        `INSERT INTO users (nume, email, tel, pozicio, password_hash, company_id)
         VALUES ($1, $2, $3, 'Admin', $4, $5)`,
        [cleanNume, cleanEmail, cleanTel, hash, companyId]
      );

      await client.query('COMMIT');
    } catch (dbErr) {
      await client.query('ROLLBACK');
      throw dbErr;
    } finally {
      client.release();
    }

    // --- Üdvözlő e-mail (best-effort, nem buktatja a regisztrációt) ---
    const appUrl = process.env.APP_URL || 'https://app.vallorsoft.com';
    try {
      // DB sablon felülírja a hardcoded szöveget, ha be van állítva
      const welcomeTpl = await getEmailTemplate('email_sys_welcome');
      let welcomeSubject, welcomeHtml;
      if (welcomeTpl && welcomeTpl.subject && (welcomeTpl.body_ro || welcomeTpl.body_hu)) {
        const escV = (s) => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
        const replVars = (t, v) => t.replace(/\{\{(\w+)\}\}/g, (_, k) => k in v ? escV(v[k]) : '');
        const vars = { ceg_nev: cleanCeg };
        const bodyRo = welcomeTpl.body_ro ? replVars(welcomeTpl.body_ro, vars) : '';
        const bodyHu = welcomeTpl.body_hu ? replVars(welcomeTpl.body_hu, vars) : '';
        welcomeSubject = replVars(welcomeTpl.subject, vars);
        welcomeHtml = bodyRo + (bodyHu && bodyRo ? '<hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0;">' : '') + bodyHu;
      } else {
        welcomeSubject = 'Bun venit la VallorSoft! / Üdvözöl a VallorSoft!';
        welcomeHtml = `
<div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#0f172a;">
  <div style="background:linear-gradient(135deg,#6366f1,#3b82f6);padding:28px 32px;border-radius:12px 12px 0 0;">
    <h1 style="margin:0;color:#fff;font-size:22px;">vallor<span style="color:#c7d2fe;">Soft</span></h1>
  </div>
  <div style="background:#fff;padding:28px 32px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;">
    <p style="margin:0 0 12px;font-size:16px;font-weight:600;">Bun venit, ${cleanNume}! / Üdvözlünk, ${cleanNume}!</p>
    <p style="margin:0 0 12px;color:#475569;">
      <strong>RO:</strong> Contul companiei <em>${cleanCeg}</em> a fost creat cu succes.
      Ai la dispoziție o perioadă de probă de <strong>14 zile</strong> — fără card bancar.
    </p>
    <p style="margin:0 0 20px;color:#475569;">
      <strong>HU:</strong> A(z) <em>${cleanCeg}</em> cég fiókja sikeresen létrejött.
      <strong>14 napos ingyenes próbaidőszak</strong> áll rendelkezésedre — bankkártya nélkül.
    </p>
    <a href="${appUrl}/admin" style="display:inline-block;background:linear-gradient(180deg,#3b82f6,#2563eb);color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;">
      🚀 Intră în aplicație / Belépés az alkalmazásba
    </a>
    <p style="margin:24px 0 0;font-size:12px;color:#94a3b8;">
      vallorsoft@gmail.com · <a href="${appUrl}/terms" style="color:#6366f1;">Termeni</a> · <a href="${appUrl}/privacy" style="color:#6366f1;">Confidențialitate</a>
    </p>
  </div>
</div>`;
      }
      await sendClientEmail({ to: cleanEmail, subject: welcomeSubject, html: welcomeHtml });
    } catch (mailErr) {
      console.warn('[public-register] Üdvözlő e-mail küldés sikertelen (best-effort):', mailErr.message);
    }

    console.log('[public-register] Új trial cég létrehozva: #' + companyId + ' — ' + cleanCeg + ' (' + cleanEmail + ')');
    return res.json({ ok: true, msg: 'Cont creat. Autentificați-vă. / Fiók létrehozva. Kérjük, jelentkezzen be.' });

  } catch (err) {
    console.error('[public-register] Hiba:', err.message);
    return res.json({ ok: false, err: 'Eroare de server. / Szerver hiba.' });
  }
});

// ── GET /api/public-plans — nyílt végpont (auth nélkül) ──────
router.get('/api/public-plans', async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT id, name, description, price_net, vat_percent, sort_order, features FROM subscription_plans WHERE is_active=true ORDER BY sort_order'
    );
    res.json({ ok: true, plans: r.rows });
  } catch (e) {
    console.error('[public-plans] Hiba:', e.message);
    res.json({ ok: false, plans: [] });
  }
});

// ── GET /api/me — session-ellenőrzés (kliensnek) ─────────────
router.get('/api/me', (req, res) => {
  if (req.session && req.session.user) {
    res.json({ ok: true, user: { pozicio: req.session.user.pozicio } });
  } else {
    res.json({ ok: false });
  }
});

module.exports = router;
