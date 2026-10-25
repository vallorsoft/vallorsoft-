// ============================================================
//  VallorSoft — lib/orderToll.js
//  Egy fuvar útdíjának kiszámolása az útvonalából — KÖZÖS mag a
//  fuvar-szerkesztő 🛣️ becslésének (handlers/toll.js estimateToll) és a
//  Költség-kalkulátor több-fuvaros útdíj-számításának.
//  Útvonal: a mentett route_geo waypointjai, különben felrakó → lerakó.
//  „Pontos" mód: HERE Routing v8 (ha a cégnek van HERE-kulcsa), minden
//  hiba/kulcs-hiány esetén visszaesés az ingyenes ország-km becslésre.
//  Nem ír semmit — a mentésről a hívó dönt.
// ============================================================
const { estimateFromPolyline } = require('./tollEstimate');
const { estimateRoute } = require('./routeEstimate');
const tollProvider = require('./tollProvider');
const maps = require('./mapsProvider');

function orderWaypoints(o) {
  let rg = o.route_geo;
  if (typeof rg === 'string') { try { rg = JSON.parse(rg); } catch (_) { rg = null; } }
  if (rg && Array.isArray(rg.waypoints) && rg.waypoints.length >= 2) {
    return rg.waypoints.map((w) => ({ type: w.type, address: w.address, lat: w.lat, lng: w.lng }));
  }
  if (!o.loc_incarcare || !o.loc_descarcare) return null;
  return [{ type: 'loading', address: o.loc_incarcare }, { type: 'unloading', address: o.loc_descarcare }];
}

// o: { loc_incarcare, loc_descarcare, route_geo }
// → { toll, km, source:'here'|'estimate', preciseError }
// Hibánál (nincs cím / nem tervezhető útvonal) RO üzenetű Error-t dob.
async function computeOrderToll(cid, o, opts) {
  const waypoints = orderWaypoints(o);
  if (!waypoints) {
    throw new Error('Introdu adresa de incarcare si descarcare (sau calculeaza km pe harta) pentru estimarea taxei de drum.');
  }
  let est;
  try { est = await estimateRoute(waypoints, cid); }
  catch (e) { throw new Error('Ruta nu poate fi calculata: ' + ((e && e.message) || '')); }

  const precise = !!(opts && opts.precise);
  let preciseError = null;
  if (precise) {
    try {
      const cfg = await maps.getConfig(cid);
      if (cfg.vendor === 'here' && cfg.key) {
        const ht = await tollProvider.hereToll(est.waypoints, cfg.key);
        maps.bump(cid, 'here');
        return { toll: ht, km: est.km, source: 'here', preciseError: null };
      }
      preciseError = 'no-here-key';
    } catch (e) {
      preciseError = (e && e.message) || 'here-error';
    }
  }
  const toll = await estimateFromPolyline(cid, est.polyline);
  return { toll, km: est.km, source: 'estimate', preciseError };
}

module.exports = { computeOrderToll, orderWaypoints };
