// ============================================================
//  VallorSoft — lib/nearbyPlaces.js
//  Egy térképen kijelölt pont körüli cégek / létesítmények és utcák neve
//  az OpenStreetMap-ből (Overpass API, ingyenes, kulcs nélkül).
//
//  - Csak a szerver hívja (a kliens koordinátát küld), cache-elve
//    (~11 m-es rács, 24 óra), egyszerre egy kérés, legalább 1 mp szünettel.
//  - Hiba / elérhetetlen szolgáltatás → üres lista (a térkép attól működik).
//  Személyes adatot nem kezel: nyilvános OSM-helynevek.
// ============================================================
const UA = 'VallorSoft/1.0 (flottakezelo)';
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const CACHE_MS = 24 * 3600 * 1000, CACHE_MAX = 500;
const _cache = new Map();
let _chain = Promise.resolve(), _last = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function _serial(fn) {
  const run = _chain.then(async () => {
    const wait = 1000 - (Date.now() - _last);
    if (wait > 0) await sleep(wait);
    try { return await fn(); } finally { _last = Date.now(); }
  });
  _chain = run.catch(() => {});
  return run;
}

function _dist(lat1, lng1, lat2, lng2) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLng = (lng2 - lng1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const POI_KEYS = ['shop', 'office', 'amenity', 'craft', 'industrial', 'company', 'man_made', 'tourism', 'building', 'landuse'];
function _kind(t) {
  for (const k of POI_KEYS) if (t[k]) return k === 'building' || k === 'landuse' ? t[k] : (k + ':' + t[k]);
  return null;
}

function buildQuery(lat, lng, radius) {
  const ar = `(around:${radius},${lat},${lng})`;
  return `[out:json][timeout:15];(nwr${ar}["name"][~"^(${POI_KEYS.join('|')})$"~"."];way${ar}["highway"]["name"];);out center tags 120;`;
}

// Overpass-válasz → { places:[{name,kind,lat,lng,street,dist}], streets:[{name,dist}] }
function parseOverpass(data, lat, lng) {
  const places = [], streets = new Map();
  for (const e of (data && data.elements) || []) {
    const t = e.tags || {};
    const plat = e.lat != null ? e.lat : (e.center && e.center.lat);
    const plng = e.lon != null ? e.lon : (e.center && e.center.lon);
    if (!t.name || plat == null || plng == null) continue;
    const d = Math.round(_dist(lat, lng, plat, plng));
    if (t.highway) {
      const prev = streets.get(t.name);
      if (prev == null || d < prev) streets.set(t.name, d);
      continue;
    }
    if (places.some((p) => p.name === t.name && Math.abs(p.dist - d) < 60)) continue;
    places.push({
      name: String(t.name).slice(0, 120), kind: _kind(t), lat: plat, lng: plng, dist: d,
      street: [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' ') || null,
    });
  }
  places.sort((a, b) => a.dist - b.dist);
  return {
    places: places.slice(0, 25),
    streets: [...streets.entries()].map(([name, dist]) => ({ name: String(name).slice(0, 120), dist }))
      .sort((a, b) => a.dist - b.dist).slice(0, 8),
  };
}

async function nearby(lat, lng, opts) {
  opts = opts || {};
  lat = Number(lat); lng = Number(lng);
  if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return { places: [], streets: [], ok: false };
  const radius = Math.max(50, Math.min(400, parseInt(opts.radius, 10) || 200));
  const key = lat.toFixed(4) + ',' + lng.toFixed(4) + ',' + radius;
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.v;
  if (opts.cacheOnly) return { places: [], streets: [], ok: false };
  const fetchFn = opts.fetch || fetch;
  const q = buildQuery(lat.toFixed(6), lng.toFixed(6), radius);
  const data = await _serial(async () => {
    for (const url of ENDPOINTS) {
      const ctrl = new AbortController();
      const tm = setTimeout(() => ctrl.abort(), 18000);
      try {
        const r = await fetchFn(url, { method: 'POST', signal: ctrl.signal,
          headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent(q) });
        if (r.ok) return await r.json();
        console.warn('[Nearby] Overpass HTTP', r.status, url);
      } catch (e) { console.warn('[Nearby] Overpass hiba', url, e.message); }
      finally { clearTimeout(tm); }
    }
    return null;
  });
  if (!data) return { places: [], streets: [], ok: false };
  const v = { ...parseOverpass(data, lat, lng), ok: true };
  if (_cache.size >= CACHE_MAX) _cache.delete(_cache.keys().next().value);
  _cache.set(key, { at: Date.now(), v });
  return v;
}

// A ponthoz legközelebbi megnevezett hely (cég / létesítmény), ha elég közel van
function closestName(r, maxM) {
  const p = r && Array.isArray(r.places) ? r.places.find((x) => x.dist <= (maxM || 50)) : null;
  return p ? p.name : null;
}

module.exports = { nearby, parseOverpass, buildQuery, closestName };
