// ============================================================
//  VallorSoft — lib/mapsProvider.js
//  Cserélhető térkép-szolgáltató réteg: a geokódolás + cím-autocomplete
//  cégenként mehet a megbízható, kulcsos szolgáltatón (HERE / Google),
//  VAGY az alap ingyenes stacken (Photon/OSM). Minden keyes hívás
//  BIZTONSÁGOSAN visszaesik az ingyenesre hiba/kulcs-hiány esetén — így
//  sosem lesz rosszabb a mostani viselkedésnél.
//
//  Konfiguráció: company_integrations provider='maps'
//    meta = { vendor: 'free' | 'here' | 'google' }, credentials_enc = API-kulcs.
// ============================================================
const pool = require('../db');
const { decrypt } = require('./crypto');

const UA = 'VallorSoft/1.0 (flottakezelo)';
const TIMEOUT_MS = 12000;

async function jsonGet(url, headers) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: Object.assign({ 'User-Agent': UA }, headers || {}) });
    // Nem-OK státusznál (429 rate-limit, 5xx, blokk) NE nyeljük el csendben —
    // dobjunk, hogy a hívó a tartalék-szolgáltatóra eshessen vissza.
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally { clearTimeout(t); }
}

// ── Provider-konfiguráció (rövid cache) ──
const _cfgCache = new Map(); // cid -> { ts, cfg }
const CFG_TTL = 60 * 1000;
async function getConfig(companyId) {
  if (!companyId) return { vendor: 'free', key: null };
  const c = _cfgCache.get(companyId);
  if (c && Date.now() - c.ts < CFG_TTL) return c.cfg;
  let cfg = { vendor: 'free', key: null };
  try {
    const r = await pool.query(
      "SELECT credentials_enc, enabled, meta FROM company_integrations WHERE company_id=$1 AND provider='maps'",
      [companyId]);
    if (r.rows.length && r.rows[0].enabled) {
      const meta = r.rows[0].meta || {};
      const vendor = ['here', 'google'].includes(meta.vendor) ? meta.vendor : 'free';
      let key = null;
      try { key = r.rows[0].credentials_enc ? decrypt(r.rows[0].credentials_enc) : null; } catch (_) { key = null; }
      if (vendor !== 'free' && key) cfg = { vendor, key };
    }
  } catch (_) { /* marad a free */ }
  _cfgCache.set(companyId, { ts: Date.now(), cfg });
  return cfg;
}
function clearConfigCache(companyId) { if (companyId) _cfgCache.delete(companyId); }

// ── Használat-számláló (csak a fizetős HERE/Google hívásokra) ──
function _ym(d) { const x = d || new Date(); return x.getFullYear() + '-' + ('0' + (x.getMonth() + 1)).slice(-2); }
function bump(companyId, vendor) {
  if (!companyId || !['here', 'google'].includes(vendor)) return;
  pool.query(
    `INSERT INTO maps_usage (company_id, vendor, ym, cnt) VALUES ($1,$2,$3,1)
     ON CONFLICT (company_id, vendor, ym) DO UPDATE SET cnt = maps_usage.cnt + 1, updated_at = NOW()`,
    [companyId, vendor, _ym()]).catch(() => {});
}
// E havi + előző havi használat egy szolgáltatóra → { month, prev }
async function getUsage(companyId, vendor) {
  if (!companyId || !['here', 'google'].includes(vendor)) return { month: 0, prev: 0 };
  const cur = _ym();
  const pd = new Date(); pd.setMonth(pd.getMonth() - 1); const prev = _ym(pd);
  try {
    const r = await pool.query('SELECT ym, cnt FROM maps_usage WHERE company_id=$1 AND vendor=$2 AND ym IN ($3,$4)', [companyId, vendor, cur, prev]);
    let m = 0, p = 0;
    r.rows.forEach((x) => { if (x.ym === cur) m = x.cnt; else p = x.cnt; });
    return { month: m, prev: p };
  } catch (_) { return { month: 0, prev: 0 }; }
}

// ── Autocomplete ──
const _POI_KEYS = new Set(['amenity','shop','office','craft','industrial','tourism','healthcare','leisure','building','company','brand']);
function _dedup(items) {
  const seen = new Set();
  return items.filter((it) => {
    if (!it.label) return false;
    const key = it.label.toLowerCase().slice(0, 60);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
// Photon (photon.komoot.io) — elsődleges ingyenes autocomplete.
async function _acPhoton(q) {
  // Romania területi bias (Erdély/Havasalföld centroid) + nagyobb limit a POI-kért
  const url = 'https://photon.komoot.io/api/?q=' + encodeURIComponent(q)
    + '&limit=8&lang=ro&lat=45.9&lon=24.9&location_bias_scale=0.5';
  const d = await jsonGet(url);
  return _dedup(((d && d.features) || []).map((f) => {
    const p = f.properties || {};
    const isPoi = p.name && _POI_KEYS.has(p.osm_key);
    // POI-nál: Cég neve + utca+hsz + város; cím-típusnál: utca hsz + város
    const streetAddr = [p.street, p.housenumber].filter(Boolean).join(' ');
    const main = p.name || streetAddr || '';
    const addrLine = isPoi ? streetAddr : null; // POI-nál kiírjuk a konkrét utcát is
    const sub = [addrLine, p.postcode, p.city || p.state, p.country].filter(Boolean).join(', ');
    const label = [main, sub].filter(Boolean).join(', ');
    const lat = f.geometry && f.geometry.coordinates ? f.geometry.coordinates[1] : null;
    const lng = f.geometry && f.geometry.coordinates ? f.geometry.coordinates[0] : null;
    return { label, title: main || label, lat, lng };
  }));
}
// Nominatim (OSM hivatalos geocoder) — tartalék, ha a Photon hibázik/üres.
// Romania+Magyarország előnyben (countrycodes), de nem kizárólag.
async function _acNominatim(q) {
  const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=8'
    + '&accept-language=ro&countrycodes=ro,hu,md,bg,rs,hu&q=' + encodeURIComponent(q);
  const d = await jsonGet(url, { 'Accept-Language': 'ro' });
  return _dedup(((Array.isArray(d) ? d : []) ).map((it) => {
    const a = it.address || {};
    const main = it.name || a.road || (it.display_name || '').split(',')[0] || '';
    const city = a.city || a.town || a.village || a.municipality || a.county || '';
    // Utca+házszám csak akkor a sub-ba, ha az utcanév eltér a fő-címkétől
    // (különben "Strada X, Strada X 10" duplikáció lenne).
    const streetAddr = a.road && a.road !== main ? [a.road, a.house_number].filter(Boolean).join(' ') : null;
    const sub = [streetAddr, a.postcode, city, a.country].filter(Boolean).join(', ');
    const label = [main, sub].filter(Boolean).join(', ') || it.display_name || '';
    const lat = it.lat != null ? parseFloat(it.lat) : null;
    const lng = it.lon != null ? parseFloat(it.lon) : null;
    return { label, title: main || label, lat, lng };
  }));
}
async function _acFree(q) {
  // Elsőként Photon; ha hibázik VAGY nem ad találatot → Nominatim tartalék.
  try {
    const r = await _acPhoton(q);
    if (r.length) return r;
  } catch (_) { /* fallthrough Nominatim-ra */ }
  try {
    return await _acNominatim(q);
  } catch (_) { return []; }
}
async function _acHere(q, key) {
  const d = await jsonGet('https://autosuggest.search.hereapi.com/v1/autosuggest?q=' + encodeURIComponent(q)
    + '&at=47.5,19.0&limit=6&apiKey=' + encodeURIComponent(key));
  return ((d && d.items) || []).filter((it) => it.address || it.title)
    .map((it) => ({ label: (it.address && it.address.label) || it.title, title: it.title, lat: it.position ? it.position.lat : null, lng: it.position ? it.position.lng : null })).filter((it) => it.label);
}
async function _acGoogle(q, key) {
  const d = await jsonGet('https://maps.googleapis.com/maps/api/place/autocomplete/json?input=' + encodeURIComponent(q)
    + '&key=' + encodeURIComponent(key));
  return ((d && d.predictions) || []).map((p) => ({
    label: p.description, title: (p.structured_formatting && p.structured_formatting.main_text) || p.description,
  })).filter((it) => it.label);
}
async function autocomplete(companyId, q) {
  const cfg = await getConfig(companyId);
  try {
    if (cfg.vendor === 'here') { const r = await _acHere(q, cfg.key); if (r.length) { bump(companyId, 'here'); return r; } }
    else if (cfg.vendor === 'google') { const r = await _acGoogle(q, cfg.key); if (r.length) { bump(companyId, 'google'); return r; } }
  } catch (_) { /* fallback */ }
  try { return await _acFree(q); } catch (_) { return []; }
}

// ── Geokódolás (cím → koordináta), geo_cache-sel ──
async function _geoPhoton(addr) {
  const d = await jsonGet('https://photon.komoot.io/api/?q=' + encodeURIComponent(addr) + '&limit=1');
  const f = (d.features || [])[0];
  if (!f || !f.geometry) return null;
  const p = f.properties || {};
  return { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], label: [p.name, p.city, p.country].filter(Boolean).join(', ') || addr };
}
async function _geoNominatim(addr) {
  const d = await jsonGet('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=ro&q='
    + encodeURIComponent(addr), { 'Accept-Language': 'ro' });
  const it = (Array.isArray(d) ? d : [])[0];
  if (!it || it.lat == null || it.lon == null) return null;
  return { lat: parseFloat(it.lat), lng: parseFloat(it.lon), label: it.display_name || addr };
}
async function _geoFree(addr) {
  // Photon elsőként; hiba/üres esetén Nominatim tartalék.
  try { const g = await _geoPhoton(addr); if (g) return g; } catch (_) { /* fallback */ }
  try { return await _geoNominatim(addr); } catch (_) { return null; }
}
async function _geoHere(addr, key) {
  const d = await jsonGet('https://geocode.search.hereapi.com/v1/geocode?q=' + encodeURIComponent(addr) + '&limit=1&apiKey=' + encodeURIComponent(key));
  const it = (d.items || [])[0];
  if (!it || !it.position) return null;
  return { lat: it.position.lat, lng: it.position.lng, label: it.address ? it.address.label : addr };
}
async function _geoGoogle(addr, key) {
  const d = await jsonGet('https://maps.googleapis.com/maps/api/geocode/json?address=' + encodeURIComponent(addr) + '&key=' + encodeURIComponent(key));
  const it = (d.results || [])[0];
  if (!it || !it.geometry) return null;
  return { lat: it.geometry.location.lat, lng: it.geometry.location.lng, label: it.formatted_address || addr };
}
async function geocode(companyId, addr) {
  const norm = String(addr || '').trim().toLowerCase().slice(0, 200);
  if (!norm) throw new Error('Üres cím.');
  const c = await pool.query('SELECT lat, lng FROM geo_cache WHERE label = $1', [norm]);
  if (c.rows.length) {
    if (c.rows[0].lat == null) throw new Error('Nem található koordináta ehhez a címhez: ' + addr);
    return { lat: Number(c.rows[0].lat), lng: Number(c.rows[0].lng), label: addr };
  }
  const cfg = await getConfig(companyId);
  let g = null;
  try {
    if (cfg.vendor === 'here') g = await _geoHere(addr, cfg.key);
    else if (cfg.vendor === 'google') g = await _geoGoogle(addr, cfg.key);
    if (g && cfg.vendor !== 'free') bump(companyId, cfg.vendor);
  } catch (_) { g = null; }
  if (!g) { try { g = await _geoFree(addr); } catch (_) { g = null; } }
  await pool.query('INSERT INTO geo_cache (label, lat, lng) VALUES ($1,$2,$3) ON CONFLICT (label) DO NOTHING',
    [norm, g ? g.lat : null, g ? g.lng : null]).catch(() => {});
  if (!g) throw new Error('Nem található koordináta ehhez a címhez: ' + addr);
  return g;
}

// Egyszerű kulcs-teszt (a beállító UI „Tesztelés" gombjához)
async function testProvider(vendor, key) {
  try {
    if (vendor === 'here') { const r = await _geoHere('Budapest', key); return !!r; }
    if (vendor === 'google') { const r = await _geoGoogle('Budapest', key); return !!r; }
    return true;
  } catch (_) { return false; }
}

module.exports = { autocomplete, geocode, getConfig, clearConfigCache, testProvider, getUsage, bump };
