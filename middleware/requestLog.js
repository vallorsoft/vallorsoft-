// ============================================================
//  VallorSoft — middleware/requestLog.js
//  Strukturált kérés-naplózás (lib/logger). Minden API-/oldal-kérésre
//  egy sort ír a válasz lezárásakor: metódus, útvonal, státusz, idő (ms),
//  kérés-azonosító. A statikus fájlokat NEM naplózza (azokat az
//  express.static már a middleware ELŐTT kiszolgálja), a health-check
//  végpontokat pedig kihagyja, hogy ne spammelje a logot.
// ============================================================
const crypto = require('crypto');
const log = require('../lib/logger');

module.exports = function requestLog(req, res, next) {
  if (req.path === '/healthz' || req.path === '/readyz') return next();
  const start = process.hrtime.bigint();
  // A teljes útvonalat a BELÉPÉSKOR rögzítjük (req.originalUrl) — a routing
  // (pl. app.use('/api', …) mount) közben a req.path mutálódhat, a finish
  // pedig később fut, így ott már a levágott út látszana.
  const reqPath = String(req.originalUrl || req.url || req.path || '').split('?')[0];
  req.id = (req.headers['x-request-id'] && String(req.headers['x-request-id']).slice(0, 64))
    || crypto.randomBytes(6).toString('hex');
  res.setHeader('X-Request-Id', req.id);
  res.on('finish', () => {
    const ms = Math.round(Number(process.hrtime.bigint() - start) / 1e6);
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    log[level]('http', { id: req.id, m: req.method, path: reqPath, status: res.statusCode, ms: ms });
  });
  next();
};
