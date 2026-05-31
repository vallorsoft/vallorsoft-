require('dotenv').config();

const express = require('express');
const path = require('path');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcrypt');
const cookieParser = require('cookie-parser');
const { Pool } = require('pg');
const crypto = require('crypto');

// ===== BIZTONSAG: helmet + rate-limit =====
let helmet, rateLimit;
try { helmet = require('helmet'); } catch(e) { helmet = null; console.warn('helmet nincs telepitve'); }
try { rateLimit = require('express-rate-limit'); } catch(e) { rateLimit = null; console.warn('express-rate-limit nincs telepitve'); }

// 2FA (TOTP)
let speakeasy = null, qrcode = null;
try { speakeasy = require('speakeasy'); } catch(e) { speakeasy = null; console.warn('speakeasy nincs telepitve - 2FA nem mukodik'); }
try { qrcode = require('qrcode'); } catch(e) { qrcode = null; console.warn('qrcode nincs telepitve'); }

// Firebase Admin SDK (custom token a chat hitelesiteshez)
let fbAdmin = null;
try {
  fbAdmin = require('firebase-admin');
  if (process.env.FIREBASE_SERVICE_ACCOUNT && !fbAdmin.apps.length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    fbAdmin.initializeApp({
      credential: fbAdmin.credential.cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DB_URL
    });
    console.log('Firebase Admin inicializalva');
  } else if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    console.warn('FIREBASE_SERVICE_ACCOUNT hianyzik - Firebase custom token nem mukodik');
    fbAdmin = null;
  }
} catch(e) {
  fbAdmin = null;
  console.warn('firebase-admin nincs telepitve');
}

// Web Push
let webpush = null;
try {
  webpush = require('web-push');
  const vapidPublic  = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  const vapidEmail   = process.env.VAPID_EMAIL || ('mailto:' + (process.env.BREVO_SENDER || 'admin@vallorsoft.hu'));
  if (vapidPublic && vapidPrivate) {
    webpush.setVapidDetails(vapidEmail, vapidPublic, vapidPrivate);
    console.log('Web Push VAPID beallitva');
  } else {
    console.warn('VAPID kulcsok hianyzanak - push ertesitesek nem mukodnek');
    webpush = null;
  }
} catch(e) {
  webpush = null;
  console.warn('web-push nincs telepitve');
}
// ===== EMAIL KULDES: Brevo HTTP API (port 443, Render NEM blokkolja) =====
// Az SMTP (587/465) NEM mukodik Render ingyenes csomagon -> HTTP API kell.
// Brevo ingyenes 300 email/nap. Domain NEM kell, csak felado-cim hitelesites.
// Render env: BREVO_API_KEY=xkeysib-...   BREVO_SENDER=vallorteam.office@gmail.com
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const BREVO_SENDER  = process.env.BREVO_SENDER || process.env.MAIL_USER;

console.log('BREVO ready:', !!BREVO_API_KEY, '| sender:', BREVO_SENDER);

async function sendInviteEmail(toEmail, kod, pozicio, cegNev, igazgatoNev) {
  console.log('sendInviteEmail called:', toEmail, !!BREVO_API_KEY);
  if (!BREVO_API_KEY || !BREVO_SENDER || !toEmail) {
    console.log('early return - BREVO_API_KEY, BREVO_SENDER vagy toEmail hianyzik');
    return;
  }
  const registerUrl = process.env.APP_URL || 'http://localhost:3000';
  const udvozles = igazgatoNev ? `Tisztelt ${igazgatoNev}!` : 'Tisztelt Partnerünk!';
  const html = `
        <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;background:#05070b;color:#e9eef5;padding:32px;border-radius:16px;">
          <div style="font-size:24px;font-weight:800;margin-bottom:4px;">
            <span style="color:#fff;">vallor</span><span style="color:#e10b1a;">Soft</span>
          </div>
          <div style="font-size:12px;color:#8a97a8;margin-bottom:28px;">Fuvarmenedzsment Platform</div>
          <h2 style="font-size:20px;margin-bottom:8px;">${udvozles}</h2>
          <p style="color:#8a97a8;margin-bottom:16px;">
            A <b style="color:#fff;">VallorSoft</b> cégtől kapta ezt az emailt, előfizetésére vonatkozó meghívóval.
          </p>
          <p style="color:#8a97a8;margin-bottom:24px;">
            ${cegNev ? `A <b style="color:#fff;">${cegNev}</b> cég számára` : 'Az Ön számára'} aktiválva lett a VallorSoft platform hozzáférés <b style="color:#fff;">${pozicio}</b> szerepkörben.
          </p>
          <div style="background:#141c25;border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:20px;margin-bottom:24px;text-align:center;">
            <div style="font-size:12px;color:#8a97a8;margin-bottom:8px;text-transform:uppercase;letter-spacing:1px;">Meghívókódja</div>
            <div style="font-size:32px;font-weight:800;letter-spacing:4px;color:#fff;">${kod}</div>
          </div>
          <div style="background:#141c25;border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:20px;margin-bottom:24px;">
            <div style="font-size:13px;font-weight:700;color:#fff;margin-bottom:12px;">📋 Regisztráció lépései:</div>
            <ol style="color:#8a97a8;font-size:13px;line-height:1.8;padding-left:20px;margin:0;">
              <li>Nyissa meg: <a href="${registerUrl}/register" style="color:#3b82f6;">${registerUrl}/register</a></li>
              <li>Adja meg a nevét, email címét és egy jelszót</li>
              <li>A meghívókód mezőbe írja be: <b style="color:#fff;">${kod}</b></li>
              <li>Kattintson a <b style="color:#fff;">Regisztráció</b> gombra</li>
              <li>Ezután bejelentkezhet a <a href="${registerUrl}/login" style="color:#3b82f6;">${registerUrl}/login</a> oldalon</li>
            </ol>
          </div>
          <p style="font-size:11px;color:#8a97a8;margin:0;">Ez az email automatikusan lett elküldve a VallorSoft rendszer által. Ha nem várta ezt az üzenetet, kérjük hagyja figyelmen kívül.</p>
        </div>
      `;
  try {
    const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': BREVO_API_KEY,
        'Content-Type': 'application/json',
        'accept': 'application/json',
      },
      body: JSON.stringify({
        sender: { name: 'VallorSoft', email: BREVO_SENDER },
        to: [{ email: toEmail }],
        subject: `VallorSoft — Meghívó (${cegNev || 'VallorSoft'})`,
        htmlContent: html,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      console.error('Brevo hiba:', resp.status, JSON.stringify(data));
    } else {
      console.log('Email elkulve, messageId:', data.messageId);
    }
  } catch (err) {
    console.error('Email kuldesi hiba:', err.message);
  }
}

// ============ JELSZO-VISSZAALLITO EMAIL ============
async function sendResetEmail(toEmail, nume, resetUrl) {
  console.log('sendResetEmail called:', toEmail, !!BREVO_API_KEY);
  if (!BREVO_API_KEY || !BREVO_SENDER || !toEmail) {
    console.log('early return - BREVO config vagy toEmail hianyzik');
    return;
  }
  const udvozles = nume ? `Tisztelt ${nume}!` : 'Tisztelt Felhasználónk!';
  const html = `
        <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;background:#05070b;color:#e9eef5;padding:32px;border-radius:16px;">
          <div style="font-size:24px;font-weight:800;margin-bottom:4px;">
            <span style="color:#fff;">vallor</span><span style="color:#e10b1a;">Soft</span>
          </div>
          <div style="font-size:12px;color:#8a97a8;margin-bottom:28px;">Fuvarmenedzsment Platform</div>
          <h2 style="font-size:20px;margin-bottom:8px;">${udvozles}</h2>
          <p style="color:#8a97a8;margin-bottom:16px;">
            Jelszó-visszaállítási kérelmet kaptunk a fiókjához. Ha Ön kérte, kattintson az alábbi gombra egy új jelszó beállításához.
          </p>
          <div style="text-align:center;margin:28px 0;">
            <a href="${resetUrl}" style="display:inline-block;background:#e10b1a;color:#fff;text-decoration:none;font-weight:700;padding:14px 32px;border-radius:10px;font-size:15px;">Új jelszó beállítása</a>
          </div>
          <p style="color:#8a97a8;font-size:13px;margin-bottom:8px;">Vagy másolja be ezt a linket a böngészőbe:</p>
          <p style="word-break:break-all;font-size:12px;color:#3b82f6;margin-bottom:24px;">${resetUrl}</p>
          <div style="background:#141c25;border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:16px;margin-bottom:24px;">
            <p style="font-size:12px;color:#8a97a8;margin:0;">⏱️ Ez a link <b style="color:#fff;">1 óráig</b> érvényes. Ha nem Ön kérte a visszaállítást, hagyja figyelmen kívül ezt az emailt — a jelszava változatlan marad.</p>
          </div>
          <p style="font-size:11px;color:#8a97a8;margin:0;">Ez az email automatikusan lett elküldve a VallorSoft rendszer által.</p>
        </div>
      `;
  try {
    const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': BREVO_API_KEY,
        'Content-Type': 'application/json',
        'accept': 'application/json',
      },
      body: JSON.stringify({
        sender: { name: 'VallorSoft', email: BREVO_SENDER },
        to: [{ email: toEmail }],
        subject: 'VallorSoft — Jelszó visszaállítás',
        htmlContent: html,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      console.error('Reset email Brevo hiba:', resp.status, JSON.stringify(data));
    } else {
      console.log('Reset email elkulve, messageId:', data.messageId);
    }
  } catch (err) {
    console.error('Reset email hiba:', err.message);
  }
}

// Adatbazis kapcsolat (a .env-bol)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const app = express();
app.set('trust proxy', 1); // Render / reverse proxy mogotti HTTPS session fix

// ===== HELMET: HTTP biztonsagi fejlecek =====
if (helmet) {
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'", "'unsafe-inline'",
          "https://cdnjs.cloudflare.com",
          "https://cdn.jsdelivr.net",
          "https://*.gstatic.com",
          "https://*.googleapis.com",
          "https://*.firebaseio.com",
          "https://*.firebase.com",
          "https://*.firebaseapp.com",
        ],
        scriptSrcElem: [
          "'self'", "'unsafe-inline'",
          "https://cdnjs.cloudflare.com",
          "https://cdn.jsdelivr.net",
          "https://*.gstatic.com",
          "https://*.googleapis.com",
          "https://*.firebaseio.com",
          "https://*.firebase.com",
          "https://*.firebaseapp.com",
        ],
        scriptSrcAttr: ["'unsafe-inline'"], // inline onclick/onchange (helmet default 'none' felulirasa)
        workerSrc: ["'self'", "blob:"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        connectSrc: [
          "'self'",
          "https://*.firebaseio.com",
          "https://*.firebase.com",
          "https://*.firebaseapp.com",
          "https://*.googleapis.com",
          "wss://*.firebaseio.com",
          "https://api.brevo.com",
        ],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    crossOriginEmbedderPolicy: false, // Firebase miatt ki kell kapcsolni
    hsts: {
      maxAge: 63072000,
      includeSubDomains: true,
      preload: true,
    },
    noSniff: true,
    xssFilter: true,
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  }));
}

// ===== RATE LIMITING: brute-force vedelem =====
if (rateLimit) {
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 perc
    max: 10,
    message: { success: false, message: 'Tul sok bejelentkezesi kiserletes. Probald ujra 15 perc mulva.' },
    standardHeaders: true,
    legacyHeaders: false,
  });
  const forgotLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 ora
    max: 5,
    message: { success: false, message: 'Tul sok jelszo-visszaallitasi kerelem. Probald ujra 1 ora mulva.' },
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api/login', loginLimiter);
  app.use('/api/forgot-password', forgotLimiter);
}

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Statikus fajlok CSAK a nem-vedett eleresi utakra (public mappan belul a HTML fajlok
// nem szolgalhatoak ki kozvetlenul - a route-ok vedelme lejjebb tortenik)
app.use(express.static(path.join(__dirname, 'public')));

// Cookie es session kezeles
app.use(cookieParser());

app.use(session({
  store: new pgSession({
    pool: pool,
    tableName: 'session',
    createTableIfMissing: true,
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 nap
  },
}));

// Middleware: csak bejelentkezett user-t enged tovabb
function requireLogin(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ success: false, message: 'Nincs bejelentkezve' });
  }
  next();
}

// Middleware: csak adott szerepkort enged tovabb
function requireRole(...roles) {
  return function(req, res, next) {
    if (!req.session || !req.session.user) {
      return res.status(401).json({ success: false, message: 'Nincs bejelentkezve' });
    }
    if (!roles.includes(req.session.user.pozicio)) {
      return res.status(403).json({ success: false, message: 'Nincs jogosultsag' });
    }
    next();
  };
}

const getNowStr = () => new Date().toISOString().replace('T', ' ').substring(0, 19);

// Firebase konfig endpoint — szerepkor alapjan szurt
app.get('/api/firebase-config', requireLogin, (req, res) => {
  const pozicio = req.session.user.pozicio;
  const isDev = req.session.user.is_dev;
  // Minden bejelentkezett user kap config-ot (chat mindenkinek kell)
  // de csak HTTPS-rol, session utan
  if (!['Admin', 'Manager', 'Sofer'].includes(pozicio) && !isDev) {
    return res.status(403).json({ error: 'Nincs jogosultsag' });
  }
  res.json({
    apiKey:        process.env.FIREBASE_API_KEY        || null,
    authDomain:    process.env.FIREBASE_AUTH_DOMAIN    || null,
    databaseURL:   process.env.FIREBASE_DB_URL         || null,
    projectId:     process.env.FIREBASE_PROJECT_ID     || null,
    appId:         process.env.FIREBASE_APP_ID         || null,
  });
});

// Firebase Custom Token - a chat hitelesiteshez (company_id custom claim)
app.get('/api/firebase-token', requireLogin, async (req, res) => {
  try {
    if (!fbAdmin) return res.json({ ok: false, err: 'Firebase Admin nincs konfiguralva' });
    const uid = 'user_' + req.session.user.id;
    const customToken = await fbAdmin.auth().createCustomToken(uid, {
      company_id: String(req.session.user.company_id || 'global'),
      email:      req.session.user.email,
      pozicio:    req.session.user.pozicio
    });
    res.json({ ok: true, token: customToken });
  } catch (err) {
    console.error('firebase-token hiba:', err);
    res.json({ ok: false, err: 'Szerver hiba' });
  }
});



// ===== HTML OLDALAK — szerver oldali jogosultsag-ellenorzes =====
// Ha nincs session -> redirect /login
// Ha rossz szerepkor -> redirect sajat oldalara

function requirePageLogin(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.redirect('/login');
  }
  next();
}

function requirePageRole(...roles) {
  return function(req, res, next) {
    if (!req.session || !req.session.user) {
      return res.redirect('/login');
    }
    if (!roles.includes(req.session.user.pozicio) && !req.session.user.is_dev) {
      // Helyes oldalra kuldjuk vissza
      const p = req.session.user.pozicio;
      if (p === 'Admin') return res.redirect('/admin');
      if (p === 'Manager') return res.redirect('/manager');
      return res.redirect('/sofer');
    }
    next();
  };
}

app.get('/', (req, res) => {
  if (req.session && req.session.user) {
    const p = req.session.user.pozicio;
    if (req.session.user.is_dev) return res.redirect('/developer');
    if (p === 'Admin') return res.redirect('/admin');
    if (p === 'Manager') return res.redirect('/manager');
    return res.redirect('/sofer');
  }
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});
app.get('/login', (req, res) => {
  if (req.session && req.session.user) {
    const p = req.session.user.pozicio;
    if (req.session.user.is_dev) return res.redirect('/developer');
    if (p === 'Admin') return res.redirect('/admin');
    if (p === 'Manager') return res.redirect('/manager');
    return res.redirect('/sofer');
  }
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'public', 'register.html')));
app.get('/reset-password', (req, res) => res.sendFile(path.join(__dirname, 'public', 'reset-password.html')));

// Elfelejtett jelszo - visszaallito link kerese
app.post('/api/forgot-password', async (req, res) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    const genericMsg = { success: true, message: 'Ha létezik fiók ezzel az email címmel, elküldtük a visszaállítási linket.' };
    if (!email) return res.json(genericMsg);

    const result = await pool.query('SELECT id, nume FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.json(genericMsg); // nem letezik - de ugyanazt valaszoljuk (biztonsag)
    }
    const user = result.rows[0];

    const token = crypto.randomBytes(32).toString('hex');
    const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1 ora

    await pool.query(
      'UPDATE users SET reset_token = $1, reset_token_expiry = $2 WHERE id = $3',
      [token, expiry, user.id]
    );

    const resetUrl = (process.env.APP_URL || 'http://localhost:3000') + '/reset-password?token=' + token;
    sendResetEmail(email, user.nume, resetUrl).catch(e => console.error('Reset email hatter hiba:', e.message));

    return res.json(genericMsg);
  } catch (err) {
    console.error('Forgot password hiba:', err);
    return res.json({ success: false, message: 'Szerver hiba. Próbálja újra később.' });
  }
});

// Uj jelszo beallitasa token-nel
app.post('/api/reset-password', async (req, res) => {
  try {
    const token = (req.body.token || '').trim();
    const newPassword = req.body.password || '';

    if (!token || !newPassword) {
      return res.json({ success: false, message: 'Hiányzó adatok.' });
    }
    if (newPassword.length < 6) {
      return res.json({ success: false, message: 'A jelszó legalább 6 karakter legyen.' });
    }

    const result = await pool.query(
      'SELECT id, reset_token_expiry FROM users WHERE reset_token = $1',
      [token]
    );
    if (result.rows.length === 0) {
      return res.json({ success: false, message: 'Érvénytelen vagy már felhasznált link.' });
    }
    const user = result.rows[0];

    if (!user.reset_token_expiry || new Date(user.reset_token_expiry) < new Date()) {
      return res.json({ success: false, message: 'A link lejárt. Kérjen új visszaállítási linket.' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await pool.query(
      'UPDATE users SET password_hash = $1, reset_token = NULL, reset_token_expiry = NULL WHERE id = $2',
      [passwordHash, user.id]
    );

    return res.json({ success: true, message: 'Jelszó sikeresen megváltoztatva. Most már bejelentkezhet.' });
  } catch (err) {
    console.error('Reset password hiba:', err);
    return res.json({ success: false, message: 'Szerver hiba. Próbálja újra később.' });
  }
});

app.get('/developer', requirePageLogin, function(req, res) {
  if (!req.session.user.is_dev) return res.redirect('/login');
  res.sendFile(path.join(__dirname, 'public', 'developer.html'));
});
app.get('/admin', requirePageLogin, requirePageRole('Admin'), function(req, res) {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
app.get('/manager', requirePageLogin, requirePageRole('Manager', 'Admin'), function(req, res) {
  res.sendFile(path.join(__dirname, 'public', 'manager.html'));
});
app.get('/sofer', requirePageLogin, requirePageRole('Sofer', 'Admin', 'Manager'), function(req, res) {
  res.sendFile(path.join(__dirname, 'public', 'sofer.html'));
});

// LOGIN (DB-bol, bcrypt-tel, session-nel)
app.post('/api/login', async (req, res) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';

    if (!email || !password) {
      return res.json({ success: false, message: 'Email es jelszo kotelezo!' });
    }

    const result = await pool.query(
      'SELECT id, nume, email, tel, pozicio, password_hash, company_id, pozicio_dev, totp_secret, totp_enabled FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.json({ success: false, message: 'Hibas email vagy jelszo!' });
    }

    const user = result.rows[0];
    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
      return res.json({ success: false, message: 'Hibas email vagy jelszo!' });
    }

    // Ceg ellenorzese (ha nem developer)
    if (!user.pozicio_dev && user.company_id) {
      const ceg = await pool.query('SELECT subscription_status, paid_until FROM companies WHERE id = $1', [user.company_id]);
      if (ceg.rows.length > 0) {
        const c = ceg.rows[0];
        if (c.subscription_status === 'inactive' || c.subscription_status === 'cancelled') {
          return res.json({ success: false, message: 'A cég előfizetése lejárt vagy törölve lett. Kérjük vegye fel a kapcsolatot az adminisztrátorral.' });
        }
        if (c.paid_until && new Date(c.paid_until) < new Date()) {
          return res.json({ success: false, message: 'A cég előfizetése lejárt (' + new Date(c.paid_until).toLocaleDateString('hu-HU') + '). Kérjük fizesse meg a következő időszakot.' });
        }
      }
    }

    // ===== 2FA KAPU =====
    // A jelszo helyes. Most a 2FA allapot dont.
    // Atmeneti "pre-auth" session - csak a 2FA lepeshez
    if (speakeasy) {
      if (user.totp_enabled && user.totp_secret) {
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

    return res.json({
      success: true,
      redirect: redirect,
      user: req.session.user,
    });

  } catch (err) {
    console.error('Login hiba:', err);
    return res.status(500).json({ success: false, message: 'Szerver hiba' });
  }
});

// ===== 2FA: helper - redirect kiszamitasa =====
function calc2faRedirect(u) {
  if (u.is_dev) return '/developer';
  if (u.pozicio === 'Admin') return '/admin';
  if (u.pozicio === 'Manager') return '/manager';
  return '/sofer';
}


// ===== 2FA SETTINGS-BŐL: QR generálás (már bejelentkezett user) =====
app.post('/api/2fa/settings-setup', requireLogin, async (req, res) => {
  try {
    if (!speakeasy || !qrcode) return res.json({ success: false, message: '2FA nem elérhető' });
    const email = req.session.user.email;
    const secret = speakeasy.generateSecret({ name: 'VallorSoft (' + email + ')', length: 20 });
    req.session.pending2faSecret = secret.base32;
    const qrDataUrl = await qrcode.toDataURL(secret.otpauth_url);
    return res.json({ success: true, qr: qrDataUrl, secret: secret.base32 });
  } catch (err) {
    return res.json({ success: false, message: 'Szerver hiba' });
  }
});

// ===== 2FA SETTINGS-BŐL: Megerősítés + bekapcsolás =====
app.post('/api/2fa/settings-verify', requireLogin, async (req, res) => {
  try {
    if (!speakeasy) return res.json({ success: false, message: '2FA nem elérhető' });
    const token = (req.body.token || '').trim().replace(/\s/g, '');
    const secret = req.session.pending2faSecret;
    if (!secret) return res.json({ success: false, message: 'Nincs folyamatban 2FA beállítás. Kezdd újra.' });
    const verified = speakeasy.totp.verify({ secret, encoding: 'base32', token, window: 2 });
    if (!verified) return res.json({ success: false, message: 'Helytelen kód. Próbáld újra.' });
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
    return res.json({ success: false, message: 'Szerver hiba' });
  }
});

// ===== 2FA SETUP: QR kod generalas (pre-auth session-bol) =====
app.post('/api/2fa/setup', async (req, res) => {
  try {
    if (!speakeasy || !qrcode) return res.json({ success: false, message: '2FA nem elerheto' });
    if (!req.session.pendingUser) return res.json({ success: false, message: 'Nincs folyamatban bejelentkezes' });

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
    return res.json({ success: false, message: 'Szerver hiba' });
  }
});

// ===== 2FA SETUP VERIFY: elso kod ellenorzese + mentes + bejelentkezes =====
app.post('/api/2fa/setup-verify', async (req, res) => {
  try {
    if (!speakeasy) return res.json({ success: false, message: '2FA nem elerheto' });
    if (!req.session.pendingUser || !req.session.pending2faSecret) {
      return res.json({ success: false, message: 'Nincs folyamatban 2FA beallitas' });
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
      return res.json({ success: false, message: 'Helytelen kod. Probald ujra.' });
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
    return res.json({ success: false, message: 'Szerver hiba' });
  }
});

// ===== 2FA LOGIN VERIFY: bejelentkezeskor a kod ellenorzese =====
app.post('/api/2fa/verify', async (req, res) => {
  try {
    if (!speakeasy) return res.json({ success: false, message: '2FA nem elerheto' });
    if (!req.session.pendingUser) {
      return res.json({ success: false, message: 'Nincs folyamatban bejelentkezes' });
    }
    const token = (req.body.token || '').trim().replace(/\s/g, '');
    const userId = req.session.pendingUser.id;

    const r = await pool.query('SELECT totp_secret, totp_backup_codes FROM users WHERE id = $1', [userId]);
    if (!r.rows.length || !r.rows[0].totp_secret) {
      return res.json({ success: false, message: 'Hiba: nincs 2FA beallitva' });
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
      return res.json({ success: false, message: 'Helytelen kod.' });
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
    return res.json({ success: false, message: 'Szerver hiba' });
  }
});

// SOFER FUNKCIOK (DB-alapu)
app.post('/api/border-cross', async (req, res) => {
  try {
    if (!req.session.user) return res.json({ success: false, err: 'Nincs bejelentkezve' });
    const { tip, tara, locatie, gps_lat, gps_lng } = req.body;
    await pool.query(
      `INSERT INTO border_crossings (email_sofer, nume_sofer, tip, tara, locatie, gps_lat, gps_lng)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        req.session.user.email,
        req.session.user.nume,
        tip || 'Iesire',
        tara || null,
        locatie || null,
        gps_lat ? parseFloat(gps_lat) : null,
        gps_lng ? parseFloat(gps_lng) : null
      ]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('border-cross hiba:', err);
    res.json({ success: false, err: 'Szerver hiba' });
  }
});


// ============================================================
//  DIURNA KALKULATOR
// ============================================================
function calculateDiurna(crossings) {
  if (!crossings || !crossings.length) return { externDays:0, internDays:0, crossingLog:[] };
  const dayMin = {};
  let lastOut = null;
  for (const c of crossings) {
    const ts = new Date(c.crossed_at);
    if (c.direction === 'OUT') {
      lastOut = ts;
    } else if (c.direction === 'IN' && lastOut) {
      let cur = new Date(lastOut);
      while (cur < ts) {
        const dk = cur.toISOString().slice(0,10);
        const nextDay = new Date(dk); nextDay.setDate(nextDay.getDate()+1);
        const end = ts < nextDay ? ts : nextDay;
        dayMin[dk] = (dayMin[dk]||0) + Math.floor((end-cur)/60000);
        cur = end;
      }
      lastOut = null;
    }
  }
  let externDays=0, internDays=0;
  const crossingLog = Object.entries(dayMin).sort().map(([day,min]) => {
    const hours = +(min/60).toFixed(2);
    const type = hours>=12 ? 'EXTERN' : 'INTERN';
    if (type==='EXTERN') externDays++; else internDays++;
    return {day, minutes:min, hours, type};
  });
  return {externDays, internDays, crossingLog};
}

app.get('/api/diurna-stats', requireLogin, requireRole('Manager','Admin'), async (req,res) => {
  const cid = req.session.user.company_id;
  try {
    const sofors = await pool.query(`SELECT id, nume, email FROM users WHERE company_id=$1 AND pozicio='Sofer' ORDER BY nume`, [cid]);
    const result = [];
    for (const s of sofors.rows) {
      const cr = await pool.query(`SELECT direction, crossed_at FROM border_crossings WHERE email_sofer=$1 ORDER BY crossed_at ASC`, [s.email]);
      const d = calculateDiurna(cr.rows);
      result.push({ driver_id:s.id, nume:s.nume, email:s.email, externDays:d.externDays, internDays:d.internDays, crossingLog:d.crossingLog });
    }
    return res.json({ ok:true, data:result });
  } catch(err) { return res.json({ ok:false }); }
});

app.get('/api/document-series', requireLogin, requireRole('Manager','Admin'), async (req,res) => {
  const cid = req.session.user.company_id;
  const docType = (req.query.type||'MT').toUpperCase();
  const year = new Date().getFullYear();
  try {
    const r = await pool.query(`SELECT prefix, current_seq FROM document_series WHERE company_id=$1 AND doc_type=$2 AND year=$3`, [cid,docType,year]);
    return res.json({ ok:true, prefix: r.rows[0]?.prefix||docType, currentSeq: r.rows[0]?.current_seq||0 });
  } catch(err) { return res.json({ok:false}); }
});

app.post('/api/document-series', requireLogin, requireRole('Manager','Admin'), async (req,res) => {
  const cid = req.session.user.company_id;
  const { docType='MT', prefix } = req.body;
  const year = new Date().getFullYear();
  if (!prefix) return res.json({ok:false, err:'Prefix kötelező.'});
  try {
    await pool.query(`INSERT INTO document_series (company_id,doc_type,prefix,year,current_seq) VALUES ($1,$2,$3,$4,0) ON CONFLICT (company_id,doc_type,year) DO UPDATE SET prefix=$3, current_seq=0, updated_at=NOW()`, [cid, docType.toUpperCase(), prefix.toUpperCase(), year]);
    return res.json({ok:true});
  } catch(err) { return res.json({ok:false}); }
});

app.post('/api/document-series/next', requireLogin, async (req,res) => {
  const cid = req.session.user.company_id;
  const docType = ((req.body&&req.body.docType)||'MT').toUpperCase();
  const year = new Date().getFullYear();
  try {
    const r = await pool.query(`INSERT INTO document_series (company_id,doc_type,prefix,year,current_seq) VALUES ($1,$2,$2,$3,1) ON CONFLICT (company_id,doc_type,year) DO UPDATE SET current_seq=document_series.current_seq+1, updated_at=NOW() RETURNING prefix, current_seq`, [cid, docType, year]);
    const {prefix, current_seq} = r.rows[0];
    const docNumber = `${prefix}-${year}-${String(current_seq).padStart(4,'0')}`;
    return res.json({ok:true, docNumber, seq:current_seq});
  } catch(err) { return res.json({ok:false}); }
});

app.post('/api/fuvarlevel-save', async (req, res) => {
  try {
    if (!req.session.user) return res.json({ success: false, err: 'Nincs bejelentkezve' });
    const d = req.body;
    const randId = Math.floor(1000 + Math.random() * 9000);
    const soferNameClean = req.session.user.nume.replace(/\s+/g, '_');
    const id = "FUV-" + randId;
    const fileName = `Menetlevel_${soferNameClean}_${randId}.pdf`;
    const cid = req.session.user.company_id;
    const year = new Date().getFullYear();
    const seqR = await pool.query(`INSERT INTO document_series (company_id,doc_type,prefix,year,current_seq) VALUES ($1,'MT','MT',$2,1) ON CONFLICT (company_id,doc_type,year) DO UPDATE SET current_seq=document_series.current_seq+1, updated_at=NOW() RETURNING prefix, current_seq`, [cid, year]);
    const autoDocNumber = seqR.rows[0] ? `${seqR.rows[0].prefix}-${year}-${String(seqR.rows[0].current_seq).padStart(4,'0')}` : null;
    const crossR = await pool.query(`SELECT direction, crossed_at FROM border_crossings WHERE email_sofer=$1 AND crossed_at >= NOW()-INTERVAL '90 days' ORDER BY crossed_at ASC`, [req.session.user.email]);
    const diurnaCalc = calculateDiurna(crossR.rows);

    const totalKm = Math.max(0, Number(d.kmSfarsit || 0) - Number(d.kmInceput || 0));
    let totalAlim = 0;
    const alimentari = Array.isArray(d.alimentari) ? d.alimentari : [];
    alimentari.forEach(a => { totalAlim += Number(a.litru || 0); });
    const cantInc = Number(d.cantInceput || 0);
    const cantSf = Number(d.cantSfarsit || 0);
    const motorinaFolosit = Math.max(0, cantInc + totalAlim - cantSf);
    const consum100 = totalKm > 0 ? Math.round((motorinaFolosit / totalKm * 100) * 100) / 100 : 0;

    const puncte = Array.isArray(d.puncte) ? d.puncte : [];
    const orderIds = Array.isArray(d.orderIds) ? d.orderIds : [];

    await pool.query(
      `INSERT INTO fuvarlevelek (
        id, file_name, email_sofer, nume_sofer,
        numar_camion, numar_remorca, numar_fisa, cursa_saptamanii,
        km_inceput, km_sfarsit, total_km,
        loc_plecare, loc_sosire, loc_desc_tur, loc_inc_retur,
        diurna_externa, diurna_interna,
        cant_inceput, cant_sfarsit, motorina_folosit, total_alim, consum_100,
        alte_mentiuni, alimentari, achizitii, tranzite, puncte, order_ids
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)`,
      [
        id, fileName, req.session.user.email, req.session.user.nume,
        d.numarCamion || null, d.numarRemorca || null, autoDocNumber || d.numarFisa || null, d.cursaSaptamanii || null,
        Number(d.kmInceput || 0), Number(d.kmSfarsit || 0), totalKm,
        d.locPlecare || null, d.locSosire || null, d.locDescTUR || null, d.locIncRETUR || null,
        diurnaCalc.externDays || parseInt(d.diurnaExterna || 0), diurnaCalc.internDays || parseInt(d.diurnaInterna || 0),
        cantInc, cantSf, motorinaFolosit, totalAlim, consum100,
        d.alteMentiuni || null,
        JSON.stringify(alimentari),
        JSON.stringify(Array.isArray(d.achizitii) ? d.achizitii : []),
        JSON.stringify(Array.isArray(d.tranzite) ? d.tranzite : []),
        JSON.stringify(puncte),
        JSON.stringify(orderIds)
      ]
    );
    res.json({ success: true, id });
  } catch (err) {
    console.error('fuvarlevel-save hiba:', err);
    res.json({ success: false, err: 'Szerver hiba' });
  }
});

app.post('/api/doc-upload', async (req, res) => {
  try {
    if (!req.session.user) return res.json({ success: false, err: 'Nincs bejelentkezve' });
    const { numeFisier, base64, tip } = req.body;
    await pool.query(
      `INSERT INTO documents (email_sofer, nume_sofer, tip, file_name, storage_url)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        req.session.user.email,
        req.session.user.nume,
        tip || 'CMR',
        numeFisier || 'dokument',
        base64 || null
      ]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('doc-upload hiba:', err);
    res.json({ success: false, err: 'Szerver hiba' });
  }
});

// SOFOR DOKUMENTUM MEGTEKINTES / LETOLTES
app.get('/api/doc-download/:id', async (req, res) => {
  try {
    if (!req.session.user) return res.status(401).send('Nincs bejelentkezve');
    const r = await pool.query(
      `SELECT d.id, d.file_name, d.tip, d.storage_url
       FROM documents d
       JOIN users u ON u.email = d.email_sofer
       WHERE d.id = $1 AND u.company_id = $2`,
      [req.params.id, req.session.user.company_id]
    );
    if (!r.rows.length) return res.status(404).send('Nem talalhato');
    const doc = r.rows[0];
    const base64 = doc.storage_url || '';
    if (!base64) return res.status(404).send('Nincs tartalom');
    const matches = base64.match(/^data:([^;]+);base64,(.+)$/s);
    if (matches) {
      const mime = matches[1];
      const data = Buffer.from(matches[2], 'base64');
      const fileName = encodeURIComponent(doc.file_name || ('dokument_' + doc.id));
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
      return res.send(data);
    }
    const data = Buffer.from(base64, 'base64');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(doc.file_name || 'dokument')}"`);
    return res.send(data);
  } catch (err) {
    console.error('doc-download hiba:', err);
    res.status(500).send('Szerver hiba');
  }
});

// PDF DOWNLOAD (DB-bol)
app.get('/api/pdf-download/:id', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM fuvarlevelek WHERE id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).send('Nem található.');
    const f = r.rows[0];

    const alimentari = Array.isArray(f.alimentari) ? f.alimentari : [];
    const achizitii  = Array.isArray(f.achizitii)  ? f.achizitii  : [];
    const puncte     = Array.isArray(f.puncte)      ? f.puncte     : [];
    const orderIds   = Array.isArray(f.order_ids)   ? f.order_ids  : [];

    // Útvonal pontok HTML
    let puncteHtml = '';
    if (puncte.length > 0) {
      puncte.forEach((p, i) => {
        puncteHtml += `<tr><td>${i+1}.</td><td>${p.tip || '—'}</td><td>${p.loc || '—'}</td><td>${p.data || '—'}</td></tr>`;
      });
    } else {
      // Ha nincs puncte, a régi loc_plecare/loc_sosire mutatjuk
      if (f.loc_plecare) puncteHtml += `<tr><td>1.</td><td>Plecare</td><td>${f.loc_plecare}</td><td>—</td></tr>`;
      if (f.loc_sosire)  puncteHtml += `<tr><td>2.</td><td>Sosire</td><td>${f.loc_sosire}</td><td>—</td></tr>`;
      if (!puncteHtml)   puncteHtml  = '<tr><td colspan="4">—</td></tr>';
    }

    // Tankolások HTML
    let alimHtml = '';
    if (alimentari.length > 0) {
      alimentari.forEach((a, i) => {
        alimHtml += `<tr>
          <td>${i+1}. ${a.loc || '—'}</td>
          <td>${a.tip || 'Motorină'}</td>
          <td>${a.litru || 0} L</td>
          <td>${a.km || 0} km</td>
          <td>${a.plata || '—'}</td>
          <td>${a.suma ? a.suma + ' RON' : '—'}</td>
        </tr>`;
      });
    } else {
      alimHtml = '<tr><td colspan="6">Nem lett rögzítve tankolás.</td></tr>';
    }

    // Kiadások HTML
    let achHtml = '';
    if (achizitii.length > 0) {
      achizitii.forEach((ach, i) => {
        achHtml += `<tr>
          <td>${i+1}. ${ach.loc || '—'}</td>
          <td>${ach.produs || '—'}</td>
          <td>${ach.pret || 0} RON</td>
          <td>${ach.plata || '—'}</td>
        </tr>`;
      });
    } else {
      achHtml = '<tr><td colspan="4">Nem lett rögzítve kiadás.</td></tr>';
    }

    // Fuvar ID-k
    const orderIdsStr = orderIds.length ? orderIds.join(', ') : '—';

    res.send(`
  <html>
  <head>
    <title>${f.file_name}</title>
    <meta charset="UTF-8">
    <style>
      body { font-family: Arial, sans-serif; padding: 20px; line-height: 1.5; color:#000; font-size:13px; }
      .header-box { text-align:center; font-weight:bold; font-size:17px; border-bottom:2px solid #000; padding-bottom:10px; margin-bottom:18px; }
      .grid-table { width:100%; border-collapse:collapse; margin-bottom:14px; }
      .grid-table td { border:1px solid #000; padding:5px 7px; vertical-align:top; }
      .grid-table th { border:1px solid #000; padding:5px 7px; background:#e8e8e8; font-weight:bold; text-align:left; }
      .sec-title { font-weight:bold; background:#d0d0d0; text-transform:uppercase; padding:5px 7px; border:1px solid #000; margin-top:14px; margin-bottom:0; font-size:12px; letter-spacing:.5px; }
      @media print { .no-print { display:none; } body { padding:10px; } }
    </style>
  </head>
  <body>
    <div class="no-print" style="margin-bottom:16px;">
      <button onclick="window.print()" style="padding:10px 24px;background:#000;color:#fff;font-weight:bold;cursor:pointer;border:none;border-radius:4px;font-size:14px;">🖨️ Nyomtatás / PDF mentés</button>
    </div>
    <div class="header-box">VALLOR TEAM SRL<br><span style="font-size:14px;">FIȘĂ DE CURSĂ SĂPTĂMÂNALĂ</span></div>

    <table class="grid-table">
      <tr><td width="50%"><b>Nume șofer:</b> ${f.nume_sofer || '—'}</td><td><b>Număr fișă:</b> ${f.numar_fisa || '—'}</td></tr>
      <tr><td><b>Număr camion:</b> ${f.numar_camion || '—'}</td><td><b>Număr remorcă:</b> ${f.numar_remorca || '—'}</td></tr>
      <tr><td><b>Cursa săptămânii:</b> ${f.cursa_saptamanii || '—'}</td><td><b>Fuvar ID-k:</b> ${orderIdsStr}</td></tr>
      <tr><td><b>Km început:</b> ${f.km_inceput || 0} km</td><td><b>Km sfârșit:</b> ${f.km_sfarsit || 0} km</td></tr>
      <tr><td colspan="2"><b>Total kilometri parcurși: ${f.total_km || 0} km</b></td></tr>
      <tr><td><b>Diurnă externă:</b> ${f.diurna_externa || 0} nap</td><td><b>Diurnă internă:</b> ${f.diurna_interna || 0} nap</td></tr>
    </table>

    <div class="sec-title">Puncte de traseu (Útvonal pontok)</div>
    <table class="grid-table">
      <tr><th>#</th><th>Tip</th><th>Localitate / Adresă</th><th>Dată</th></tr>
      ${puncteHtml}
    </table>

    <div class="sec-title">Alimentări (Tankolások)</div>
    <table class="grid-table">
      <tr><th>Loc & Data</th><th>Combustibil</th><th>Litri</th><th>Km</th><th>Plată</th><th>Sumă</th></tr>
      ${alimHtml}
    </table>

    <div class="sec-title">Calcul consum combustibil</div>
    <table class="grid-table">
      <tr><td><b>Cantitate început:</b> ${f.cant_inceput || 0} L</td><td><b>Cantitate sfârșit:</b> ${f.cant_sfarsit || 0} L</td></tr>
      <tr><td><b>Total alimentări:</b> ${f.total_alim || 0} L</td><td><b>Motorină folosită:</b> ${f.motorina_folosit || 0} L</td></tr>
      <tr><td colspan="2"><b>Consum mediu / 100 km: ${f.consum_100 || 0} L</b></td></tr>
    </table>

    <div class="sec-title">Achiziții / Cheltuieli (Kiadások)</div>
    <table class="grid-table">
      <tr><th>Loc & Data</th><th>Produs / Serviciu</th><th>Preț</th><th>Metodă plată</th></tr>
      ${achHtml}
    </table>

    <div class="sec-title">Alte mențiuni (Megjegyzések)</div>
    <div style="border:1px solid #000;padding:10px;min-height:40px;">${f.alte_mentiuni || '—'}</div>

    <div style="margin-top:30px;display:flex;justify-content:space-between;">
      <div style="text-align:center;"><div style="border-top:1px solid #000;width:180px;margin:0 auto;padding-top:4px;">Semnătura șofer</div></div>
      <div style="text-align:center;"><div style="border-top:1px solid #000;width:180px;margin:0 auto;padding-top:4px;">Semnătura dispecer</div></div>
    </div>
  </body>
  </html>`);
  } catch (err) {
    console.error('pdf-download hiba:', err);
    res.status(500).send('Szerver hiba');
  }
});



// GENERIKUS DISPATCHER (regi GAS-szeru hivasok)
app.post('/api/execute', requireLogin, async (req, res) => {
  const { functionName, arguments: args } = req.body;

  // AUTH ME (session-bol)
  if (functionName === 'authMe') {
    return res.json({ result: req.session.user || null });
  }

  // LOGOUT
  if (functionName === 'authLogout') {
    req.session.destroy(function(err) {
      if (err) {
        return res.json({ result: { ok: false, err: 'Logout hiba' } });
      }
      res.clearCookie('connect.sid');
      return res.json({ result: { ok: true } });
    });
    return;
  }

  // REGISZTRACIO MEGHIVOKODDAL (DB-bol)
  if (functionName === 'authRegister') {
    try {
      const p = args[0] || {};
      const nume = String(p.nume || '').trim();
      const email = String(p.email || '').trim().toLowerCase();
      const tel = String(p.tel || '').trim();
      const jelszo = String(p.jelszo || '');
      const kod = String(p.kod || '').trim().toUpperCase();

      if (!nume || !email || !jelszo || !kod) {
        return res.json({ result: { ok: false, err: 'Minden mezo kotelezo.' } });
      }
      if (jelszo.length < 6) {
        return res.json({ result: { ok: false, err: 'A jelszo legalabb 6 karakter legyen.' } });
      }

      const invResult = await pool.query(
        'SELECT id, pozicio, email, status, company_id FROM invites WHERE kod = $1',
        [kod]
      );

      if (invResult.rows.length === 0) {
        return res.json({ result: { ok: false, err: 'Ismeretlen meghivokod.' } });
      }

      const invite = invResult.rows[0];

      if (invite.status && invite.status.toLowerCase().startsWith('felhaszn')) {
        return res.json({ result: { ok: false, err: 'Ezt a meghivokodot mar felhasznaltak.' } });
      }
      if (invite.email && invite.email.toLowerCase() !== email) {
        return res.json({ result: { ok: false, err: 'A meghivo nem ehhez az email-cimhez tartozik.' } });
      }

      const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
      if (existing.rows.length > 0) {
        return res.json({ result: { ok: false, err: 'Ez az email mar regisztralt.' } });
      }

      const passwordHash = await bcrypt.hash(jelszo, 10);
      await pool.query(
        `INSERT INTO users (nume, email, tel, pozicio, password_hash, company_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [nume, email, tel, invite.pozicio, passwordHash, invite.company_id || null]
      );

      await pool.query(
        `UPDATE invites SET status = 'Felhasznalva', used_by = $1 WHERE id = $2`,
        [email, invite.id]
      );

      return res.json({
        result: { ok: true, msg: 'Sikeres regisztracio. Most mar bejelentkezhet.', pozicio: invite.pozicio }
      });

    } catch (err) {
      console.error('Register hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  }

  // HATARATLEPESEK LISTAJA (DB)
  if (functionName === 'getBorderLogs') {
    try {
      if (!req.session.user) return res.json({ result: [] });
      const cid = req.session.user.company_id;
      const isAdmin = ['Admin', 'Manager'].includes(req.session.user.pozicio);
      const r = isAdmin
        ? await pool.query('SELECT bc.* FROM border_crossings bc JOIN users u ON u.email = bc.email_sofer WHERE u.company_id = $1 ORDER BY bc.created_at DESC LIMIT 200', [cid])
        : await pool.query('SELECT * FROM border_crossings WHERE email_sofer = $1 ORDER BY created_at DESC', [req.session.user.email]);
      return res.json({ result: r.rows });
    } catch (err) {
      console.error('getBorderLogs hiba:', err);
      return res.json({ result: [] });
    }
  }

  // MENETLEVELEK LISTAJA (DB)
  if (functionName === 'getFuvarlevelek') {
    try {
      if (!req.session.user) return res.json({ result: [] });
      const me = req.session.user;
      const cid = me.company_id;
      const isAdmin = ['Admin', 'Manager'].includes(me.pozicio);
      let r;
      if (isAdmin && cid) {
        // Cég összes sofőrjének menetlevelei — email lista alapján (nem JOIN, megbízhatóbb online)
        const sofors = await pool.query(
          'SELECT email FROM users WHERE company_id = $1 AND pozicio = $2', [cid, 'Sofer']
        );
        const emails = sofors.rows.map(u => u.email);
        if (!emails.length) return res.json({ result: [] });
        r = await pool.query(
          `SELECT id, file_name, email_sofer, nume_sofer, data_completare, total_km, consum_100, order_ids
           FROM fuvarlevelek WHERE email_sofer = ANY($1)
           ORDER BY data_completare DESC LIMIT 200`,
          [emails]
        );
      } else {
        r = await pool.query(
          `SELECT id, file_name, email_sofer, nume_sofer, data_completare, total_km, consum_100, order_ids
           FROM fuvarlevelek WHERE email_sofer = $1
           ORDER BY data_completare DESC`,
          [me.email]
        );
      }
      return res.json({ result: r.rows });
    } catch (err) {
      console.error('getFuvarlevelek hiba:', err);
      return res.json({ result: [] });
    }
  }

  // SOFER DOKUMENTUMOK LISTAJA (DB)
  if (functionName === 'getDriverDocs') {
    try {
      if (!req.session.user) return res.json({ result: [] });
      const cid = req.session.user.company_id;
      const isAdmin = ['Admin', 'Manager'].includes(req.session.user.pozicio);
      const r = isAdmin
        ? await pool.query('SELECT d.id, d.email_sofer, d.nume_sofer, d.tip, d.file_name, d.created_at FROM documents d JOIN users u ON u.email = d.email_sofer WHERE u.company_id = $1 ORDER BY d.created_at DESC LIMIT 200', [cid])
        : await pool.query('SELECT id, email_sofer, nume_sofer, tip, file_name, created_at FROM documents WHERE email_sofer = $1 ORDER BY created_at DESC', [req.session.user.email]);
      return res.json({ result: r.rows });
    } catch (err) {
      console.error('getDriverDocs hiba:', err);
      return res.json({ result: [] });
    }
  }
  if (functionName === 'userListAll') {
    try {
      if (!['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: [] });
      }
      const cid = req.session.user.company_id;
      if (!cid) return res.json({ result: [] });
      const r = await pool.query(
        'SELECT id, nume, email, tel, pozicio FROM users WHERE company_id = $1 AND (pozicio_dev IS NOT TRUE) ORDER BY id',
        [cid]
      );
      return res.json({ result: r.rows });
    } catch (e) {
      console.error(e);
      return res.json({ result: [] });
    }
  }

  // BELSŐ SOFŐRÖK LISTÁJA (Sofer pozíciójú regisztrált felhasználók)
  if (functionName === 'getInternalDrivers') {
    try {
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: [] });
      }
      const cid = req.session.user.company_id;
      const r = await pool.query(
        `SELECT id, nume, email, tel FROM users
         WHERE company_id = $1 AND pozicio = 'Sofer'
         ORDER BY nume`,
        [cid]
      );
      return res.json({ result: r.rows });
    } catch (e) {
      console.error('getInternalDrivers hiba:', e);
      return res.json({ result: [] });
    }
  }
  // MEGHIVOKODOK LISTAJA (DB-bol)
  if (functionName === 'invListAll') {
    try {
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      }
      const r = await pool.query(
        `SELECT kod, pozicio, email, status FROM invites WHERE company_id = $1 ORDER BY id DESC`,
        [req.session.user.company_id]
      );
      const list = r.rows.map(row => ({
        kod: row.kod, pozicio: row.pozicio, email: row.email, statusz: row.status,
      }));
      return res.json({ result: list });
    } catch (err) {
      console.error('invListAll hiba:', err);
      return res.json({ result: [] });
    }
  }

  // UJ MEGHIVOKOD GENERALAS (DB-be)
  if (functionName === 'invCreate') {
    try {
      // Admin barmit, Manager csak Sofer meghivot
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      }

      const pozicio = String(args[0] || '').trim();

      // 🔒 Manager csak Sofer meghivot kuldhet
      if (req.session.user.pozicio === 'Manager' && pozicio !== 'Sofer') {
        return res.json({ result: { ok: false, err: 'Manager csak Sofer meghivot generalhat.' } });
      }
    
      const email = String(args[1] || '').trim().toLowerCase();
      const invNume = String(args[2] || '').trim() || null;
      const invTel  = String(args[3] || '').trim() || null;

      if (!['Admin', 'Manager', 'Sofer'].includes(pozicio)) {
        return res.json({ result: { ok: false, err: 'Ervenytelen pozicio.' } });
      }

      // veletlen kod generalas - hasonloan a regi _genCode-hoz
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let kod = 'VS-';
      for (let i = 0; i < 6; i++) {
        kod += chars.charAt(Math.floor(Math.random() * chars.length));
      }

      await pool.query(
        `INSERT INTO invites (kod, pozicio, email, status, company_id, nume, tel) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [kod, pozicio, email, 'Aktiv', req.session.user.company_id || null, invNume, invTel]
      );

      // Email kuldese ha van email cim
      if (email) {
        const cegRes = await pool.query('SELECT nev, igazgato_nev FROM companies WHERE id = $1', [req.session.user.company_id]);
        const cegNev = cegRes.rows[0]?.nev || '';
        const igazgatoNev = cegRes.rows[0]?.igazgato_nev || null;
        sendInviteEmail(email, kod, pozicio, cegNev, igazgatoNev)
          .catch(e => console.error('Email hatter hiba:', e.message));
      }

      return res.json({ result: { ok: true, kod: kod } });

    } catch (err) {
      console.error('invCreate hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  }

  // MEGHIVOKOD VISSZAVONAS (jovobeli admin funkcioknak)
  if (functionName === 'invRevoke') {
    try {
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      }
      const kod = String(args[0] || '').trim().toUpperCase();

      // 🔒 Manager csak Sofer meghivot vonhat vissza
      if (req.session.user.pozicio === 'Manager') {
        const check = await pool.query('SELECT pozicio FROM invites WHERE kod = $1', [kod]);
        if (check.rows.length === 0) {
          return res.json({ result: { ok: false, err: 'Nem talalhato.' } });
        }
        if (check.rows[0].pozicio !== 'Sofer') {
          return res.json({ result: { ok: false, err: 'Manager csak Sofer meghivot vonhat vissza.' } });
        }
      }

      const r = await pool.query(
        `UPDATE invites SET status = 'Visszavonva' WHERE kod = $1`,
        [kod]
      );
      if (r.rowCount === 0) {
        return res.json({ result: { ok: false, err: 'Nem talalhato.' } });
      }
      return res.json({ result: { ok: true } });
    } catch (err) {
      console.error('invRevoke hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  }
  // PECSET / ALAIRAS - felhasznalonkent az adatbazisban (stamps tabla)
  if (functionName === 'stampGet') {
    try {
      if (!req.session.user) return res.json({ result: { ok: false, err: 'Nincs bejelentkezve' } });
      const email = req.session.user.email;
      const r = await pool.query('SELECT base64_png FROM stamps WHERE email = $1', [email]);
      if (r.rows.length && r.rows[0].base64_png) {
        return res.json({ result: { ok: true, base64: r.rows[0].base64_png } });
      }
      return res.json({ result: { ok: true, base64: null } });
    } catch (err) {
      console.error('stampGet hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  }
  if (functionName === 'stampSave') {
    try {
      if (!req.session.user) return res.json({ result: { ok: false, err: 'Nincs bejelentkezve' } });
      const email = req.session.user.email;
      const b64 = args[0];
      if (!b64) return res.json({ result: { ok: false, err: 'Hianyzo kep' } });
      await pool.query(
        `INSERT INTO stamps (email, base64_png, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (email)
         DO UPDATE SET base64_png = EXCLUDED.base64_png, updated_at = NOW()`,
        [email, b64]
      );
      return res.json({ result: { ok: true } });
    } catch (err) {
      console.error('stampSave hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  }
  // EGY FUVAR ADATAI + SZAKASZOK (szerkeszto modal)
  if (functionName === 'getOrderById') {
    try {
      if (!req.session.user || !['Admin','Manager'].includes(req.session.user.pozicio))
        return res.json({ result: null, legs: [] });
      const id = String(args[0] || '').trim();
      const cid = req.session.user.company_id;
      const or = await pool.query(
        'SELECT * FROM orders WHERE id = $1 AND company_id = $2',
        [id, cid]
      );
      const order = or.rows[0] || null;
      let legs = [];
      if (order) {
        const lr = await pool.query(
          'SELECT * FROM order_legs WHERE order_id = $1 ORDER BY leg_number',
          [id]
        );
        legs = lr.rows;
      }
      return res.json({ result: order, legs });
    } catch (err) {
      console.error('getOrderById hiba:', err);
      return res.json({ result: null, legs: [] });
    }
  }

  // FUVARFELADATOK LISTAJA (DB-bol)
  if (functionName === 'comList') {
    try {
      if (!req.session.user) return res.json({ result: [] });
      const me = req.session.user;
      const cid = me.company_id;
      // Kozos subquery: order_legs aggregacio (szakaszok szama + reszletek)
      const legsSubquery = `
        LEFT JOIN (
          SELECT order_id,
                 COUNT(*)::int AS leg_count,
                 JSON_AGG(
                   JSON_BUILD_OBJECT(
                     'leg_number',    leg_number,
                     'sofer',         COALESCE(nume_sofer, email_sofer, firma_extern, '—'),
                     'rendszam',      COALESCE(rendszam_camion, ''),
                     'loc_preluare',  COALESCE(loc_preluare, '')
                   ) ORDER BY leg_number
                 ) AS legs_json
          FROM order_legs
          GROUP BY order_id
        ) legs ON legs.order_id = o.id`;
      let r;
      if (me.pozicio === 'Admin' || me.pozicio === 'Manager') {
        r = await pool.query(
          `SELECT o.id, o.client, o.ref, o.loc_incarcare, o.loc_descarcare,
                  o.pret, o.km, o.status, o.sofer_type, o.email_sofer, o.nume_sofer,
                  o.firma_extern, o.telefon_extern, o.rendszam_camion, o.rendszam_remorca,
                  COALESCE(legs.leg_count, 0) AS leg_count,
                  COALESCE(legs.legs_json, '[]'::json) AS legs_json
           FROM orders o ${legsSubquery}
           WHERE o.company_id = $1 ORDER BY o.created_at DESC`,
          [cid]
        );
      } else {
        // Sofernek csak a sajat nevere kiosztott fuvarok latszanak
        r = await pool.query(
          `SELECT o.id, o.client, o.ref, o.loc_incarcare, o.loc_descarcare,
                  o.pret, o.km, o.status, o.sofer_type, o.email_sofer, o.nume_sofer,
                  o.firma_extern, o.telefon_extern, o.rendszam_camion, o.rendszam_remorca,
                  COALESCE(legs.leg_count, 0) AS leg_count,
                  COALESCE(legs.legs_json, '[]'::json) AS legs_json
           FROM orders o ${legsSubquery}
           WHERE o.company_id = $1 AND LOWER(o.email_sofer) = LOWER($2)
           ORDER BY o.created_at DESC`,
          [cid, me.email]
        );
      }
      return res.json({ result: r.rows });
    } catch (err) {
      console.error('comList hiba:', err);
      return res.json({ result: [] });
    }
  }

  // SOFER SAJÁT KIOSZTOTT FUVARJAI (menetlevélhez való kiválasztáshoz)
  if (functionName === 'getMySoferOrders') {
    try {
      if (!req.session.user) return res.json({ result: [] });
      const me = req.session.user;
      const r = await pool.query(
        `SELECT id, client, ref, loc_incarcare, loc_descarcare, km, rendszam_camion, rendszam_remorca, status
         FROM orders
         WHERE company_id = $1 AND LOWER(email_sofer) = LOWER($2)
         ORDER BY created_at DESC`,
        [me.company_id, me.email]
      );
      return res.json({ result: r.rows });
    } catch (err) {
      console.error('getMySoferOrders hiba:', err);
      return res.json({ result: [] });
    }
  }

 // UJ FUVARFELADAT (Admin/Manager)
  if (functionName === 'comCreate') {
    try {
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      }

      const o = args[0] || {};
      const id = "CMD-" + Math.floor(1000 + Math.random() * 9000);
      const client = String(o.client || '').trim();
      const ref = String(o.ref || '').trim();
      const pret = Number(o.pret || 0);
      const km = Number(o.km || 0);
      const loc_incarcare = String(o.loc_incarcare || '').trim();
      const loc_descarcare = String(o.loc_descarcare || '').trim();
      const data_incarcare = o.data_incarcare || null;
      const data_descarcare = o.data_descarcare || null;
      const sofer_type = o.sofer_type || null;
      const email_sofer = o.email_sofer ? String(o.email_sofer).trim().toLowerCase() : null;
      const nume_sofer = o.nume_sofer ? String(o.nume_sofer).trim() : null;
      const firma_extern = o.firma_extern ? String(o.firma_extern).trim() : null;
      const telefon_extern = o.telefon_extern ? String(o.telefon_extern).trim() : null;
      const external_driver_id = o.external_driver_id ? parseInt(o.external_driver_id, 10) : null;
      const rendszam_camion = o.rendszam_camion ? String(o.rendszam_camion).trim().toUpperCase() : null;
      const rendszam_remorca = o.rendszam_remorca ? String(o.rendszam_remorca).trim().toUpperCase() : null;
      const company_id = req.session.user.company_id;

      let status = 'Disponibil';
      if (sofer_type === 'Intern' && email_sofer) status = 'Alocat';
      else if (sofer_type === 'Extern') status = 'Extern';

      await pool.query(
        `INSERT INTO orders (
          id, client, ref, loc_incarcare, loc_descarcare,
          data_incarcare, data_descarcare, pret, km,
          sofer_type, email_sofer, nume_sofer,
          firma_extern, telefon_extern, external_driver_id,
          rendszam_camion, rendszam_remorca, status, company_id
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
        )`,
        [
          id, client, ref, loc_incarcare, loc_descarcare,
          data_incarcare, data_descarcare, pret, km,
          sofer_type, email_sofer, nume_sofer,
          firma_extern, telefon_extern, external_driver_id,
          rendszam_camion, rendszam_remorca, status, company_id
        ]
      );

      await pool.query(
        `INSERT INTO order_legs (
          order_id, leg_number, sofer_type, email_sofer, nume_sofer,
          firma_extern, telefon_extern, external_driver_id,
          rendszam_camion, rendszam_remorca,
          loc_preluare, data_preluare, company_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          id, 1, sofer_type, email_sofer, nume_sofer,
          firma_extern, telefon_extern, external_driver_id,
          rendszam_camion, rendszam_remorca,
          loc_incarcare, data_incarcare, company_id
        ]
      );

      return res.json({ result: { ok: true, id: id } });
    } catch (err) {
      console.error('comCreate hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  }

  // FELHASZNALO ADATOK MODOSITASA (DB-ben)
  if (functionName === 'userUpdate') {
    try {
      // Admin es Manager hivhatja, de a Manager korlatozott (lejjebb)
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      }

      const targetEmail = String(args[0] || '').trim().toLowerCase();
      const fields = args[1] || {};

      if (!targetEmail) {
        return res.json({ result: { ok: false, err: 'Email kotelezo.' } });
      }

      // Lekerjuk a cel-felhasznalot a DB-bol
      const targetRes = await pool.query(
        'SELECT id, email, pozicio, company_id FROM users WHERE email = $1',
        [targetEmail]
      );
      if (targetRes.rows.length === 0) {
        return res.json({ result: { ok: false, err: 'Felhasznalo nem talalhato.' } });
      }
      const targetUser = targetRes.rows[0];
      const isSelf = targetEmail === req.session.user.email.toLowerCase();
      const callerRole = req.session.user.pozicio;

      // 🔒 Ceg-szures: csak sajat ceg useret modosithatja
      if (targetUser.company_id !== req.session.user.company_id) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag.' } });
      }

      // 🔒 Manager nem modosithatja Admin vagy mas Manager adatait
      if (callerRole === 'Manager' && !isSelf && targetUser.pozicio !== 'Sofer') {
        return res.json({ result: { ok: false, err: 'Manager csak Sofer adatait modosithatja.' } });
      }

      // 🔒 Admin nem modosithatja mas Admin jelszavat vagy emailjet
      if (callerRole === 'Admin' && !isSelf && targetUser.pozicio === 'Admin') {
        if (fields.jelszo) {
          return res.json({ result: { ok: false, err: 'Admin mas Admin jelszavat nem valtoztathatja.' } });
        }
      }

      // dinamikusan epitjuk az UPDATE-et csak azokra a mezokre, amik vannak
      const updates = [];
      const values = [];
      let i = 1;

      if (fields.nume !== undefined) {
        updates.push(`nume = $${i++}`);
        values.push(fields.nume);
      }
      if (fields.tel !== undefined) {
        updates.push(`tel = $${i++}`);
        values.push(fields.tel);
      }
      if (fields.pozicio !== undefined) {
        if (!['Admin', 'Manager', 'Sofer'].includes(fields.pozicio)) {
          return res.json({ result: { ok: false, err: 'Ervenytelen pozicio.' } });
        }

        // 🔒 1. SZABALY: Admin ne tudja a SAJAT poziciojat megvaltoztatni (lefokozas tiltva)
        if (isSelf && fields.pozicio !== targetUser.pozicio) {
          return res.json({ result: { ok: false, err: 'Sajat poziciodat nem modosithatod.' } });
        }

        // 🔒 3. SZABALY: Manager / Sofer pozicio szerkezeti vedelme
        // - utolso Admin nem fokozhato le (rendszer mindig kell legyen egy Admin)
        if (targetUser.pozicio === 'Admin' && fields.pozicio !== 'Admin') {
          const adminCount = await pool.query(
            "SELECT COUNT(*)::int AS db FROM users WHERE pozicio = 'Admin'"
          );
          if (adminCount.rows[0].db <= 1) {
            return res.json({ result: { ok: false, err: 'Nem maradhat a rendszer Admin nelkul.' } });
          }
        }

        updates.push(`pozicio = $${i++}`);
        values.push(fields.pozicio);
      }
      if (fields.jelszo) {
        const hash = await bcrypt.hash(fields.jelszo, 10);
        updates.push(`password_hash = $${i++}`);
        values.push(hash);
      }

      if (updates.length === 0) {
        return res.json({ result: { ok: false, err: 'Nincs mit modositani.' } });
      }

      values.push(targetEmail);
      const sql = `UPDATE users SET ${updates.join(', ')} WHERE email = $${i}`;
      const r = await pool.query(sql, values);

      if (r.rowCount === 0) {
        return res.json({ result: { ok: false, err: 'Felhasznalo nem talalhato.' } });
      }

      return res.json({ result: { ok: true } });

    } catch (err) {
      console.error('userUpdate hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  }

  // ── BEÁLLÍTÁSOK: Saját jelszó módosítása (minden bejelentkezett user) ──
  if (functionName === 'settingsChangePassword') {
    try {
      if (!req.session.user) return res.json({ result: { ok: false, err: 'Nincs bejelentkezve.' } });
      const { current, newPwd } = args[0] || {};
      if (!current || !newPwd) return res.json({ result: { ok: false, err: 'Minden mező kötelező.' } });
      if (newPwd.length < 6) return res.json({ result: { ok: false, err: 'Az új jelszó legalább 6 karakter legyen.' } });

      const r = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.session.user.id]);
      if (!r.rows.length) return res.json({ result: { ok: false, err: 'Felhasználó nem található.' } });

      const ok = await bcrypt.compare(current, r.rows[0].password_hash);
      if (!ok) return res.json({ result: { ok: false, err: 'A jelenlegi jelszó helytelen.' } });

      const hash = await bcrypt.hash(newPwd, 10);
      await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.session.user.id]);
      return res.json({ result: { ok: true } });
    } catch (err) {
      console.error('settingsChangePassword hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba.' } });
    }
  }

  // ── BEÁLLÍTÁSOK: Saját profil mentése (név, telefon) ──
  if (functionName === 'settingsSaveProfile') {
    try {
      if (!req.session.user) return res.json({ result: { ok: false, err: 'Nincs bejelentkezve.' } });
      const { nume, tel } = args[0] || {};
      if (!nume || !String(nume).trim()) return res.json({ result: { ok: false, err: 'A név kötelező.' } });

      const newNume = String(nume).trim();
      const newTel  = String(tel || '').trim();
      await pool.query('UPDATE users SET nume = $1, tel = $2 WHERE id = $3', [newNume, newTel, req.session.user.id]);

      // session frissítése
      req.session.user.nume = newNume;
      req.session.user.tel  = newTel;
      return res.json({ result: { ok: true } });
    } catch (err) {
      console.error('settingsSaveProfile hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba.' } });
    }
  }

  // ── BEÁLLÍTÁSOK: 2FA kikapcsolása (csak saját fiók) ──
  if (functionName === 'settings2faDisable') {
    try {
      if (!req.session.user) return res.json({ result: { ok: false, err: 'Nincs bejelentkezve.' } });
      const { currentPwd } = args[0] || {};
      if (!currentPwd) return res.json({ result: { ok: false, err: 'A jelszó megadása kötelező a 2FA kikapcsolásához.' } });

      const r = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.session.user.id]);
      if (!r.rows.length) return res.json({ result: { ok: false, err: 'Felhasználó nem található.' } });

      const ok = await bcrypt.compare(currentPwd, r.rows[0].password_hash);
      if (!ok) return res.json({ result: { ok: false, err: 'Helytelen jelszó.' } });

      await pool.query('UPDATE users SET totp_enabled = FALSE, totp_secret = NULL, totp_backup_codes = NULL WHERE id = $1', [req.session.user.id]);
      return res.json({ result: { ok: true } });
    } catch (err) {
      console.error('settings2faDisable hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba.' } });
    }
  }

  // ── BEÁLLÍTÁSOK: 2FA státusz lekérése ──
  if (functionName === 'settings2faStatus') {
    try {
      if (!req.session.user) return res.json({ result: { ok: false } });
      const r = await pool.query('SELECT totp_enabled FROM users WHERE id = $1', [req.session.user.id]);
      const enabled = r.rows.length ? !!r.rows[0].totp_enabled : false;
      return res.json({ result: { ok: true, totp_enabled: enabled } });
    } catch (err) {
      return res.json({ result: { ok: false, totp_enabled: false } });
    }
  }

  // FELHASZNALO TORLES (Admin / Manager)
  if (functionName === 'userDelete') {
    try {
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      }
      const targetEmail = String(args[0] || '').trim().toLowerCase();
      if (!targetEmail) {
        return res.json({ result: { ok: false, err: 'Email kotelezo.' } });
      }

      // 🔒 2. SZABALY: ne torolhesse sajat magat
      if (targetEmail === req.session.user.email.toLowerCase()) {
        return res.json({ result: { ok: false, err: 'Sajat magadat nem torolheted.' } });
      }

      // 🔒 Lekerjuk a cel-felhasznalo poziciojat es ceg-id-jet
      const targetRes = await pool.query(
        'SELECT pozicio, company_id FROM users WHERE email = $1',
        [targetEmail]
      );
      if (targetRes.rows.length === 0) {
        return res.json({ result: { ok: false, err: 'Felhasznalo nem talalhato.' } });
      }

      // 🔒 Csak sajat ceg useret torolheti
      if (targetRes.rows[0].company_id !== req.session.user.company_id) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag.' } });
      }

      // 🔒 Manager csak Sofer felhasznalot torolhet
      if (req.session.user.pozicio === 'Manager' && targetRes.rows[0].pozicio !== 'Sofer') {
        return res.json({ result: { ok: false, err: 'Manager csak Sofer felhasznalot torolhet.' } });
      }

      // 🔒 KIEGESZITES: utolso Admin torlese sem engedett
      if (targetRes.rows[0].pozicio === 'Admin') {
        const adminCount = await pool.query(
          "SELECT COUNT(*)::int AS db FROM users WHERE pozicio = 'Admin'"
        );
        if (adminCount.rows[0].db <= 1) {
          return res.json({ result: { ok: false, err: 'Az utolso Admin nem torolheto.' } });
        }
      }

      const r = await pool.query('DELETE FROM users WHERE email = $1', [targetEmail]);
      if (r.rowCount === 0) {
        return res.json({ result: { ok: false, err: 'Felhasznalo nem talalhato.' } });
      }
      return res.json({ result: { ok: true } });
    } catch (err) {
      console.error('userDelete hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  }

  // JARMU LISTA LEKERDEZESE
  if (functionName === 'vehicleList') {
    try {
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: [] });
      }
      const r = await pool.query(
        'SELECT * FROM vehicles WHERE company_id = $1 ORDER BY tip, rendszam',
        [req.session.user.company_id]
      );
      return res.json({ result: r.rows });
    } catch (err) {
      console.error('vehicleList hiba:', err);
      return res.json({ result: [] });
    }
  }

  // UJ JARMU LETREHOZASA
  if (functionName === 'vehicleCreate') {
    try {
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      }

      const v = args[0] || {};
      const rendszam = String(v.rendszam || '').trim().toUpperCase();
      const tip = String(v.tip || '').trim();
      const marca = v.marca ? String(v.marca).trim() : null;
      const model = v.model ? String(v.model).trim() : null;
      const an = v.an ? parseInt(v.an, 10) : null;
      const nota = v.nota ? String(v.nota).trim() : null;

      if (!rendszam) {
        return res.json({ result: { ok: false, err: 'A rendszam kotelezo.' } });
      }
      if (!['Vontato', 'Potkocsi'].includes(tip)) {
        return res.json({ result: { ok: false, err: 'Ervenytelen tipus.' } });
      }

      await pool.query(
        `INSERT INTO vehicles (rendszam, tip, marca, model, an, nota, company_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [rendszam, tip, marca, model, an, nota, req.session.user.company_id]
      );
      return res.json({ result: { ok: true } });
    } catch (err) {
      if (err.code === '23505') {
        return res.json({ result: { ok: false, err: 'Ez a rendszam mar letezik.' } });
      }
      console.error('vehicleCreate hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  }

  // JARMU MODOSITAS
  if (functionName === 'vehicleUpdate') {
    try {
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      }

      const id = parseInt(args[0], 10);
      const f = args[1] || {};
      if (!id) {
        return res.json({ result: { ok: false, err: 'ID kotelezo.' } });
      }

      const updates = [];
      const values = [];
      let i = 1;

      if (f.rendszam !== undefined) {
        updates.push(`rendszam = $${i++}`);
        values.push(String(f.rendszam).trim().toUpperCase());
      }
      if (f.tip !== undefined) {
        if (!['Vontato', 'Potkocsi'].includes(f.tip)) {
          return res.json({ result: { ok: false, err: 'Ervenytelen tipus.' } });
        }
        updates.push(`tip = $${i++}`);
        values.push(f.tip);
      }
      if (f.marca !== undefined) {
        updates.push(`marca = $${i++}`);
        values.push(f.marca);
      }
      if (f.model !== undefined) {
        updates.push(`model = $${i++}`);
        values.push(f.model);
      }
      if (f.an !== undefined) {
        updates.push(`an = $${i++}`);
        values.push(f.an ? parseInt(f.an, 10) : null);
      }
      if (f.nota !== undefined) {
        updates.push(`nota = $${i++}`);
        values.push(f.nota);
      }
      if (f.activ !== undefined) {
        updates.push(`activ = $${i++}`);
        values.push(!!f.activ);
      }

      if (updates.length === 0) {
        return res.json({ result: { ok: false, err: 'Nincs mit modositani.' } });
      }

      updates.push(`updated_at = NOW()`);
      values.push(id);
      const sql = `UPDATE vehicles SET ${updates.join(', ')} WHERE id = $${i}`;
      const r = await pool.query(sql, values);

      if (r.rowCount === 0) {
        return res.json({ result: { ok: false, err: 'Nem talalhato.' } });
      }
      return res.json({ result: { ok: true } });
    } catch (err) {
      if (err.code === '23505') {
        return res.json({ result: { ok: false, err: 'Ez a rendszam mar letezik.' } });
      }
      console.error('vehicleUpdate hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  }

  // JARMU TORLES
  if (functionName === 'vehicleDelete') {
    try {
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      }
      const id = parseInt(args[0], 10);
      if (!id) {
        return res.json({ result: { ok: false, err: 'ID kotelezo.' } });
      }
      const r = await pool.query('DELETE FROM vehicles WHERE id = $1 AND company_id = $2', [id, req.session.user.company_id]);
      if (r.rowCount === 0) {
        return res.json({ result: { ok: false, err: 'Nem talalhato.' } });
      }
      return res.json({ result: { ok: true } });
    } catch (err) {
      console.error('vehicleDelete hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  }
  // ===========================================================
  //   KULSO SOFOROK KEZELESE (external_drivers)
  // ===========================================================

  // LISTA
  if (functionName === 'extDriverList') {
    try {
      if (!req.session.user) {
        return res.json({ result: [] });
      }
      const r = await pool.query(
        `SELECT id, nume, firma, telefon, email, rendszam_camion, rendszam_remorca, nota, created_at
         FROM external_drivers WHERE company_id = $1 ORDER BY nume, firma`,
        [req.session.user.company_id]
      );
      return res.json({ result: r.rows });
    } catch (err) {
      console.error('extDriverList hiba:', err);
      return res.json({ result: [] });
    }
  }

  // UJ KULSO SOFOR
  if (functionName === 'extDriverCreate') {
    try {
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      }

      const d = args[0] || {};
      const nume = d.nume ? String(d.nume).trim() : null;
      const firma = d.firma ? String(d.firma).trim() : null;
      const telefon = d.telefon ? String(d.telefon).trim() : null;
      const email = d.email ? String(d.email).trim().toLowerCase() : null;
      const rendszam_camion = d.rendszam_camion ? String(d.rendszam_camion).trim().toUpperCase() : null;
      const rendszam_remorca = d.rendszam_remorca ? String(d.rendszam_remorca).trim().toUpperCase() : null;
      const nota = d.nota ? String(d.nota).trim() : null;

      // legalabb egy mezo kotelezo (nume vagy firma)
      if (!nume && !firma) {
        return res.json({ result: { ok: false, err: 'A nev vagy a ceg neve kotelezo.' } });
      }

      const r = await pool.query(
        `INSERT INTO external_drivers (nume, firma, telefon, email, rendszam_camion, rendszam_remorca, nota, company_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [nume, firma, telefon, email, rendszam_camion, rendszam_remorca, nota, req.session.user.company_id]
      );
      return res.json({ result: { ok: true, id: r.rows[0].id } });
    } catch (err) {
      console.error('extDriverCreate hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  }

  // KULSO SOFOR MODOSITAS
  if (functionName === 'extDriverUpdate') {
    try {
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      }

      const id = parseInt(args[0], 10);
      const f = args[1] || {};
      if (!id) {
        return res.json({ result: { ok: false, err: 'ID kotelezo.' } });
      }

      const updates = [];
      const values = [];
      let i = 1;

      if (f.nume !== undefined) {
        updates.push(`nume = $${i++}`);
        values.push(f.nume ? String(f.nume).trim() : null);
      }
      if (f.firma !== undefined) {
        updates.push(`firma = $${i++}`);
        values.push(f.firma ? String(f.firma).trim() : null);
      }
      if (f.telefon !== undefined) {
        updates.push(`telefon = $${i++}`);
        values.push(f.telefon ? String(f.telefon).trim() : null);
      }
      if (f.email !== undefined) {
        updates.push(`email = $${i++}`);
        values.push(f.email ? String(f.email).trim().toLowerCase() : null);
      }
      if (f.rendszam_camion !== undefined) {
        updates.push(`rendszam_camion = $${i++}`);
        values.push(f.rendszam_camion ? String(f.rendszam_camion).trim().toUpperCase() : null);
      }
      if (f.rendszam_remorca !== undefined) {
        updates.push(`rendszam_remorca = $${i++}`);
        values.push(f.rendszam_remorca ? String(f.rendszam_remorca).trim().toUpperCase() : null);
      }
      if (f.nota !== undefined) {
        updates.push(`nota = $${i++}`);
        values.push(f.nota ? String(f.nota).trim() : null);
      }

      if (updates.length === 0) {
        return res.json({ result: { ok: false, err: 'Nincs mit modositani.' } });
      }

      updates.push(`updated_at = NOW()`);
      values.push(id);
      const sql = `UPDATE external_drivers SET ${updates.join(', ')} WHERE id = $${i}`;
      const r = await pool.query(sql, values);

      if (r.rowCount === 0) {
        return res.json({ result: { ok: false, err: 'Nem talalhato.' } });
      }
      return res.json({ result: { ok: true } });
    } catch (err) {
      console.error('extDriverUpdate hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  }

  // KULSO SOFOR TORLES
  if (functionName === 'extDriverDelete') {
    try {
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      }
      const id = parseInt(args[0], 10);
      if (!id) {
        return res.json({ result: { ok: false, err: 'ID kotelezo.' } });
      }
      const r = await pool.query('DELETE FROM external_drivers WHERE id = $1 AND company_id = $2', [id, req.session.user.company_id]);
      if (r.rowCount === 0) {
        return res.json({ result: { ok: false, err: 'Nem talalhato.' } });
      }
      return res.json({ result: { ok: true } });
    } catch (err) {
      console.error('extDriverDelete hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  }
  
  // VALTAS HOZZAADASA (order_legs)
  if (functionName === 'addOrderLeg') {
    try {
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      }
      const orderId = String(args[0] || '').trim();
      const leg = args[1] || {};
      if (!orderId) return res.json({ result: { ok: false, err: 'Fuvar ID kotelezo.' } });
      const orderCheck = await pool.query(
        'SELECT id FROM orders WHERE id = $1 AND company_id = $2',
        [orderId, req.session.user.company_id]
      );
      if (!orderCheck.rows.length) return res.json({ result: { ok: false, err: 'Fuvar nem talalhato vagy nincs jogosultsag.' } });
      const legNumR = await pool.query(
        'SELECT COALESCE(MAX(leg_number), 0) + 1 AS next_num FROM order_legs WHERE order_id = $1',
        [orderId]
      );
      const legNum = legNumR.rows[0].next_num;
      await pool.query(
        `INSERT INTO order_legs
           (order_id, leg_number, sofer_type, email_sofer, nume_sofer, firma_extern,
            rendszam_camion, rendszam_remorca, loc_preluare, data_preluare, company_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          orderId, legNum,
          leg.sofer_type || null, leg.email_sofer || null, leg.nume_sofer || null, leg.firma_extern || null,
          leg.rendszam_camion ? leg.rendszam_camion.toUpperCase() : null,
          leg.rendszam_remorca ? leg.rendszam_remorca.toUpperCase() : null,
          leg.loc_preluare || null, leg.data_preluare || null,
          req.session.user.company_id
        ]
      );
      return res.json({ result: { ok: true, leg_number: legNum } });
    } catch (err) {
      console.error('addOrderLeg hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  }

  // VALTAS TORLESE (order_legs)
  if (functionName === 'deleteOrderLeg') {
    try {
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      }
      const legId = parseInt(args[0], 10);
      if (!legId) return res.json({ result: { ok: false, err: 'Leg ID kotelezo.' } });
      const r = await pool.query(
        `DELETE FROM order_legs
         USING orders
         WHERE order_legs.id = $1
           AND order_legs.order_id = orders.id
           AND orders.company_id = $2`,
        [legId, req.session.user.company_id]
      );
      if (r.rowCount === 0) return res.json({ result: { ok: false, err: 'Nem talalhato vagy nincs jogosultsag.' } });
      return res.json({ result: { ok: true } });
    } catch (err) {
      console.error('deleteOrderLeg hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  }

  // FUVAR MODOSITAS (Admin/Manager)
  if (functionName === 'comUpdate') {
    try {
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      }

      const id = String(args[0] || '').trim();
      const o = args[1] || {};

      if (!id) {
        return res.json({ result: { ok: false, err: 'ID kotelezo.' } });
      }

      const updates = [];
      const values = [];
      let i = 1;

      if (o.client !== undefined) { updates.push(`client = $${i++}`); values.push(o.client); }
      if (o.ref !== undefined) { updates.push(`ref = $${i++}`); values.push(o.ref); }
      if (o.loc_incarcare !== undefined) { updates.push(`loc_incarcare = $${i++}`); values.push(o.loc_incarcare); }
      if (o.loc_descarcare !== undefined) { updates.push(`loc_descarcare = $${i++}`); values.push(o.loc_descarcare); }
      if (o.data_incarcare !== undefined) { updates.push(`data_incarcare = $${i++}`); values.push(o.data_incarcare || null); }
      if (o.data_descarcare !== undefined) { updates.push(`data_descarcare = $${i++}`); values.push(o.data_descarcare || null); }
      if (o.pret !== undefined) { updates.push(`pret = $${i++}`); values.push(Number(o.pret || 0)); }
      if (o.km !== undefined) { updates.push(`km = $${i++}`); values.push(Number(o.km || 0)); }
      if (o.status !== undefined) {
        if (!['Disponibil','Alocat','Extern','In Curs','Finalizat','Anulat'].includes(o.status)) {
          return res.json({ result: { ok: false, err: 'Ervenytelen statusz.' } });
        }
        updates.push(`status = $${i++}`); values.push(o.status);
      }
      if (o.sofer_type !== undefined) { updates.push(`sofer_type = $${i++}`); values.push(o.sofer_type || null); }
      if (o.email_sofer !== undefined) { updates.push(`email_sofer = $${i++}`); values.push(o.email_sofer || null); }
      if (o.nume_sofer !== undefined) { updates.push(`nume_sofer = $${i++}`); values.push(o.nume_sofer || null); }
      if (o.firma_extern !== undefined) { updates.push(`firma_extern = $${i++}`); values.push(o.firma_extern || null); }
      if (o.telefon_extern !== undefined) { updates.push(`telefon_extern = $${i++}`); values.push(o.telefon_extern || null); }
      if (o.rendszam_camion !== undefined) { updates.push(`rendszam_camion = $${i++}`); values.push(o.rendszam_camion ? o.rendszam_camion.toUpperCase() : null); }
      if (o.rendszam_remorca !== undefined) { updates.push(`rendszam_remorca = $${i++}`); values.push(o.rendszam_remorca ? o.rendszam_remorca.toUpperCase() : null); }

      if (updates.length === 0) {
        return res.json({ result: { ok: false, err: 'Nincs mit modositani.' } });
      }

      updates.push(`updated_at = NOW()`);
      values.push(id);
      values.push(req.session.user.company_id);
      const sql = `UPDATE orders SET ${updates.join(', ')} WHERE id = $${i} AND company_id = $${i + 1}`;
      const r = await pool.query(sql, values);

      if (r.rowCount === 0) {
        return res.json({ result: { ok: false, err: 'Fuvar nem talalhato.' } });
      }
      return res.json({ result: { ok: true } });

    } catch (err) {
      console.error('comUpdate hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  }

  // FUVAR TORLES (Admin/Manager)
  if (functionName === 'comDelete') {
    try {
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      }
      const id = String(args[0] || '').trim();
      if (!id) {
        return res.json({ result: { ok: false, err: 'ID kotelezo.' } });
      }
      const check = await pool.query(
        'SELECT id FROM orders WHERE id = $1 AND company_id = $2',
        [id, req.session.user.company_id]
      );
      if (!check.rows.length) {
        return res.json({ result: { ok: false, err: 'Fuvar nem talalhato vagy nincs jogosultsag.' } });
      }
      await pool.query('DELETE FROM order_legs WHERE order_id = $1', [id]);
      const r = await pool.query('DELETE FROM orders WHERE id = $1 AND company_id = $2', [id, req.session.user.company_id]);
      if (r.rowCount === 0) {
        return res.json({ result: { ok: false, err: 'Fuvar nem talalhato.' } });
      }
      return res.json({ result: { ok: true } });
    } catch (err) {
      console.error('comDelete hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  }

  // ============================================
  //  DASHBOARD STATISZTIKA
  // ============================================
  if (functionName === 'dashStats') {
    try {
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      }
      const cid = req.session.user.company_id;

      // Fuvarok statusz szerint
      const statusR = await pool.query(
        `SELECT status, COUNT(*)::int AS db FROM orders WHERE company_id = $1 GROUP BY status`,
        [cid]
      );

      // Havi bevétel (elmúlt 12 hónap)
      const bevR = await pool.query(
        `SELECT TO_CHAR(created_at, 'YYYY-MM') AS ho, SUM(pret)::numeric AS osszeg
         FROM orders WHERE company_id = $1 AND created_at >= NOW() - INTERVAL '12 months'
         GROUP BY ho ORDER BY ho`,
        [cid]
      );

      // Sofőrök km összesítő
      const kmR = await pool.query(
        `SELECT nume_sofer, SUM(km)::numeric AS total_km
         FROM orders WHERE company_id = $1 AND km > 0 AND nume_sofer IS NOT NULL
         GROUP BY nume_sofer ORDER BY total_km DESC LIMIT 10`,
        [cid]
      );

      // Járművek kihasználtsága (hány fuvarhoz rendelték)
      const jarmuR = await pool.query(
        `SELECT rendszam_camion AS rendszam, COUNT(*)::int AS fuvarok
         FROM orders WHERE company_id = $1 AND rendszam_camion IS NOT NULL
         GROUP BY rendszam_camion ORDER BY fuvarok DESC LIMIT 10`,
        [cid]
      );

      // Cég neve
      const cegR = await pool.query('SELECT nev FROM companies WHERE id = $1', [cid]);

      return res.json({ result: {
        ok: true,
        ceg_nev: cegR.rows[0]?.nev || '—',
        statuszok: statusR.rows,
        havi_bevetel: bevR.rows,
        sofor_km: kmR.rows,
        jarmu_kihasznaltsag: jarmuR.rows
      }});
    } catch (err) {
      console.error('dashStats hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  }

  // ============================================
  //  MEGRENDELO DOKUMENTUMOK (Order Documents)
  // ============================================

  // Lista egy fuvarhoz
  if (functionName === 'orderDocList') {
    try {
      if (!req.session.user) return res.json({ result: [] });
      const orderId = String(args[0] || '').trim();
      if (!orderId) return res.json({ result: [] });
      const r = await pool.query(
        `SELECT od.id, od.file_name, od.uploaded_by, od.created_at,
                (od.signed_base64 IS NOT NULL) AS has_signed
         FROM order_documents od
         JOIN orders o ON o.id = od.order_id
         WHERE od.order_id = $1 AND o.company_id = $2
         ORDER BY od.created_at DESC`,
        [orderId, req.session.user.company_id]
      );
      return res.json({ result: r.rows });
    } catch (err) {
      console.error('orderDocList hiba:', err);
      return res.json({ result: [] });
    }
  }

  // Uj megrendelo feltoltese (PDF base64)
  if (functionName === 'orderDocUpload') {
    try {
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      }
      const orderId = String(args[0] || '').trim();
      const fileName = String(args[1] || '').trim();
      const b64 = args[2];
      if (!orderId || !fileName || !b64) {
        return res.json({ result: { ok: false, err: 'Hianyzo adat' } });
      }
      const r = await pool.query(
        `INSERT INTO order_documents (order_id, file_name, original_base64, uploaded_by, company_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [orderId, fileName, b64, req.session.user.nume || req.session.user.email, req.session.user.company_id]
      );
      return res.json({ result: { ok: true, docId: r.rows[0].id } });
    } catch (err) {
      console.error('orderDocUpload hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  }

  // Egy dokumentum lekerese (original | signed)
  if (functionName === 'orderDocGet') {
    try {
      if (!req.session.user) return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      const docId = parseInt(args[0], 10);
      const which = args[1] === 'signed' ? 'signed' : 'original';
      if (!docId) return res.json({ result: { ok: false, err: 'Hianyzo azonosito' } });
      const r = await pool.query(
        `SELECT file_name, original_base64, signed_base64 FROM order_documents WHERE id = $1`,
        [docId]
      );
      if (!r.rows.length) return res.json({ result: { ok: false, err: 'Nem talalhato' } });
      const row = r.rows[0];
      const base64 = which === 'signed' ? row.signed_base64 : row.original_base64;
      if (!base64) return res.json({ result: { ok: false, err: 'Nincs ilyen valtozat' } });
      return res.json({ result: { ok: true, base64, fileName: row.file_name } });
    } catch (err) {
      console.error('orderDocGet hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  }

  // Alairt valtozat mentese
  if (functionName === 'orderDocSaveSigned') {
    try {
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      }
      const docId = parseInt(args[0], 10);
      const b64 = args[1];
      if (!docId || !b64) return res.json({ result: { ok: false, err: 'Hianyzo adat' } });
      const r = await pool.query(
        `UPDATE order_documents SET signed_base64 = $1, updated_at = NOW()
         WHERE id = $2 RETURNING id`,
        [b64, docId]
      );
      if (!r.rows.length) return res.json({ result: { ok: false, err: 'Nem talalhato' } });
      return res.json({ result: { ok: true } });
    } catch (err) {
      console.error('orderDocSaveSigned hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  }

  // ============================================
  //  DEVELOPER VEGPONTOK
  // ============================================
  const isDev = req.session.user && req.session.user.is_dev;

  if (functionName === 'devCompanyList') {
    if (!isDev) return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
    try {
      const r = await pool.query(`
        SELECT c.*,
          (SELECT COUNT(*)::int FROM users u WHERE u.company_id = c.id) AS user_count,
          (SELECT COUNT(*)::int FROM orders o WHERE o.company_id = c.id) AS order_count,
          (SELECT COUNT(*)::int FROM bug_reports b WHERE b.company_id = c.id AND b.is_read = FALSE) AS unread_bugs
        FROM companies c ORDER BY c.created_at DESC
      `);
      return res.json({ result: r.rows });
    } catch (err) { return res.json({ result: [] }); }
  }

  if (functionName === 'devCompanyUpdate') {
    if (!isDev) return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
    try {
      const id = parseInt(args[0], 10);
      const f = args[1] || {};
      const updates = []; const values = []; let i = 1;
      if (f.nev !== undefined) { updates.push(`nev=$${i++}`); values.push(f.nev); }
      if (f.subscription_status !== undefined) { updates.push(`subscription_status=$${i++}`); values.push(f.subscription_status); }
      if (f.paid_until !== undefined) { updates.push(`paid_until=$${i++}`); values.push(f.paid_until || null); }
      if (f.email_contact !== undefined) { updates.push(`email_contact=$${i++}`); values.push(f.email_contact); }
      if (f.telefon !== undefined) { updates.push(`telefon=$${i++}`); values.push(f.telefon); }
      if (f.max_users !== undefined) { updates.push(`max_users=$${i++}`); values.push(parseInt(f.max_users)); }
      if (f.max_trucks !== undefined) { updates.push(`max_trucks=$${i++}`); values.push(parseInt(f.max_trucks)); }
      if (f.igazgato_nev !== undefined) { updates.push(`igazgato_nev=$${i++}`); values.push(f.igazgato_nev); }
      if (!updates.length) return res.json({ result: { ok: false, err: 'Nincs mit modositani' } });
      values.push(id);
      await pool.query(`UPDATE companies SET ${updates.join(',')} WHERE id=$${i}`, values);
      return res.json({ result: { ok: true } });
    } catch (err) { return res.json({ result: { ok: false, err: 'Szerver hiba' } }); }
  }

  if (functionName === 'devCompanyCreate') {
    if (!isDev) return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
    try {
      const f = args[0] || {};
      const r = await pool.query(
        `INSERT INTO companies (nev, subscription_status, paid_until, email_contact, telefon, max_users, max_trucks, igazgato_nev)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [f.nev, f.subscription_status||'active', f.paid_until||null, f.email_contact||null, f.telefon||null, f.max_users||10, f.max_trucks||10, f.igazgato_nev||null]
      );
      const companyId = r.rows[0].id;

      // Auto Admin meghivokod generalas
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let kod = 'VS-';
      for (let i = 0; i < 6; i++) kod += chars.charAt(Math.floor(Math.random() * chars.length));

      await pool.query(
        `INSERT INTO invites (kod, pozicio, email, status, company_id, nume, tel) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [kod, 'Admin', f.email_contact||null, 'Aktiv', companyId]
      );

      if (f.email_contact) {
        sendInviteEmail(f.email_contact, kod, 'Admin', f.nev, f.igazgato_nev||null)
          .catch(e => console.error('Email hatter hiba:', e.message));
      }

      return res.json({ result: { ok: true, id: companyId, invite_kod: kod } });
    } catch (err) { return res.json({ result: { ok: false, err: 'Szerver hiba' } }); }
  }

  if (functionName === 'devCompanyDelete') {
    if (!isDev) return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
    try {
      const id = parseInt(args[0], 10);
      const kod = String(args[1] || '');
      if (kod !== 'vallorsoftcegtorlo1') {
        return res.json({ result: { ok: false, err: 'Helytelen megerosito kod.' } });
      }
      // Cascade torles
      const users = await pool.query('SELECT email FROM users WHERE company_id = $1', [id]);
      const emails = users.rows.map(u => u.email);
      if (emails.length > 0) {
        await pool.query('DELETE FROM border_crossings WHERE email_sofer = ANY($1)', [emails]);
        await pool.query('DELETE FROM documents WHERE email_sofer = ANY($1)', [emails]);
        await pool.query('DELETE FROM fuvarlevelek WHERE email_sofer = ANY($1)', [emails]);
        await pool.query('DELETE FROM stamps WHERE email = ANY($1)', [emails]);
      }
      const orderIds = await pool.query('SELECT id FROM orders WHERE company_id = $1', [id]);
      if (orderIds.rows.length > 0) {
        const oids = orderIds.rows.map(o => o.id);
        await pool.query('DELETE FROM order_documents WHERE order_id = ANY($1)', [oids]);
        await pool.query('DELETE FROM order_legs WHERE order_id = ANY($1)', [oids]);
      }
      await pool.query('DELETE FROM orders WHERE company_id = $1', [id]);
      await pool.query('DELETE FROM invites WHERE company_id = $1', [id]);
      await pool.query('DELETE FROM users WHERE company_id = $1', [id]);
      await pool.query('DELETE FROM companies WHERE id = $1', [id]);
      return res.json({ result: { ok: true } });
    } catch (err) {
      console.error('devCompanyDelete hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  }

  if (functionName === 'devUserList') {
    if (!isDev) return res.json({ result: [] });
    try {
      const r = await pool.query(`
        SELECT u.id, u.nume, u.email, u.pozicio, u.company_id, c.nev AS ceg_nev
        FROM users u LEFT JOIN companies c ON c.id = u.company_id
        ORDER BY c.nev, u.pozicio
      `);
      return res.json({ result: r.rows });
    } catch (err) { return res.json({ result: [] }); }
  }

  // ── HIBAJELENTÉS KÜLDÉSE (minden bejelentkezett user) ──
  if (functionName === 'sendBugReport') {
    try {
      if (!req.session.user) return res.json({ result: { ok: false, err: 'Nincs bejelentkezve.' } });
      const szoveg = String(args[0] || '').trim();
      const oldal  = String(args[1] || '').trim();
      if (!szoveg || szoveg.length < 5) return res.json({ result: { ok: false, err: 'Írj le legalább 5 karaktert!' } });
      if (szoveg.length > 2000) return res.json({ result: { ok: false, err: 'Túl hosszú szöveg (max 2000 karakter).' } });
      await pool.query(
        `INSERT INTO bug_reports (company_id, user_email, user_name, user_role, szoveg, oldal)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [req.session.user.company_id||null, req.session.user.email, req.session.user.nume, req.session.user.pozicio, szoveg, oldal||null]
      );
      return res.json({ result: { ok: true } });
    } catch (err) {
      console.error('sendBugReport hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba.' } });
    }
  }

  // ── HIBAJELENTÉSEK LEKÉRÉSE (dev only) ──
  if (functionName === 'getBugReports') {
    if (!isDev) return res.json({ result: [] });
    try {
      const companyId = args[0] ? parseInt(args[0]) : null;
      const r = companyId
        ? await pool.query(
            `SELECT b.*, c.nev AS ceg_nev FROM bug_reports b
             LEFT JOIN companies c ON c.id = b.company_id
             WHERE b.company_id = $1 ORDER BY b.created_at DESC LIMIT 100`,
            [companyId])
        : await pool.query(
            `SELECT b.*, c.nev AS ceg_nev FROM bug_reports b
             LEFT JOIN companies c ON c.id = b.company_id
             ORDER BY b.created_at DESC LIMIT 200`);
      return res.json({ result: r.rows });
    } catch (err) {
      console.error('getBugReports hiba:', err);
      return res.json({ result: [] });
    }
  }

  // ── HIBAJELENTÉS OLVASOTTNAK JELÖLÉSE (dev only) ──
  if (functionName === 'markBugRead') {
    if (!isDev) return res.json({ result: { ok: false } });
    try {
      const id = parseInt(args[0]);
      await pool.query('UPDATE bug_reports SET is_read = TRUE WHERE id = $1', [id]);
      return res.json({ result: { ok: true } });
    } catch (err) {
      return res.json({ result: { ok: false } });
    }
  }

  // ── CEG RÉSZLETES AKTIVITÁS (dev only) ──
  if (functionName === 'devCompanyDetail') {
    if (!isDev) return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
    try {
      const cid = parseInt(args[0]);
      if (!cid) return res.json({ result: { ok: false, err: 'Hiányzó cég ID.' } });

      const users = await pool.query(`
        SELECT
          u.id, u.nume, u.email, u.pozicio, u.tel,
          (SELECT COUNT(*)::int FROM orders o
           WHERE o.company_id = $1 AND LOWER(o.email_sofer) = LOWER(u.email)) AS fuvarok_kezelt,
          (SELECT COUNT(*)::int FROM fuvarlevelek fl
           WHERE LOWER(fl.email_sofer) = LOWER(u.email)) AS menetlevelek,
          (SELECT COUNT(*)::int FROM documents d
           WHERE LOWER(d.email_sofer) = LOWER(u.email)) AS dokumentumok,
          (SELECT COUNT(*)::int FROM border_crossings b
           WHERE LOWER(b.email_sofer) = LOWER(u.email)) AS hataratlepesek,
          (SELECT MAX(bc.created_at) FROM border_crossings bc
           WHERE LOWER(bc.email_sofer) = LOWER(u.email)) AS utolso_aktiv
        FROM users u
        WHERE u.company_id = $1 AND (u.pozicio_dev IS NOT TRUE)
        ORDER BY u.pozicio, u.nume
      `, [cid]);

      const osszesito = await pool.query(`
        SELECT
          (SELECT COUNT(*)::int FROM orders WHERE company_id = $1) AS osszes_fuvar,
          (SELECT COUNT(*)::int FROM orders WHERE company_id = $1 AND status IN ('In Curs','Alocat')) AS aktiv_fuvar,
          (SELECT COUNT(*)::int FROM fuvarlevelek fl JOIN users u ON LOWER(u.email)=LOWER(fl.email_sofer) WHERE u.company_id=$1) AS osszes_menetlevel,
          (SELECT COUNT(*)::int FROM documents d JOIN users u ON LOWER(u.email)=LOWER(d.email_sofer) WHERE u.company_id=$1) AS osszes_dok,
          (SELECT COUNT(*)::int FROM bug_reports WHERE company_id=$1) AS osszes_hiba,
          (SELECT COUNT(*)::int FROM bug_reports WHERE company_id=$1 AND is_read=FALSE) AS olvasatlan_hiba
      `, [cid]);

      return res.json({ result: { ok: true, users: users.rows, osszesito: osszesito.rows[0] }});
    } catch (err) {
      console.error('devCompanyDetail hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  }

  if (functionName === 'devStats') {
    try {
      const cegek = await pool.query('SELECT COUNT(*)::int AS db FROM companies');
      const userek = await pool.query('SELECT COUNT(*)::int AS db FROM users WHERE pozicio_dev IS NOT TRUE');
      const fuvarok = await pool.query('SELECT COUNT(*)::int AS db FROM orders');
      const aktiv = await pool.query("SELECT COUNT(*)::int AS db FROM companies WHERE subscription_status='active'");
      return res.json({ result: { ok: true,
        cegek: cegek.rows[0].db,
        userek: userek.rows[0].db,
        fuvarok: fuvarok.rows[0].db,
        aktiv_cegek: aktiv.rows[0].db
      }});
    } catch (err) { return res.json({ result: { ok: false } }); }
  }

  // Ismeretlen funkcio
  return res.json({ result: { ok: false, err: 'Ismeretlen funkcio: ' + functionName } });
});


// ============================================================
//  WEB PUSH VEGPONTOK
// ============================================================

// VAPID public key lekeres (frontendnek kell a subscription-hoz)
app.get('/api/push-vapid-key', requireLogin, (req, res) => {
  if (!webpush || !process.env.VAPID_PUBLIC_KEY) {
    return res.json({ ok: false, key: null });
  }
  res.json({ ok: true, key: process.env.VAPID_PUBLIC_KEY });
});

// Subscription mentese / frissitese
app.post('/api/push-subscribe', requireLogin, async (req, res) => {
  try {
    const subscription = req.body.subscription;
    if (!subscription || !subscription.endpoint) {
      return res.json({ ok: false, err: 'Ervenytelen subscription' });
    }
    const email     = req.session.user.email;
    const companyId = req.session.user.company_id;
    const ua        = req.headers['user-agent'] ? req.headers['user-agent'].substring(0, 500) : null;
    
    // endpoint hash az egyedi azonositashoz
    const endpointHash = crypto.createHash('sha256').update(subscription.endpoint).digest('hex');

    // Upsert: ha mar letezik ez az endpoint, frissitjuk
    await pool.query(
      `INSERT INTO push_subscriptions (email, company_id, subscription, user_agent, endpoint_hash, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (endpoint_hash) DO UPDATE
         SET subscription = $3, updated_at = NOW()`,
      [email, companyId, JSON.stringify(subscription), ua, endpointHash]
    );
    return res.json({ ok: true });
  } catch (err) {
    // Ha az UNIQUE constraint nincs endpoint_hash-on, fallback
    try {
      const subscription = req.body.subscription;
      const email     = req.session.user.email;
      const companyId = req.session.user.company_id;
      const ua        = req.headers['user-agent'] ? req.headers['user-agent'].substring(0, 500) : null;
      const endpointHash = crypto.createHash('sha256').update(subscription.endpoint).digest('hex');
      
      // Delete + insert fallback
      await pool.query('DELETE FROM push_subscriptions WHERE endpoint_hash = $1', [endpointHash]);
      await pool.query(
        `INSERT INTO push_subscriptions (email, company_id, subscription, user_agent, endpoint_hash)
         VALUES ($1, $2, $3, $4, $5)`,
        [email, companyId, JSON.stringify(subscription), ua, endpointHash]
      );
      return res.json({ ok: true });
    } catch(err2) {
      console.error('push-subscribe hiba:', err2);
      return res.json({ ok: false, err: 'Szerver hiba' });
    }
  }
});

// Subscription torlese (leiratkozas)
app.post('/api/push-unsubscribe', requireLogin, async (req, res) => {
  try {
    const endpoint = req.body.endpoint;
    if (!endpoint) return res.json({ ok: false });
    const hash = crypto.createHash('sha256').update(endpoint).digest('hex');
    await pool.query('DELETE FROM push_subscriptions WHERE endpoint_hash = $1 AND email = $2',
      [hash, req.session.user.email]);
    return res.json({ ok: true });
  } catch(err) {
    return res.json({ ok: false });
  }
});

// ============================================================
//  BELSO SEGEDLY FUNKCIOK: push uzenet kuldese
// ============================================================

// Kuldj push ertesitest egy adott email-re (vagy email tombnek)
async function sendPushToEmail(emails, payload) {
  if (!webpush) return;
  if (!Array.isArray(emails)) emails = [emails];
  if (!emails.length) return;

  try {
    const placeholders = emails.map((_, i) => '$' + (i + 1)).join(',');
    const r = await pool.query(
      `SELECT id, subscription FROM push_subscriptions WHERE email IN (${placeholders})`,
      emails
    );
    if (!r.rows.length) return;

    const payloadStr = JSON.stringify(payload);
    const sends = r.rows.map(async (row) => {
      try {
        const sub = typeof row.subscription === 'string'
          ? JSON.parse(row.subscription)
          : row.subscription;
        await webpush.sendNotification(sub, payloadStr);
      } catch (err) {
        // 410 Gone = subscription lejart, toroljuk
        if (err.statusCode === 410 || err.statusCode === 404) {
          await pool.query('DELETE FROM push_subscriptions WHERE id = $1', [row.id]);
          console.log('Push subscription torolve (lejart):', row.id);
        } else {
          console.error('Push kuldesi hiba:', err.message);
        }
      }
    });
    await Promise.allSettled(sends);
  } catch(err) {
    console.error('sendPushToEmail hiba:', err);
  }
}

// Push kuldese csoport (company_id + szerepkor) alapjan
async function sendPushToRole(companyId, roles, payload) {
  if (!webpush || !companyId) return;
  if (!Array.isArray(roles)) roles = [roles];
  try {
    const r = await pool.query(
      `SELECT ps.id, ps.subscription FROM push_subscriptions ps
       JOIN users u ON u.email = ps.email
       WHERE ps.company_id = $1 AND u.pozicio = ANY($2)`,
      [companyId, roles]
    );
    if (!r.rows.length) return;
    const payloadStr = JSON.stringify(payload);
    const sends = r.rows.map(async (row) => {
      try {
        const sub = typeof row.subscription === 'string'
          ? JSON.parse(row.subscription)
          : row.subscription;
        await webpush.sendNotification(sub, payloadStr);
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await pool.query('DELETE FROM push_subscriptions WHERE id = $1', [row.id]);
        }
      }
    });
    await Promise.allSettled(sends);
  } catch(err) {
    console.error('sendPushToRole hiba:', err);
  }
}


// CHAT PUSH ERTESITES — frontend hivja uzenet kuldese utan
app.post('/api/chat-notify', requireLogin, async (req, res) => {
  try {
    if (!webpush) return res.json({ ok: false, reason: 'push not configured' });
    
    const { toEmails, toRoles, fromName, text, room, companyId } = req.body;
    const senderEmail = req.session.user.email;
    const senderRole  = req.session.user.pozicio;
    
    // Csak sajat ceg felhasznaloinak kuldjuk
    if (companyId && companyId !== req.session.user.company_id) {
      return res.json({ ok: false, err: 'Nincs jogosultsag' });
    }
    const cid = req.session.user.company_id;
    
    const shortText = text ? text.substring(0, 100) : 'Uj uzenet';
    const senderDisplay = fromName || req.session.user.nume || senderEmail;
    
    const payload = {
      title: '💬 VallorSoft — ' + senderDisplay,
      body:  shortText,
      icon:  '/icon192.png',
      badge: '/icon192.png',
      tag:   'vs-chat-' + (room || 'general'),
      room:  room || null,
      role:  senderRole,
      url:   senderRole === 'Sofer' ? '/sofer' : (senderRole === 'Manager' ? '/manager' : '/admin'),
    };

    // Kuldes email lista alapjan (ha meg van adva)
    if (toEmails && Array.isArray(toEmails) && toEmails.length) {
      const filtered = toEmails.filter(e => e !== senderEmail);
      if (filtered.length) await sendPushToEmail(filtered, payload);
    }
    
    // Kuldes szerepkor alapjan (ha meg van adva)
    if (toRoles && Array.isArray(toRoles) && toRoles.length) {
      // Ne kuldjunk a kuldőnek
      await sendPushToRole(cid, toRoles, payload);
    }

    return res.json({ ok: true });
  } catch(err) {
    console.error('chat-notify hiba:', err);
    return res.json({ ok: false });
  }
});

// ============================================================
//  DRIVER SHIFTS — API VEGPONTOK + SCHEDULER
//  VallorSoft / EU 561/2006 munkaidő-kezelés
//
//  BEILLESZTÉSI PONT: a "// SZERVER INDITAS" komment elé
//
//  Függőségek: pool, webpush, sendPushToEmail (mind meglévő)
//  Új npm csomag: NEM szükséges (setInterval alapú scheduler)
// ============================================================


// ============================================================
//  SEGÉDFÜGGVÉNY: ISO hét kezdőnapja (hétfő, UTC)
//  Visszatér: 'YYYY-MM-DD' string — a week_start_date mezőhöz
// ============================================================
function getWeekStart(date = new Date()) {
  const d = new Date(date);
  const dow = d.getUTCDay();                   // 0=vasárnap … 6=szombat
  const diff = dow === 0 ? -6 : 1 - dow;      // visszalépés hétfőre
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().split('T')[0];        // 'YYYY-MM-DD'
}


// ============================================================
//  POST /api/shift/start — Nap kezdése
//  - Zárolás ellenőrzés (heti 6 műszak utáni 24h)
//  - Dupla start védelme (partial UNIQUE index)
//  - Heti sorszám (shift_index_in_week) számítása
// ============================================================
app.post('/api/shift/start', requireLogin, requireRole('Sofer'), async (req, res) => {
  const driver = req.session.user;
  try {
    // 1. Van-e aktív/nyitott shift? (partial UNIQUE index elkapná DB szinten is,
    //    de szebb üzenettel visszatérünk felette)
    const activeCheck = await pool.query(
      `SELECT shift_id FROM driver_shifts
       WHERE driver_id = $1 AND status IN ('ACTIVE','PAUSED','REST','SCHEDULED')
       LIMIT 1`,
      [driver.id]
    );
    if (activeCheck.rows.length) {
      return res.json({ ok: false, message: 'Már van aktív műszakod. Zárd le előbb a jelenlegi napot.' });
    }

    // 2. Zárolás ellenőrzés (heti 6. nap utáni 24h)
    const lockRow = await pool.query(
      `SELECT locked_until FROM driver_shifts
       WHERE driver_id = $1 AND locked_until IS NOT NULL
       ORDER BY created_at DESC LIMIT 1`,
      [driver.id]
    );
    if (lockRow.rows.length) {
      const lu = lockRow.rows[0].locked_until;
      if (lu && new Date(lu) > new Date()) {
        return res.json({
          ok: false,
          locked: true,
          locked_until: new Date(lu).toISOString(),
          message: `Zárolva (heti 6 munkanap teljesítve). Legkorábban: ${new Date(lu).toLocaleString('hu-HU')} -tól indíthatsz újra.`
        });
      }
    }

    // 3. Heti sorszám kiszámítása
    const weekStart = getWeekStart();
    const weekCount = await pool.query(
      `SELECT COUNT(*)::int AS db FROM driver_shifts
       WHERE driver_id = $1 AND week_start_date = $2 AND day_started_at IS NOT NULL`,
      [driver.id, weekStart]
    );
    const shiftIndex = (weekCount.rows[0].db || 0) + 1;

    // 4. Heti összmunkaidő az eddigi lezárt shiftekből
    const weekHours = await pool.query(
      `SELECT COALESCE(SUM(
         EXTRACT(EPOCH FROM (day_closed_at - day_started_at)) / 3600.0
         - (paused_total_minutes / 60.0)
       ), 0)::numeric(6,2) AS total
       FROM driver_shifts
       WHERE driver_id = $1 AND week_start_date = $2
         AND day_closed_at IS NOT NULL AND day_started_at IS NOT NULL`,
      [driver.id, weekStart]
    );
    const weekTotal = parseFloat(weekHours.rows[0].total) || 0;

    // 5. Új shift létrehozása
    const r = await pool.query(
      `INSERT INTO driver_shifts
         (driver_id, driver_email, company_id, status,
          day_started_at, week_start_date, shift_index_in_week, weekly_hours_total)
       VALUES ($1, $2, $3, 'ACTIVE', NOW(), $4, $5, $6)
       RETURNING shift_id, day_started_at`,
      [driver.id, driver.email, driver.company_id, weekStart, shiftIndex, weekTotal]
    );

    return res.json({
      ok: true,
      shift_id: r.rows[0].shift_id,
      started_at: r.rows[0].day_started_at,
      shift_index: shiftIndex,
      week_hours_so_far: weekTotal
    });
  } catch (err) {
    console.error('[shift/start] hiba:', err);
    return res.json({ ok: false, message: 'Szerver hiba.' });
  }
});


// ============================================================
//  POST /api/shift/pause — Szünet kezdése
//  ACTIVE → PAUSED, rögzíti a paused_at timestamp-et
// ============================================================
app.post('/api/shift/pause', requireLogin, requireRole('Sofer'), async (req, res) => {
  const driver = req.session.user;
  try {
    const shift = await pool.query(
      `SELECT shift_id FROM driver_shifts
       WHERE driver_id = $1 AND status = 'ACTIVE' LIMIT 1`,
      [driver.id]
    );
    if (!shift.rows.length) {
      return res.json({ ok: false, message: 'Nincs aktív műszak.' });
    }
    await pool.query(
      `UPDATE driver_shifts
       SET status='PAUSED', paused_at=NOW(),
           pause_notif_sent_at=NULL, snooze_until=NULL, updated_at=NOW()
       WHERE shift_id = $1`,
      [shift.rows[0].shift_id]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error('[shift/pause] hiba:', err);
    return res.json({ ok: false, message: 'Szerver hiba.' });
  }
});


// ============================================================
//  POST /api/shift/resume — Visszatérés szünetből
//  PAUSED → ACTIVE, szünet percek hozzáadódnak paused_total-hoz
//  Body: {} (nincs adat, a session azonosít)
// ============================================================
app.post('/api/shift/resume', requireLogin, requireRole('Sofer'), async (req, res) => {
  const driver = req.session.user;
  try {
    const shift = await pool.query(
      `SELECT shift_id, paused_at, paused_total_minutes FROM driver_shifts
       WHERE driver_id = $1 AND status = 'PAUSED' LIMIT 1`,
      [driver.id]
    );
    if (!shift.rows.length) {
      return res.json({ ok: false, message: 'Nincs szünetelő műszak.' });
    }
    const s = shift.rows[0];
    const addedMin = s.paused_at
      ? Math.max(0, Math.round((Date.now() - new Date(s.paused_at).getTime()) / 60000))
      : 0;

    await pool.query(
      `UPDATE driver_shifts
       SET status='ACTIVE', paused_at=NULL,
           pause_notif_sent_at=NULL, snooze_until=NULL,
           paused_total_minutes = paused_total_minutes + $1,
           updated_at=NOW()
       WHERE shift_id = $2`,
      [addedMin, s.shift_id]
    );
    return res.json({ ok: true, paused_minutes_added: addedMin });
  } catch (err) {
    console.error('[shift/resume] hiba:', err);
    return res.json({ ok: false, message: 'Szerver hiba.' });
  }
});


// ============================================================
//  POST /api/shift/close — Nap zárása (sofőr manuálisan zárja)
//  ACTIVE | PAUSED → INACTIVE
//  Body: { overtime_reason?: string }
//  - is_overtime flag beállítása ha > 15h
//  - locked_until beállítása ha ez a 6. nap
//  - weekly_hours_total frissítése
// ============================================================
app.post('/api/shift/close', requireLogin, requireRole('Sofer'), async (req, res) => {
  const driver = req.session.user;
  const { overtime_reason } = req.body || {};
  try {
    const shift = await pool.query(
      `SELECT shift_id, day_started_at, paused_total_minutes,
              shift_index_in_week, week_start_date
       FROM driver_shifts
       WHERE driver_id = $1 AND status IN ('ACTIVE','PAUSED') LIMIT 1`,
      [driver.id]
    );
    if (!shift.rows.length) {
      return res.json({ ok: false, message: 'Nincs lezárható műszak.' });
    }
    const s = shift.rows[0];
    const now = new Date();
    const activeHours = (now - new Date(s.day_started_at)) / 3600000
                        - (s.paused_total_minutes || 0) / 60;
    const isOvertime  = activeHours > 15;

    // Heti zárolás: ha ez a 6. (vagy több) nap
    const lockedUntil = s.shift_index_in_week >= 6
      ? new Date(now.getTime() + 24 * 3600 * 1000)
      : null;

    // Heti összmunkaidő frissítése (eddigi lezárt + ez a shift)
    const prevHours = await pool.query(
      `SELECT COALESCE(SUM(
         EXTRACT(EPOCH FROM (day_closed_at - day_started_at)) / 3600.0
         - (paused_total_minutes / 60.0)
       ), 0)::numeric(6,2) AS total
       FROM driver_shifts
       WHERE driver_id = $1 AND week_start_date = $2
         AND day_closed_at IS NOT NULL AND day_started_at IS NOT NULL
         AND shift_id != $3`,
      [driver.id, s.week_start_date, s.shift_id]
    );
    const weeklyTotal = parseFloat(prevHours.rows[0].total || 0) + Math.max(0, activeHours);

    await pool.query(
      `UPDATE driver_shifts
       SET status='INACTIVE', day_closed_at=NOW(),
           is_overtime=$1, overtime_reason=$2,
           locked_until=$3, weekly_hours_total=$4,
           updated_at=NOW()
       WHERE shift_id = $5`,
      [isOvertime, overtime_reason || null, lockedUntil, weeklyTotal.toFixed(2), s.shift_id]
    );

    // Push ha 6. nap → heti zárolás
    if (lockedUntil) {
      await sendPushToEmail([driver.email], {
        title: '🔒 VallorSoft — Heti zárolás aktív',
        body: `6. munkanap kész. Következő indulás: ${lockedUntil.toLocaleString('hu-HU')} után lehetséges.`,
        icon: '/icon192.png', badge: '/icon192.png',
        tag:  'vs-shift-lock',
        url:  '/sofer',
        data: { type: 'weekly_lock' }
      });
    }

    return res.json({
      ok: true,
      is_overtime: isOvertime,
      active_hours: parseFloat(activeHours.toFixed(2)),
      weekly_hours: parseFloat(weeklyTotal.toFixed(2)),
      locked_until: lockedUntil
    });
  } catch (err) {
    console.error('[shift/close] hiba:', err);
    return res.json({ ok: false, message: 'Szerver hiba.' });
  }
});


// ============================================================
//  POST /api/shift/rest — Pihenő beállítása (nap zárása után)
//  INACTIVE (rest_type=NULL) → REST
//  Body: { rest_type: '9h'|'11h'|'24h'|'45h'|'custom'|'vacation',
//          rest_hours?: number }   (custom/vacation esetén kötelező)
//  Visszatér: next_shift_start timestamp
// ============================================================
app.post('/api/shift/rest', requireLogin, requireRole('Sofer'), async (req, res) => {
  const driver = req.session.user;
  const { rest_type, rest_hours } = req.body || {};
  try {
    // A legutóbb lezárt shift ahol még nincs pihenő beállítva
    const shift = await pool.query(
      `SELECT shift_id, day_closed_at FROM driver_shifts
       WHERE driver_id = $1 AND status = 'INACTIVE'
         AND day_closed_at IS NOT NULL AND rest_type IS NULL
       ORDER BY day_closed_at DESC LIMIT 1`,
      [driver.id]
    );
    if (!shift.rows.length) {
      return res.json({ ok: false, message: 'Nincs lezárt (pihenő nélküli) műszak.' });
    }
    const s = shift.rows[0];

    const presetMap = { '9h': 9, '11h': 11, '24h': 24, '45h': 45 };
    const hours = presetMap[rest_type] ?? parseFloat(rest_hours);
    if (!hours || isNaN(hours) || hours <= 0) {
      return res.json({ ok: false, message: 'Érvénytelen pihenő típus vagy óraszám.' });
    }

    const nextShiftStart = new Date(
      new Date(s.day_closed_at).getTime() + hours * 3600 * 1000
    );

    await pool.query(
      `UPDATE driver_shifts
       SET rest_type=$1, rest_hours=$2, next_shift_start=$3,
           status='REST', updated_at=NOW()
       WHERE shift_id = $4`,
      [rest_type, hours, nextShiftStart, s.shift_id]
    );

    return res.json({ ok: true, next_shift_start: nextShiftStart, rest_hours: hours });
  } catch (err) {
    console.error('[shift/rest] hiba:', err);
    return res.json({ ok: false, message: 'Szerver hiba.' });
  }
});


// ============================================================
//  POST /api/shift/snooze-pause — "X óra múlva visszakérdez"
//  Szünet PAUSED állapotban: a sofőr nem indult el, de
//  el akarja halasztani a 48-perces push-t.
//  Body: { snooze_hours: number }  (1, 2, 3, 4, 5 — egész)
// ============================================================
app.post('/api/shift/snooze-pause', requireLogin, requireRole('Sofer'), async (req, res) => {
  const driver = req.session.user;
  const snoozeH = Math.max(1, Math.min(12, parseInt(req.body.snooze_hours) || 1));
  try {
    const shift = await pool.query(
      `SELECT shift_id FROM driver_shifts WHERE driver_id = $1 AND status = 'PAUSED' LIMIT 1`,
      [driver.id]
    );
    if (!shift.rows.length) return res.json({ ok: false });

    const snoozeUntil = new Date(Date.now() + snoozeH * 3600 * 1000);
    await pool.query(
      `UPDATE driver_shifts
       SET snooze_until=$1, pause_notif_sent_at=NULL, updated_at=NOW()
       WHERE shift_id=$2`,
      [snoozeUntil, shift.rows[0].shift_id]
    );
    return res.json({ ok: true, snooze_until: snoozeUntil, snooze_hours: snoozeH });
  } catch (err) {
    console.error('[shift/snooze-pause] hiba:', err);
    return res.json({ ok: false });
  }
});


// ============================================================

//  POST /api/shift/cancel-rest — Pihenő megszüntetése
//  Törli az aktív REST státuszú shift-et -> sofőr elölről kezdhet
app.post('/api/shift/cancel-rest', requireLogin, requireRole('Sofer'), async (req, res) => {
  const user = req.session.user;
  try {
    const r = await pool.query(
      `UPDATE driver_shifts SET status='INACTIVE', updated_at=NOW()
       WHERE driver_id=$1 AND status='REST'
       RETURNING shift_id`,
      [user.id]
    );
    if (!r.rows.length) return res.json({ ok: false, message: 'Nincs aktív pihenő.' });
    return res.json({ ok: true });
  } catch(err) {
    console.error('[shift/cancel-rest]', err);
    return res.json({ ok: false, message: 'Szerver hiba' });
  }
});

//  GET /api/shift/current — Aktuális shift lekérése (UI polling)
//  Visszaadja az élő shif minden adatát, vagy:
//  { shift: null, locked_until } ha nincs élő, de zárolva van
// ============================================================
app.get('/api/shift/current', requireLogin, async (req, res) => {
  const driver = req.session.user;
  try {
    const r = await pool.query(
      `SELECT shift_id, status, day_started_at, day_closed_at,
              paused_at, paused_total_minutes, pause_notif_sent_at, snooze_until,
              rest_type, rest_hours, next_shift_start, notif_sent_at,
              week_start_date, shift_index_in_week,
              weekly_hours_total, locked_until, is_overtime
       FROM driver_shifts
       WHERE driver_id = $1 AND status NOT IN ('INACTIVE')
       ORDER BY created_at DESC LIMIT 1`,
      [driver.id]
    );

    if (r.rows.length) {
      return res.json({ ok: true, shift: r.rows[0] });
    }

    // Nincs élő shift — ellenőrzés: van-e aktív zárolás?
    const lastLock = await pool.query(
      `SELECT locked_until, shift_index_in_week, weekly_hours_total
       FROM driver_shifts
       WHERE driver_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [driver.id]
    );
    return res.json({
      ok: true,
      shift: null,
      locked_until: lastLock.rows[0]?.locked_until || null,
      last_week_hours: lastLock.rows[0]?.weekly_hours_total || 0
    });
  } catch (err) {
    console.error('[shift/current] hiba:', err);
    return res.json({ ok: false, shift: null });
  }
});


// ============================================================
//  GET /api/shift/week-summary — Heti összesítő (Manager + saját)
//  Sofőr: csak saját adatai (driver_id = session user)
//  Manager/Admin: query param ?driver_id=X (saját cég sofőrje)
// ============================================================
app.get('/api/shift/week-summary', requireLogin, async (req, res) => {
  const user = req.session.user;
  try {
    let targetDriverId;

    if (user.pozicio === 'Sofer') {
      targetDriverId = user.id;
    } else if (user.pozicio === 'Manager' || user.pozicio === 'Admin') {
      if (!req.query.driver_id) {
        // Visszaadja az összes sofőr aktuális státuszát (flotta nézet)
        const fleet = await pool.query(
          `SELECT u.id AS driver_id, u.nume, u.email,
                  ds.status, ds.day_started_at, ds.weekly_hours_total,
                  ds.shift_index_in_week, ds.rest_type, ds.next_shift_start,
                  ds.locked_until
           FROM users u
           LEFT JOIN driver_shifts ds ON ds.driver_id = u.id
             AND ds.status NOT IN ('INACTIVE')
           WHERE u.company_id = $1 AND u.pozicio = 'Sofer'
           ORDER BY u.nume`,
          [user.company_id]
        );
        return res.json({ ok: true, fleet: fleet.rows });
      }
      // Jogosultság: csak saját cég sofőrje
      const driverCheck = await pool.query(
        'SELECT id FROM users WHERE id=$1 AND company_id=$2 AND pozicio=$3',
        [parseInt(req.query.driver_id), user.company_id, 'Sofer']
      );
      if (!driverCheck.rows.length) return res.json({ ok: false, message: 'Nincs jogosultság.' });
      targetDriverId = parseInt(req.query.driver_id);
    } else {
      return res.json({ ok: false, message: 'Nincs jogosultság.' });
    }

    const weekStart = getWeekStart();
    const rows = await pool.query(
      `SELECT shift_id, status, day_started_at, day_closed_at,
              paused_total_minutes, rest_type, rest_hours,
              shift_index_in_week, weekly_hours_total,
              is_overtime, locked_until
       FROM driver_shifts
       WHERE driver_id = $1 AND week_start_date = $2
       ORDER BY COALESCE(day_started_at, created_at) ASC`,
      [targetDriverId, weekStart]
    );
    return res.json({ ok: true, week_start: weekStart, shifts: rows.rows });
  } catch (err) {
    console.error('[shift/week-summary] hiba:', err);
    return res.json({ ok: false });
  }
});



app.get('/api/shift/fleet-compliance', requireLogin, requireRole('Manager', 'Admin'), async (req, res) => {
  const user = req.session.user;
  try {
    const cid = user.company_id;
    const weekOffset = Math.max(0, Math.min(52, parseInt(req.query.week_offset, 10) || 0));
    const base = new Date(); base.setUTCDate(base.getUTCDate() - weekOffset * 7);
    const weekStart = getWeekStart(base);
    const fleetRes = await pool.query(
      `SELECT u.id AS driver_id, u.nume, u.email,
              COALESCE(ds.status, 'INACTIVE') AS status,
              ds.day_started_at, ds.paused_at, ds.rest_type,
              ds.next_shift_start, ds.locked_until, ds.is_overtime,
              ds.shift_index_in_week, ds.weekly_hours_total,
              CASE WHEN ds.status = 'ACTIVE' AND ds.day_started_at IS NOT NULL
                   THEN GREATEST(0, EXTRACT(EPOCH FROM (NOW() - ds.day_started_at)) / 3600.0 - COALESCE(ds.paused_total_minutes, 0) / 60.0)
                   ELSE NULL END AS current_active_hours
       FROM users u
       LEFT JOIN LATERAL (
         SELECT * FROM driver_shifts d WHERE d.driver_id = u.id AND d.status <> 'INACTIVE'
         ORDER BY d.updated_at DESC LIMIT 1
       ) ds ON TRUE
       WHERE u.company_id = $1 AND u.pozicio = 'Sofer' ORDER BY u.nume`, [cid]
    );
    const fleet_status = fleetRes.rows.map(r => ({ driver_id:r.driver_id, nume:r.nume, email:r.email, status:r.status, rest_type:r.rest_type, current_active_hours:r.current_active_hours, next_shift_start:r.next_shift_start, shift_index_in_week:r.shift_index_in_week, weekly_hours_total:r.weekly_hours_total, locked_until:r.locked_until, is_overtime:r.is_overtime, paused_at:r.paused_at }));
    const now = Date.now();
    const kpi = { total_drivers:fleet_status.length, active_count:fleet_status.filter(f=>f.status==='ACTIVE').length, paused_count:fleet_status.filter(f=>f.status==='PAUSED').length, rest_count:fleet_status.filter(f=>f.status==='REST'&&f.rest_type!=='vacation').length, vacation_count:fleet_status.filter(f=>f.status==='REST'&&f.rest_type==='vacation').length, locked_count:fleet_status.filter(f=>f.locked_until&&new Date(f.locked_until).getTime()>now).length };
    const compRes = await pool.query(
      `SELECT u.id AS driver_id, u.nume, u.email,
              COALESCE(SUM(CASE WHEN ds.day_started_at IS NOT NULL AND ds.day_closed_at IS NOT NULL THEN GREATEST(0, EXTRACT(EPOCH FROM (ds.day_closed_at - ds.day_started_at)) / 3600.0 - COALESCE(ds.paused_total_minutes, 0) / 60.0) ELSE 0 END), 0) AS weekly_hours,
              COUNT(ds.shift_id) FILTER (WHERE ds.day_started_at IS NOT NULL) AS shifts_count,
              COUNT(ds.shift_id) FILTER (WHERE ds.is_overtime = TRUE) AS overtime_count
       FROM users u LEFT JOIN driver_shifts ds ON ds.driver_id = u.id AND ds.week_start_date = $2
       WHERE u.company_id = $1 AND u.pozicio = 'Sofer' GROUP BY u.id, u.nume, u.email ORDER BY weekly_hours DESC`, [cid, weekStart]
    );
    const compliance = compRes.rows.map(r => ({ driver_id:r.driver_id, nume:r.nume, weekly_hours:parseFloat(r.weekly_hours).toFixed(1), shifts_count:parseInt(r.shifts_count,10), overtime_count:parseInt(r.overtime_count,10) }));
    const restRes = await pool.query(`SELECT ds.rest_type, AVG(ds.rest_hours) AS avg_hours, MIN(ds.rest_hours) AS min_hours, MAX(ds.rest_hours) AS max_hours, COUNT(*) AS db FROM driver_shifts ds JOIN users u ON u.id=ds.driver_id WHERE u.company_id=$1 AND u.pozicio='Sofer' AND ds.rest_type IS NOT NULL AND ds.rest_hours IS NOT NULL AND ds.created_at>=NOW()-INTERVAL '30 days' GROUP BY ds.rest_type`, [cid]);
    const rest_avg = restRes.rows.map(r => ({ rest_type:r.rest_type, avg_hours:parseFloat(r.avg_hours).toFixed(1), min_hours:parseFloat(r.min_hours).toFixed(1), max_hours:parseFloat(r.max_hours).toFixed(1), db:parseInt(r.db,10) }));
    const otRes = await pool.query(`SELECT u.nume, u.email, ds.day_started_at, ds.overtime_reason, CASE WHEN ds.day_closed_at IS NOT NULL AND ds.day_started_at IS NOT NULL THEN EXTRACT(EPOCH FROM (ds.day_closed_at - ds.day_started_at)) / 3600.0 ELSE NULL END AS active_hours FROM driver_shifts ds JOIN users u ON u.id=ds.driver_id WHERE u.company_id=$1 AND u.pozicio='Sofer' AND ds.is_overtime=TRUE AND ds.day_started_at>=NOW()-INTERVAL '14 days' ORDER BY ds.day_started_at DESC LIMIT 50`, [cid]);
    const overtime_alerts = otRes.rows.map(r => ({ nume:r.nume, email:r.email, day_started_at:r.day_started_at, active_hours:r.active_hours!=null?parseFloat(r.active_hours).toFixed(1):'0', overtime_reason:r.overtime_reason }));
    return res.json({ ok:true, week_start:weekStart, kpi, fleet_status, compliance, rest_avg, overtime_alerts });
  } catch(err) { console.error('[shift/fleet-compliance]',err); return res.json({ok:false, message:'Szerver hiba'}); }
});

// ============================================================
//  SHIFT SCHEDULER — 1 perces ciklus (setInterval, 0 extra npm)
//
//  Tick-ek:
//   1. 48 perces szünet push    → PAUSED + paused_at+48m <= NOW()
//   2. Indulás előtti push      → REST/SCHEDULED + next_shift_start-10m <= NOW()
//   3. 11h figyelmeztetés       → ACTIVE + day_started_at+11h <= NOW()
//   4. 15h automatikus zárás    → ACTIVE/PAUSED + day_started_at+15h <= NOW()
//
//  Meghívás: startShiftScheduler() — az app.listen() callback-jéből
// ============================================================
function startShiftScheduler() {
  async function schedulerTick() {
    if (!webpush) return; // Push nélkül nincs értesítő — csendben kihagyjuk

    try {

      // ----------------------------------------------------------
      //  TICK 1 — Szünet értesítő: 48 perc eltelt
      //  Feltétel: PAUSED, 48 perce szünetel, értesítő még nem ment,
      //            és nincs aktív snooze
      // ----------------------------------------------------------
      const paused48 = await pool.query(`
        SELECT shift_id, driver_email
        FROM driver_shifts
        WHERE status = 'PAUSED'
          AND paused_at + INTERVAL '48 minutes' <= NOW()
          AND (pause_notif_sent_at IS NULL
               OR pause_notif_sent_at + INTERVAL '48 minutes' <= NOW())
          AND (snooze_until IS NULL OR snooze_until <= NOW())
      `);
      for (const row of paused48.rows) {
        await sendPushToEmail([row.driver_email], {
          title: '⏰ VallorSoft — Szünet emlékeztető',
          body:  '48 perce szünetel. Elindultál már?',
          icon:  '/icon192.png',
          badge: '/icon192.png',
          tag:   'vs-pause-check-' + row.shift_id,
          url:   '/sofer',
          data:  { type: 'pause_check', shift_id: row.shift_id }
        });
        await pool.query(
          `UPDATE driver_shifts
           SET pause_notif_sent_at=NOW(), snooze_until=NULL, updated_at=NOW()
           WHERE shift_id=$1`,
          [row.shift_id]
        );
        console.log('[Scheduler] TICK1 pause push → shift', row.shift_id);
      }

      // ----------------------------------------------------------
      //  TICK 2 — Indulás előtti értesítő: next_shift_start – 10 perc
      //  Feltétel: REST vagy SCHEDULED, van next_shift_start,
      //            -10 perc kapuban van, értesítő még nem ment
      // ----------------------------------------------------------
      const upcoming = await pool.query(`
        SELECT shift_id, driver_email, next_shift_start
        FROM driver_shifts
        WHERE status IN ('REST','SCHEDULED')
          AND next_shift_start IS NOT NULL
          AND next_shift_start - INTERVAL '10 minutes' <= NOW()
          AND next_shift_start > NOW()
          AND notif_sent_at IS NULL
      `);
      for (const row of upcoming.rows) {
        await sendPushToEmail([row.driver_email], {
          title: '🚛 VallorSoft — Műszak közeleg',
          body:  '10 perc múlva kezdődik a műszakod. Készen állsz?',
          icon:  '/icon192.png',
          badge: '/icon192.png',
          tag:   'vs-shift-soon-' + row.shift_id,
          url:   '/sofer',
          data:  { type: 'shift_upcoming', shift_id: row.shift_id }
        });
        await pool.query(
          `UPDATE driver_shifts SET notif_sent_at=NOW(), updated_at=NOW() WHERE shift_id=$1`,
          [row.shift_id]
        );
        console.log('[Scheduler] TICK2 upcoming push → shift', row.shift_id);
      }

      // ----------------------------------------------------------
      //  TICK 3 — 11 órás munkaidő figyelmeztetés
      //  Feltétel: ACTIVE, 11 óra eltelt, nyitott nap, még nem ment
      // ----------------------------------------------------------
      const warn11 = await pool.query(`
        SELECT shift_id, driver_email
        FROM driver_shifts
        WHERE status = 'ACTIVE'
          AND day_started_at + INTERVAL '11 hours' <= NOW()
          AND day_closed_at IS NULL
          AND warn11h_sent_at IS NULL
      `);
      for (const row of warn11.rows) {
        await sendPushToEmail([row.driver_email], {
          title: '⚠️ VallorSoft — 11 óra aktív',
          body:  '11 órája vezetsz. EU limit: 15 óra. Gondolj a pihenőre!',
          icon:  '/icon192.png',
          badge: '/icon192.png',
          tag:   'vs-warn11h-' + row.shift_id,
          url:   '/sofer',
          data:  { type: 'warn_11h', shift_id: row.shift_id }
        });
        await pool.query(
          `UPDATE driver_shifts SET warn11h_sent_at=NOW(), updated_at=NOW() WHERE shift_id=$1`,
          [row.shift_id]
        );
        console.log('[Scheduler] TICK3 11h warn push → shift', row.shift_id);
      }

      // ----------------------------------------------------------
      //  TICK 4 — 15 óra: automatikus naplezárás
      //  Feltétel: ACTIVE vagy PAUSED, 15 óra eltelt, még nincs day_closed_at
      //  Hatás: INACTIVE, is_overtime=TRUE, locked_until ha 6. nap
      // ----------------------------------------------------------
      const auto15 = await pool.query(`
        SELECT shift_id, driver_email, driver_id,
               shift_index_in_week, week_start_date, paused_total_minutes
        FROM driver_shifts
        WHERE status IN ('ACTIVE','PAUSED')
          AND day_started_at + INTERVAL '15 hours' <= NOW()
          AND day_closed_at IS NULL
      `);
      for (const row of auto15.rows) {
        const now = new Date();
        const lockedUntil = row.shift_index_in_week >= 6
          ? new Date(now.getTime() + 24 * 3600 * 1000)
          : null;

        // Heti összmunkaidő frissítése
        const prevH = await pool.query(
          `SELECT COALESCE(SUM(
             EXTRACT(EPOCH FROM (day_closed_at - day_started_at)) / 3600.0
             - (paused_total_minutes / 60.0)
           ), 0)::numeric(6,2) AS total
           FROM driver_shifts
           WHERE driver_id = $1 AND week_start_date = $2
             AND day_closed_at IS NOT NULL AND shift_id != $3`,
          [row.driver_id, row.week_start_date, row.shift_id]
        );
        // 15h - paused_total_minutes = tényleges aktív
        const thisShiftH = 15 - (row.paused_total_minutes || 0) / 60;
        const weeklyTotal = parseFloat(prevH.rows[0].total || 0) + thisShiftH;

        await pool.query(
          `UPDATE driver_shifts
           SET status='INACTIVE', day_closed_at=NOW(),
               is_overtime=TRUE,
               overtime_reason='Automatikus zárás — EU 561/2006 15h napi limit elérve',
               locked_until=$1, weekly_hours_total=$2, updated_at=NOW()
           WHERE shift_id=$3`,
          [lockedUntil, weeklyTotal.toFixed(2), row.shift_id]
        );

        await sendPushToEmail([row.driver_email], {
          title: '⛔ VallorSoft — Nap automatikusan lezárva',
          body:  '15 óra EU limit elérve. Válassz pihenő típust a sofer oldalon!',
          icon:  '/icon192.png',
          badge: '/icon192.png',
          tag:   'vs-auto15h-' + row.shift_id,
          url:   '/sofer',
          data:  { type: 'auto_close_15h', shift_id: row.shift_id }
        });

        if (lockedUntil) {
          await sendPushToEmail([row.driver_email], {
            title: '🔒 VallorSoft — Heti zárolás aktív',
            body:  `6. munkanap teljesítve. Legközelebb: ${lockedUntil.toLocaleString('hu-HU')} után indíthatsz.`,
            icon:  '/icon192.png',
            badge: '/icon192.png',
            tag:   'vs-weekly-lock-' + row.shift_id,
            url:   '/sofer',
            data:  { type: 'weekly_lock' }
          });
        }
        console.log('[Scheduler] TICK4 auto-close 15h → shift', row.shift_id, '| locked_until:', lockedUntil);
      }

    } catch (err) {
      // Scheduler hiba NEM állítja le a szervert — csak naplózza
      console.error('[Shift Scheduler] tick hiba:', err.message);
    }
  }

  // Azonnali első futás (szerver újraindítás utáni „elmaradt" tickek kezelése),
  // majd 60 másodpercenként
  schedulerTick();
  const interval = setInterval(schedulerTick, 60 * 1000);
  console.log('[Shift Scheduler] Elindítva — 1 perces ciklus');
  return interval; // visszaadja az intervallt (tesztekhez / graceful shutdown)
}



// ── Gyors státusz (Admin / Manager) ──────────────────────
app.post('/api/orders/:id/quick-status', requireLogin, requireRole('Admin','Manager'), async (req, res) => {
  const { status } = req.body;
  const valid = ['Disponibil','Alocat','Extern','In Curs','Finalizat','Anulat'];
  if (!valid.includes(status)) return res.json({ ok: false, err: 'Érvénytelen státusz' });
  try {
    const r = await pool.query(
      'UPDATE orders SET status=$1, updated_at=NOW() WHERE id=$2 AND company_id=$3',
      [status, req.params.id, req.session.user.company_id]
    );
    if (r.rowCount === 0) return res.json({ ok: false, err: 'Fuvar nem található' });
    return res.json({ ok: true });
  } catch(err) {
    console.error('quick-status hiba:', err);
    return res.json({ ok: false, err: 'Szerver hiba' });
  }
});

// ── Sofőr státusz frissítés + push visszajelzés ───────────
//  POST /api/orders/:id/driver-status
//  Csak Sofőr role — csak 'In Curs' vagy 'Finalizat'
// ============================================================
app.post('/api/orders/:id/driver-status', requireLogin, requireRole('Sofer'), async (req, res) => {
  const { status } = req.body;
  const driver = req.session.user;
  if (!['In Curs', 'Finalizat'].includes(status)) {
    return res.json({ ok: false, err: 'Érvénytelen státusz' });
  }
  try {
    const check = await pool.query(
      `SELECT id, client FROM orders
       WHERE id = $1 AND company_id = $2 AND LOWER(email_sofer) = LOWER($3)`,
      [req.params.id, driver.company_id, driver.email]
    );
    if (!check.rows.length) {
      return res.json({ ok: false, err: 'Nem található vagy nincs jogosultság' });
    }
    await pool.query(
      'UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2',
      [status, req.params.id]
    );
    // Push értesítés a Manager / Admin szerepkörűeknek
    const label = status === 'In Curs' ? 'elfogadta' : 'teljesítette';
    const clientName = check.rows[0].client || ('#' + req.params.id);
    await sendPushToRole(driver.company_id, ['Manager', 'Admin'], {
      title: '🚛 Fuvar státusz frissítve',
      body: (driver.nume || driver.email) + ' ' + label + ': ' + clientName,
      icon: '/icon192.png',
      badge: '/icon192.png',
      tag: 'order-status-' + req.params.id,
      url: '/manager',
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error('driver-status hiba:', err);
    return res.json({ ok: false, err: 'Szerver hiba' });
  }
});

// SZERVER INDITAS
var PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Szerver fut a http://localhost:' + PORT + ' cimen');
});