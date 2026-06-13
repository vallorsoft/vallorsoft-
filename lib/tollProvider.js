// ============================================================
//  VallorSoft — lib/tollProvider.js
//  Valós útdíj a HERE Routing v8-ból (transportMode=truck, return=tolls).
//  CSAK akkor hívódik, ha a cégnek van HERE-kulcsa (mapsProvider) ÉS a
//  felhasználó a „Pontos" váltót bekapcsolta. Hiba/kulcs hiánya esetén a
//  hívó visszaesik az ingyenes becslésre.
// ============================================================

// A HERE válasz toll-szakaszaiból összegzi a díjat. Tollonként a
// LEGOLCSÓBB fizetési mód (fares) számít — a HERE több fare-t adhat
// ugyanarra a kapura (készpénz/transzponder), ezeket NEM adjuk össze.
function parseHereToll(data) {
  let total = 0;
  let currency = 'EUR';
  const byCountry = {};
  const route = data && data.routes && data.routes[0];
  const sections = (route && route.sections) || [];
  sections.forEach((sec) => {
    (sec.tolls || []).forEach((toll) => {
      const fares = toll.fares || [];
      if (!fares.length) return;
      let best = null;
      fares.forEach((f) => {
        const v = f.price && f.price.value != null ? parseFloat(f.price.value) : 0;
        if (f.price && f.price.currency) currency = f.price.currency;
        if (best == null || v < best) best = v;
      });
      const cost = best || 0;
      total += cost;
      const cc = toll.countryCode || '??';
      byCountry[cc] = (byCountry[cc] || 0) + cost;
    });
  });
  const breakdown = Object.keys(byCountry).map((cc) => ({ country: cc, cost: Math.round(byCountry[cc] * 100) / 100 }));
  return { total: Math.round(total * 100) / 100, currency: currency, breakdown: breakdown, source: 'here' };
}

async function hereToll(waypoints, key) {
  const pts = (waypoints || []).filter((w) => w && w.lat != null && w.lng != null);
  if (pts.length < 2) throw new Error('insufficient-coords');
  if (!key) throw new Error('no-here-key');
  const origin = pts[0].lat + ',' + pts[0].lng;
  const destination = pts[pts.length - 1].lat + ',' + pts[pts.length - 1].lng;
  const via = pts.slice(1, -1).map((w) => 'via=' + w.lat + ',' + w.lng).join('&');
  const url = 'https://router.hereapi.com/v8/routes?transportMode=truck'
    + '&origin=' + encodeURIComponent(origin)
    + '&destination=' + encodeURIComponent(destination)
    + (via ? '&' + via : '')
    + '&return=summary,tolls&currency=EUR&apikey=' + encodeURIComponent(key);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const resp = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'VallorSoft/1.0' } });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.routes || !data.routes.length) {
      throw new Error((data && data.title) || ('HERE eroare (' + resp.status + ')'));
    }
    return parseHereToll(data);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { hereToll, parseHereToll };
