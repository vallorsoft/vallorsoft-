// ============================================================
//  VallorSoft — lib/routeEstimate.js
//  Közös, kapuzatlan útvonal-becslő: cím→koordináta (Photon, geo_cache-elt)
//  + OSRM szakaszonkénti km/időtartam. Használja a fuvar-kiíró térképes
//  km-számítója (orderRouteEstimate) ÉS a beérkező (email) megrendelés
//  jóváhagyása (automata km a fuvarlistára). Ingyenes, kulcs nélkül.
// ============================================================
const pool = require('../db');
const mapsProvider = require('./mapsProvider');

const TIMEOUT_MS = 15000;
const UA = 'VallorSoft/1.0 (flottakezelo)';

async function jsonGet(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA } });
    let body; try { body = await res.json(); } catch (_) { body = {}; }
    if (!res.ok) { const e = new Error('Térkép-szolgáltatás hiba (' + res.status + ')'); e.status = res.status; throw e; }
    return body;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('A térkép-szolgáltatás időtúllépés miatt nem válaszolt.');
    throw e;
  } finally { clearTimeout(t); }
}

// Cím → koordináta geo_cache-sel (a Visszfuvar-radarral közös tábla).
// Sikertelen geokódolás is cache-elődik (NULL), hogy ne hívjuk újra.
async function geocodeCached(addr) {
  const norm = String(addr || '').trim().toLowerCase().slice(0, 200);
  if (!norm) throw new Error('Üres cím.');
  const c = await pool.query('SELECT lat, lng FROM geo_cache WHERE label = $1', [norm]);
  if (c.rows.length) {
    if (c.rows[0].lat == null) throw new Error('Nem található koordináta ehhez a címhez: ' + addr);
    return { lat: Number(c.rows[0].lat), lng: Number(c.rows[0].lng), label: addr };
  }
  let lat = null, lng = null, label = addr;
  try {
    const data = await jsonGet('https://photon.komoot.io/api/?q=' + encodeURIComponent(addr) + '&limit=1');
    const f = (data.features || [])[0];
    if (f && f.geometry && Array.isArray(f.geometry.coordinates)) {
      lng = f.geometry.coordinates[0]; lat = f.geometry.coordinates[1];
      const p = f.properties || {};
      label = [p.name, p.city, p.country].filter(Boolean).join(', ') || addr;
    }
  } catch (_) { /* a NULL is cache-elődik */ }
  await pool.query(
    'INSERT INTO geo_cache (label, lat, lng) VALUES ($1,$2,$3) ON CONFLICT (label) DO NOTHING',
    [norm, lat, lng]).catch(() => {});
  if (lat == null) throw new Error('Nem található koordináta ehhez a címhez: ' + addr);
  return { lat, lng, label };
}

// Két pont közötti szakasz (OSRM autós profil, kulcs nélkül).
async function osrmLeg(a, b) {
  const url = 'https://router.project-osrm.org/route/v1/driving/'
    + a.lng + ',' + a.lat + ';' + b.lng + ',' + b.lat
    + '?overview=full&geometries=geojson&alternatives=false&steps=false';
  const data = await jsonGet(url);
  if (data.code !== 'Ok' || !(data.routes || []).length) {
    throw new Error('Nem található útvonal a megadott pontok között.');
  }
  const r0 = data.routes[0];
  const coords = ((r0.geometry && r0.geometry.coordinates) || []).map((c) => [c[1], c[0]]);
  return { distance: r0.distance || 0, duration: r0.duration || 0, polyline: coords };
}

// waypoints: [{type, address?, lat?, lng?}] (min. 2); companyId → cégenkénti
// térkép-szolgáltató (HERE/Google) a geokódoláshoz, különben ingyenes.
// → { km, durationSeconds, polyline:[[lat,lng]], waypoints:[{type,lat,lng,label}] }
async function estimateRoute(waypoints, companyId) {
  let wps = (Array.isArray(waypoints) ? waypoints : [])
    .filter((w) => w && (w.address || (w.lat != null && w.lng != null)));
  if (wps.length < 2) throw new Error('A felrakó és a lerakó cím is szükséges.');
  if (wps.length > 9) wps = wps.slice(0, 9); // fair-use

  const resolved = [];
  for (const w of wps) {
    if (w.lat != null && w.lng != null) {
      resolved.push({ type: w.type || 'waypoint', lat: Number(w.lat), lng: Number(w.lng),
        label: w.address || (Number(w.lat).toFixed(4) + ', ' + Number(w.lng).toFixed(4)) });
    } else {
      const g = companyId ? await mapsProvider.geocode(companyId, w.address) : await geocodeCached(w.address);
      resolved.push({ type: w.type || 'waypoint', lat: g.lat, lng: g.lng, label: w.address || g.label });
    }
  }

  let polyline = [], distanceMeters = 0, durationSeconds = 0;
  for (let i = 0; i < resolved.length - 1; i++) {
    const leg = await osrmLeg(resolved[i], resolved[i + 1]);
    distanceMeters += leg.distance;
    durationSeconds += leg.duration;
    let dd = leg.polyline;
    if (polyline.length && dd.length) dd = dd.slice(1);
    polyline = polyline.concat(dd);
  }
  return {
    km: Math.round(distanceMeters / 1000),
    durationSeconds: Math.round(durationSeconds),
    polyline,
    waypoints: resolved,
  };
}

module.exports = { estimateRoute, geocodeCached };
