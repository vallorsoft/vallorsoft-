// services/gps/fomco-et.js
// GPS-adapter — Fomco GPS (román, Ecomotive-alapú; NEM FM-Track). Külön platform, külön API.
//
// STÁTUSZ: a Fomcónak nincs publikus API-dokumentációja — a hozzáférést/doksit tőlük kell
// bekérni (suport@fomcogps.ro). Amíg ez nincs meg, ez az adapter "kézi/rögzítő" módban fut:
// a UIT-okat és állapotukat ugyanúgy kezeljük, csak a tényleges GPS→ANAF küldést a Fomco/ANAF
// appból végzik. Amint megvan a Fomco API-doksi, ide kerül a valódi hívás — a route és a
// felület változatlan (a közös interfész miatt).

function manual(actionLabel) {
  return { ok: true, mode: 'manual',
    message: 'Înregistrat. API-ul Fomco e-Transport încă nu este conectat (documentație: suport@fomcogps.ro). ' +
             actionLabel + ' se face din aplicația Fomco/ANAF.' };
}

async function assignUit(_cfg, _args)   { return manual('Pornirea'); }
async function unassignUit(_cfg, _args) { return manual('Oprirea'); }

module.exports = { provider: 'fomco', label: 'Fomco GPS', assignUit, unassignUit };
