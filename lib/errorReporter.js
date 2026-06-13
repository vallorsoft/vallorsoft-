// ============================================================
//  VallorSoft — lib/errorReporter.js
//  OPCIONÁLIS hibamonitorozás (Sentry). A helmet/rate-limit mintát
//  követi: a @sentry/node csak akkor kell, ha telepítve VAN és a
//  SENTRY_DSN be van állítva — különben minden hívás no-op.
//  Így nincs kötelező nehéz függőség, és kulcs nélkül semmi nem fut.
// ============================================================
let Sentry = null;
try { Sentry = require('@sentry/node'); } catch (e) { Sentry = null; }

let enabled = false;

function init() {
  if (enabled) return true;
  if (Sentry && process.env.SENTRY_DSN) {
    try {
      Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.NODE_ENV || 'development',
        tracesSampleRate: 0, // csak hiba-jelentés, nem teljesítmény-trace
      });
      enabled = true;
    } catch (e) {
      enabled = false;
    }
  }
  return enabled;
}

// Biztonságos: ha nincs Sentry/DSN, csendben false-t ad (nem dob).
function capture(err, context) {
  if (!enabled || !Sentry) return false;
  try {
    Sentry.captureException(err, context && typeof context === 'object' ? { extra: context } : undefined);
    return true;
  } catch (e) {
    return false;
  }
}

function isEnabled() { return enabled; }
function available() { return !!Sentry; }

module.exports = { init, capture, isEnabled, available };
