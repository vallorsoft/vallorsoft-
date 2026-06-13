// ============================================================
//  VallorSoft — lib/stripe.js
//  OPCIONÁLIS Stripe-kliens (önkiszolgáló előfizetés VÁZ). A helmet/
//  Sentry mintát követi: a `stripe` csomag csak akkor kell, ha telepítve
//  VAN és a STRIPE_SECRET_KEY be van állítva — különben minden no-op.
//  Így teszt-kulccsal azonnal él, kulcs nélkül semmi nem fut.
// ============================================================
let Stripe = null;
try { Stripe = require('stripe'); } catch (e) { Stripe = null; }

let _client = null;

function available() { return !!Stripe; }
function isConfigured() { return !!(Stripe && process.env.STRIPE_SECRET_KEY); }

function client() {
  if (!isConfigured()) return null;
  if (!_client) {
    try { _client = Stripe(process.env.STRIPE_SECRET_KEY); } catch (e) { _client = null; }
  }
  return _client;
}

module.exports = { available, isConfigured, client };
