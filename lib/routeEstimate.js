// ============================================================
//  VallorSoft — lib/routeEstimate.js
//  Közös, kapuzatlan útvonal-becslő: cím→koordináta (Photon, geo_cache-elt)
//  + OSRM szakaszonkénti km/időtartam. Használja a fuvar-kiíró térképes
//  km-számítója (orderRouteEstimate) ÉS a beérkező (email) megrendelés
//  jóváhagyása (automata km a fuvarlistára).
//  Útvonal: ha a cégnek van HERE-kulcsa → KIZÁRÓLAG HERE Routing v8,
//  kamion-módban, 40 t-s EU szerelvénnyel (tollProvider.TRUCK_DEFAULTS).
//  HERE-hiba esetén NINCS autós (OSRM) tartalék — a km kamionra érvényes
//  kell legyen. OSRM csak annál a cégnél fut, amelyiknek nincs HERE-kulcsa.
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
  const cc = require('./coordParse').parseCoords(addr);
  if (cc) return { lat: cc.lat, lng: cc.lng, label: String(addr).trim() };
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

// Útvonal-becslés KIZÁRÓLAG HERE kamion-routinggal: az autós OSRM km/idő kamionra
// félrevezető, ezért HERE-kulcs nélkül nem becslünk (code='NO_HERE', reason = az ok).
const REASON_RO = {
  'no-row': 'nu este setată cheia HERE', disabled: 'integrarea HERE este dezactivată',
  'vendor-free': 'furnizorul de hărți nu este HERE', 'no-credentials': 'lipsește cheia HERE',
  'empty-key': 'lipsește cheia HERE', 'decrypt-failed': 'cheia HERE nu poate fi citită (reintrodu-o)',
  'db-error': 'setările hărții nu pot fi citite', 'no-company': 'firmă necunoscută',
};
function noHereError(reason) {
  const e = new Error('Calculul traseului necesită HERE (camion 40 t): ' + (REASON_RO[reason] || reason || 'cheie lipsă') + '.');
  e.code = 'NO_HERE'; e.reason = reason || 'no-row';
  return e;
}
// A cég HERE-kulcsa, vagy NO_HERE hiba
async function requireHere(companyId) {
  if (!companyId) throw noHereError('no-company');
  let cfg = { vendor: 'free', reason: 'db-error' };
  try { cfg = await mapsProvider.getConfig(companyId); } catch (_) {}
  if (cfg.vendor === 'here' && cfg.key) return cfg.key;
  throw noHereError(cfg.reason || 'no-row');
}
// SQL-feltétel: a cégnek van aktív HERE-kulcsa (alias = a company_id-t adó tábla)
const hereOnSql = (alias) => `EXISTS (SELECT 1 FROM company_integrations ci WHERE ci.company_id = ${alias}.company_id AND ci.provider = 'maps'
    AND ci.enabled AND ci.meta->>'vendor' = 'here' AND ci.credentials_enc IS NOT NULL)`;

// HERE Routing v8, kamion (40 t). Egy hívás, a köztes pontok `via`-ként →
// a HERE minden via-nál új szakaszt (section) kezd, így a szakaszok = legek.
// Nyers szakaszok: { distance, duration, poly: flexpolyline-szöveg } (tárolható).
function _truckQuery() { const tp = require('./tollProvider'); return tp.truckQuery(tp.mergeTruck()); }
async function hereTruckSections(pts, key) {
  const origin = pts[0].lat + ',' + pts[0].lng;
  const dest = pts[pts.length - 1].lat + ',' + pts[pts.length - 1].lng;
  const via = pts.slice(1, -1).map((w) => 'via=' + w.lat + ',' + w.lng).join('&');
  const tq = _truckQuery();
  const url = 'https://router.hereapi.com/v8/routes?transportMode=truck'
    + '&origin=' + encodeURIComponent(origin) + '&destination=' + encodeURIComponent(dest)
    + (via ? '&' + via : '') + (tq.length ? '&' + tq.join('&') : '')
    + '&return=summary,polyline&apikey=' + encodeURIComponent(key);
  const data = await jsonGet(url);
  const route = data && Array.isArray(data.routes) && data.routes[0];
  if (!route || !(route.sections || []).length) {
    const e = new Error('HERE: nu s-a găsit traseu pentru camion între aceste puncte.'); e.noRoute = true; throw e;
  }
  return route.sections.map((sec) => ({ distance: Number((sec.summary && sec.summary.length) || 0),
    duration: Number((sec.summary && sec.summary.duration) || 0), poly: sec.polyline || '' }));
}
function _decodeSections(secs) {
  const flex = require('@here/flexpolyline');
  return secs.map((s) => {
    let poly = [];
    if (s.poly) { try { poly = flex.decode(s.poly).polyline.map((p) => [p[0], p[1]]); } catch (_) { poly = []; } }
    return { distance: Number(s.distance) || 0, duration: Number(s.duration) || 0, polyline: poly };
  });
}
// Visszafelé kompatibilis: dekódolt szakaszok
async function hereTruckRoute(pts, key) { return _decodeSections(await hereTruckSections(pts, key)); }

// Tartós tároló kulcsa: pontok (5 tizedes) + kamion-paraméterek
function routeKey(pts) {
  const txt = 'v1|' + _truckQuery().join('&') + '|' + pts.map((p) => Number(p.lat).toFixed(5) + ',' + Number(p.lng).toFixed(5)).join(';');
  return require('crypto').createHash('sha1').update(txt).digest('hex');
}
async function _cacheGet(cid, key) {
  try {
    const r = await pool.query('SELECT sections FROM here_route_cache WHERE company_id=$1 AND route_key=$2', [cid, key]);
    if (!r.rows.length) return null;
    pool.query('UPDATE here_route_cache SET used_at=NOW() WHERE company_id=$1 AND route_key=$2', [cid, key]).catch(() => {});
    const s = r.rows[0].sections;
    return Array.isArray(s) && s.length ? s : null;
  } catch (_) { return null; }        // tábla még nincs (migráció előtt) → számolunk
}
async function _cachePut(cid, key, secs) {
  await pool.query(
    `INSERT INTO here_route_cache (company_id, route_key, sections) VALUES ($1,$2,$3::jsonb)
     ON CONFLICT (company_id, route_key) DO UPDATE SET sections=EXCLUDED.sections, used_at=NOW()`,
    [cid, key, JSON.stringify(secs)]).catch(() => {});
}

const RETRY_MS = 3000;   // hiba után ennyi idő múlva elölről
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Újrapróbálható-e a hiba: hálózat / időtúllépés / 429 / 5xx igen; kulcs- vagy kérés-hiba, „nincs útvonal" nem
function retryable(e) {
  if (!e || e.code === 'NO_HERE' || e.noRoute) return false;
  const st = Number(e.status) || 0;
  return !st || st === 429 || st >= 500;
}

// waypoints: [{type, address?, lat?, lng?}] (min. 2); companyId → cégenkénti
// térkép-szolgáltató (HERE/Google) a geokódoláshoz, különben ingyenes.
// A pontok a MEGADOTT SORRENDBEN (seq_index) fűződnek össze — semmilyen
// geográfiai optimalizálás nincs. Több felrakó/lerakó (multi-drop): mind
// szakaszonként (leg) szerepel a válaszban, a szakaszok kilométere összeadva
// adja a teljes `km`-et.
// → { km, durationSeconds, polyline:[[lat,lng]],
//     waypoints:[{type,lat,lng,label}],
//     legs:[{fromLabel,toLabel,km,durationSeconds}] }
async function estimateRoute(waypoints, companyId, opts) {
  let wps = (Array.isArray(waypoints) ? waypoints : [])
    .filter((w) => w && (w.address || (w.lat != null && w.lng != null)));
  if (wps.length < 2) throw new Error('A felrakó és a lerakó cím is szükséges.');
  if (wps.length > 20) wps = wps.slice(0, 20); // a lánc (routeChain) 20 pontos darabokban hív

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

  const key = await requireHere(companyId);   // HERE nélkül nincs becslés (OSRM nem)
  // Egyszer kiszámolt útvonal → tárolva, onnantól mindig azt használjuk
  const rk = routeKey(resolved);
  let secs = await _cacheGet(companyId, rk);
  let cached = !!secs;
  if (!secs) {
    const attempts = Math.max(1, Math.min(60, Number(opts && opts.attempts) || 1));
    let lastErr = null;
    for (let a = 0; a < attempts && !secs; a++) {
      if (a) await sleep(RETRY_MS);
      try { secs = await hereTruckSections(resolved, key); mapsProvider.bump(companyId, 'here'); }
      catch (e) { lastErr = e; if (!retryable(e)) break; }
    }
    if (!secs) { if (lastErr) lastErr.retryable = retryable(lastErr); throw lastErr || new Error('HERE eroare'); }
    await _cachePut(companyId, rk, secs);
  }
  let hereLegs = _decodeSections(secs);
  if (hereLegs.length !== resolved.length - 1) {
    // Ritka: a HERE nem pontonként bontott — egyetlen szakaszként kezeljük
    // (a köztes pontok a waypoints-ban megmaradnak).
    hereLegs = [hereLegs.reduce((a, l) => ({ distance: a.distance + l.distance, duration: a.duration + l.duration,
      polyline: a.polyline.concat(l.polyline) }), { distance: 0, duration: 0, polyline: [] })];
  }
  let polyline = [], distanceMeters = 0, durationSeconds = 0;
  const legs = [];
  const legCount = hereLegs.length;
  for (let i = 0; i < legCount; i++) {
    const to = legCount === 1 ? resolved.length - 1 : i + 1;
    const leg = hereLegs[i];
    distanceMeters += leg.distance;
    durationSeconds += leg.duration;
    legs.push({
      fromLabel: resolved[i].label,
      toLabel: resolved[to].label,
      km: Math.round((leg.distance || 0) / 1000),
      durationSeconds: Math.round(leg.duration || 0),
    });
    let dd = leg.polyline;
    if (polyline.length && dd.length) dd = dd.slice(1);
    polyline = polyline.concat(dd);
  }
  return {
    km: Math.round(distanceMeters / 1000),
    durationSeconds: Math.round(durationSeconds),
    polyline,
    waypoints: resolved,
    legs,
    source: 'here-truck',
    free_reason: null,
    cached,
  };
}

module.exports = { estimateRoute, geocodeCached, hereTruckRoute, requireHere, noHereError, hereOnSql, routeKey, retryable, RETRY_MS };
