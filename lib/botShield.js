// ============================================================
//  VallorSoft — lib/botShield.js
//  Bot- / túlterhelés-védelem (a server.js köti be):
//   1) bodyParsers   — a nagy (20 MB-os) kérés-törzset CSAK bejelentkezett
//                      munkamenet kapja; névtelen kérés max. 200 KB. Így egy
//                      bot nem tud 20 MB-os kérésekkel memóriát enni.
//   2) apiRateLimit  — általános kérés-korlát a dinamikus útvonalakra:
//                      bejelentkezve felhasználónként, névtelenül IP-nként.
//                      (Gépenként számol — több Fly-gépnél ennyiszeres.)
//   3) staticCache   — böngésző-gyorsítótár a ?v= verziózott JS/CSS-re.
//  A statikus fájlok és a /healthz a korlát ELŐTT szolgálódnak ki.
// ============================================================
const express = require('express');

let rateLimit = null, ipKeyGenerator = null;
try {
  const m = require('express-rate-limit');
  rateLimit = m.rateLimit || m.default || m;
  ipKeyGenerator = m.ipKeyGenerator || null;
} catch (_) { /* nincs telepítve → korlát nélkül fut */ }

const IS_TEST = process.env.NODE_ENV === 'test';

// Küszöbök (env-ből felülírhatók). Egy dolgozó admin-oldal betöltése ~30–60
// RPC, utána percenként néhány — a 600/perc bőven fedez; egy bot viszont
// 10+ kérés/mp-nél 429-et kap.
const USER_PER_MIN = parseInt(process.env.RATE_LIMIT_USER_PER_MIN || '600', 10);
const ANON_PER_MIN = parseInt(process.env.RATE_LIMIT_ANON_PER_MIN || '120', 10);
const TRACK_PER_MIN = parseInt(process.env.RATE_LIMIT_TRACK_PER_MIN || '30', 10);

function sessionKey(req) {
  const s = req.session || {};
  if (s.user && s.user.id) return 'u:' + s.user.id;
  if (s.clientUser && s.clientUser.id) return 'c:' + s.clientUser.id;
  if (s.carrierUser && s.carrierUser.id) return 'k:' + s.carrierUser.id;
  return null;
}
function ipKey(req) {
  const ip = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
  return 'ip:' + (ipKeyGenerator ? ipKeyGenerator(ip) : ip);
}

const LIMIT_MSG = { success: false, message: 'Prea multe cereri. Vă rugăm să încercați din nou peste un minut.' };

function makeLimiter(max, keyFn, skip) {
  if (!rateLimit || IS_TEST) return (req, res, next) => next();
  return rateLimit({
    windowMs: 60 * 1000,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: keyFn,
    skip: skip,
    message: LIMIT_MSG,
    // Az IPv6/trust-proxy validációt a saját kulcs-függvényünk kezeli.
    validate: { keyGeneratorIpFallback: false, trustProxy: false, xForwardedForHeader: false },
  });
}

const userLimiter = makeLimiter(USER_PER_MIN, (req) => sessionKey(req), (req) => !sessionKey(req));
const anonLimiter = makeLimiter(ANON_PER_MIN, ipKey, (req) => !!sessionKey(req));
// A publikus követő-oldal geokódol + DB-t olvas → szigorúbb, IP-nként.
const trackLimiter = makeLimiter(TRACK_PER_MIN, ipKey);

function apiRateLimit(req, res, next) {
  const p = req.path || '';
  const run = (mw, cb) => mw(req, res, (err) => (err ? next(err) : cb()));
  const general = () => run(userLimiter, () => run(anonLimiter, next));
  if (p.indexOf('/api/track/') === 0 || p.indexOf('/t/') === 0) return run(trackLimiter, general);
  return general();
}

// ── Kérés-törzs: nagy limit csak bejelentkezve ──
const jsonBig = express.json({ limit: '20mb' });
const urlBig = express.urlencoded({ limit: '20mb', extended: true });
const jsonSmall = express.json({ limit: '200kb' });
const urlSmall = express.urlencoded({ limit: '200kb', extended: true });

function bodyParsers(req, res, next) {
  const big = !!sessionKey(req);
  const j = big ? jsonBig : jsonSmall;
  const u = big ? urlBig : urlSmall;
  j(req, res, (err) => (err ? next(err) : u(req, res, next)));
}

// ── Böngésző-gyorsítótár a statikus fájlokra ──
// ?v=… verziózott JS/CSS: 1 nap (a verzió-csere azonnal frissít; ha egyszer
// elmaradna a csere, legfeljebb 1 napig marad régi). Minden más (HTML, sw.js,
// verzió nélküli fájl): ETag-alapú újraellenőrzés, mint eddig.
function staticCache(req, res, next) {
  if ((req.method === 'GET' || req.method === 'HEAD') && req.query && req.query.v && /\.(js|css)$/i.test(req.path)) {
    res.setHeader('Cache-Control', 'public, max-age=86400');
  } else {
    res.setHeader('Cache-Control', 'no-cache');
  }
  next();
}

module.exports = { apiRateLimit, bodyParsers, staticCache, _sessionKey: sessionKey };
