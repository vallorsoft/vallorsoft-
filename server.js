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
app.use(require('./routes/uit'));
app.use(require('./routes/inbound-orders'));
app.use(require('./routes/client-mail'));

// E-mail intake (beérkező megrendelések) — csak akkor fut, ha az INTAKE_IMAP_* be van állítva.
const { startIntakeScheduler } = require('./services/scheduler');
startIntakeScheduler();

// (megtartva az eredetibol; jelenleg nincs hasznalatban)
const getNowStr = () => new Date().toISOString().replace('T', ' ').substring(0, 19);

// ===== SZERVER INDITAS =====
var PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Szerver fut a http://localhost:' + PORT + ' cimen');
});
