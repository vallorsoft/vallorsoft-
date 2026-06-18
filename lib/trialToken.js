// ============================================================
//  VallorSoft — Trial/előfizetés-választó HMAC token (KÖZÖS helper)
//  Egy helyen, hogy a link-generálás (scheduler) és az ellenőrzés
//  (routes/trial-select.js) SOHA ne csússzon szét. Teljes HMAC-SHA256
//  digest (nem csonkolt) — a korábbi 16 hex (64 bit) túl gyenge volt.
// ============================================================
const crypto = require('crypto');

function makeTrialToken(cid, planId, billing) {
  const secret = process.env.SESSION_SECRET || 'dev-secret';
  return crypto.createHmac('sha256', secret)
    .update(`${cid}:${planId}:${billing}`)
    .digest('hex');
}

// Előfizetés-újraaktiváló ("M-am răzgândit") token — a lemondás időpontjához
// (epoch másodperc) kötve, így újraaktiválás (cancel_at törlése) után a régi
// link érvénytelenné válik (gyakorlatilag egyszer használatos lemondásonként).
function makeReactivateToken(cid, cancelAtSec) {
  const secret = process.env.SESSION_SECRET || 'dev-secret';
  return crypto.createHmac('sha256', secret)
    .update(`reactivate:${cid}:${cancelAtSec}`)
    .digest('hex');
}

module.exports = { makeTrialToken, makeReactivateToken };
