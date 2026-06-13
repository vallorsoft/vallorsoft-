// ============================================================
//  VallorSoft — lib/logger.js
//  Könnyű, függőség nélküli strukturált logger.
//   - Alapból ember-olvasható sorok (fejlesztéshez).
//   - LOG_FORMAT=json (vagy NODE_ENV=production) → egysoros JSON,
//     amit a log-aggregátorok (Loki/CloudWatch/Datadog) parse-olnak.
//   - LOG_LEVEL=debug|info|warn|error (alap: info) — küszöb.
//  A meglévő `console.*` hívásokat NEM váltja le; additív.
// ============================================================
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function minLevel() {
  return LEVELS[String(process.env.LOG_LEVEL || 'info').toLowerCase()] || LEVELS.info;
}
function jsonMode() {
  return String(process.env.LOG_FORMAT || '').toLowerCase() === 'json'
    || process.env.NODE_ENV === 'production';
}

// Tiszta (oldal-hatás nélküli) rekord-építő — könnyen tesztelhető.
function buildRecord(level, msg, fields) {
  const rec = { t: new Date().toISOString(), level: level, msg: String(msg == null ? '' : msg) };
  if (fields && typeof fields === 'object') {
    for (const k of Object.keys(fields)) {
      if (k !== 't' && k !== 'level' && k !== 'msg') rec[k] = fields[k];
    }
  }
  return rec;
}

function formatRecord(rec) {
  if (jsonMode()) return JSON.stringify(rec);
  const extra = Object.keys(rec).filter((k) => k !== 't' && k !== 'level' && k !== 'msg')
    .reduce((o, k) => { o[k] = rec[k]; return o; }, {});
  const tail = Object.keys(extra).length ? ' ' + JSON.stringify(extra) : '';
  return '[' + rec.t + '] ' + rec.level.toUpperCase() + ' ' + rec.msg + tail;
}

function emit(level, msg, fields) {
  if ((LEVELS[level] || 0) < minLevel()) return null;
  const rec = buildRecord(level, msg, fields);
  const line = formatRecord(rec);
  (level === 'error' || level === 'warn' ? console.error : console.log)(line);
  return rec;
}

module.exports = {
  debug: (m, f) => emit('debug', m, f),
  info: (m, f) => emit('info', m, f),
  warn: (m, f) => emit('warn', m, f),
  error: (m, f) => emit('error', m, f),
  // tesztelhető belső darabok:
  buildRecord,
  formatRecord,
  LEVELS,
};
