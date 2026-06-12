// ============================================================
//  VallorSoft — server.js  (Fázis 1: moduláris felépítés)
//  Csak inicializálás + middleware + route-ok mountolása.
//  Az üzleti logika a routes/, handlers/, services/ mappákban.
// ============================================================
require('dotenv').config();

const express      = require('express');
const path         = require('path');
const session      = require('express-session');
const pgSession    = require('connect-pg-simple')(session);
const cookieParser = require('cookie-parser');
const pool         = require('./db');

// ===== BIZTONSAG: helmet + rate-limit (opcionalis) =====
let helmet, rateLimit;
try { helmet = require('helmet'); } catch (e) { helmet = null; console.warn('helmet nincs telepitve'); }
try { rateLimit = require('express-rate-limit'); } catch (e) { rateLimit = null; console.warn('express-rate-limit nincs telepitve'); }

const app = express();
app.set('trust proxy', 1); // Render / reverse proxy mogotti HTTPS session fix

// ===== GLOBÁLIS VÉDŐHÁLÓ: kezeletlen promise-hibák ne állítsák le a szervert =====
process.on('unhandledRejection', (reason) => {
  console.error('Kezeletlen promise-hiba (a szerver tovább fut):', reason);
});

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
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
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
        frameSrc: ["'self'"],            // menetlevél PDF in-app nézet (azonos eredetű iframe)
        frameAncestors: ["'self'"],      // a PDF-oldal csak azonos eredetből ágyazható
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
    frameguard: { action: 'sameorigin' }, // azonos eredetű iframe engedett (PDF in-app nézet); idegen klikk-elrablás tiltva
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
  const twofaLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 perc
    max: 10,
    message: { success: false, message: 'Tul sok 2FA-kod probalkozas. Probald ujra 15 perc mulva.' },
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api/login', loginLimiter);
  app.use('/api/portal/login', loginLimiter);
  app.use('/api/carrier/login', loginLimiter);
  app.use('/api/forgot-password', forgotLimiter);
  // A helyes jelszó utáni TOTP-kód másképp brute-force-olható lenne (6 számjegy, window:2)
  app.use('/api/2fa/verify', twofaLimiter);
  app.use('/api/2fa/setup-verify', twofaLimiter);
  app.use('/api/2fa/settings-verify', twofaLimiter);
}

// 20 MB elég a dokumentum-feltöltésekhez (base64 ~15 MB-os fájl); az 50 MB-os
// limit mellett pár párhuzamos kérés kifektethette volna az 512 MB-os példányt.
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ limit: '20mb', extended: true }));

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

// ===== ROUTE-OK MOUNTOLASA =====
app.use(require('./routes/firebase'));
app.use(require('./routes/pages'));
app.use(require('./routes/auth'));
app.use(require('./routes/soferApi'));
app.use(require('./routes/execute'));
app.use(require('./routes/push'));
app.use(require('./routes/ordersRest'));

// ===== INTEGRACIOK (Ugyfelek / CargoTrack GPS / Szamlazas) =====
app.use(require('./routes/clients'));
app.use(require('./routes/cargotrack'));
app.use(require('./routes/invoices'));
app.use(require('./routes/track'));
app.use(require('./routes/portal'));
app.use(require('./routes/carrier-portal'));
app.use(require('./routes/accounting'));
app.use(require('./routes/uit'));
app.use(require('./routes/inbound-orders'));
app.use(require('./routes/client-mail'));

// E-mail intake (beérkező megrendelések) — csak akkor fut, ha az INTAKE_IMAP_* be van állítva.
const { startIntakeScheduler, startExpiryScheduler, startGpsMileageScheduler, startMonthlyReportScheduler } = require('./services/scheduler');
startIntakeScheduler();
startExpiryScheduler();
startGpsMileageScheduler();
startMonthlyReportScheduler();

// (megtartva az eredetibol; jelenleg nincs hasznalatban)
const getNowStr = () => new Date().toISOString().replace('T', ' ').substring(0, 19);

// ===== DB MIGRÁCIÓ-FUTTATÓ (séma-drift ellen, indításkor) =====
// Managed DB-ken (Neon) a migrációk kézi futtatása könnyen kimarad — ezért
// minden db/*.sql migráció pontosan EGYSZER lefut, az eredményt a
// schema_migrations tábla rögzíti. A migrációk idempotensek, de néhány
// szándékosan destruktív lépést is tartalmaznak (pl. oszlop-eltávolítás),
// ezért nem futtatjuk őket minden indulásnál újra. Két menet fut, hogy a
// fájlnév-sorrendből adódó függőségek (pl. uit-anaf-confirm a uit-migration
// előtt) ugyanazon induláson belül feloldódjanak. Hiba NEM állítja meg a
// szervert — csak naplózódik, és a következő indulásnál újrapróbálódik.
const fs = require('fs');
(async () => {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMP DEFAULT NOW()
    )`);
    const dir = path.join(__dirname, 'db');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    for (let pass = 1; pass <= 2; pass++) {
      for (const f of files) {
        const done = await pool.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [f]);
        if (done.rows.length) continue;
        try {
          await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
          await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING', [f]);
          console.log(`Migráció lefuttatva: ${f}`);
        } catch (e) {
          if (pass === 2) console.error(`Migráció hiba (${f}) — kihagyva, a szerver tovább indul:`, e.message);
        }
      }
    }
  } catch (e) {
    console.error('Migráció-futtató hiba (a szerver tovább indul):', e.message);
  }
})();

// ===== SZERVER INDITAS =====
var PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Szerver fut a http://localhost:' + PORT + ' cimen');
});
