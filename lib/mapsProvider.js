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
    return await res.json().catch(() => ({}));
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

// ── Autocomplete ──
async function _acFree(q) {
  const d = await jsonGet('https://photon.komoot.io/api/?q=' + encodeURIComponent(q) + '&limit=6');
  return ((d && d.features) || []).map((f) => {
    const p = f.properties || {};
    const main = p.name || p.street || '';
    const sub = [p.street && p.name !== p.street ? p.street : null, p.postcode, p.city, p.state, p.country].filter(Boolean).join(', ');
    const label = [main, sub].filter(Boolean).join(', ');
    return { label, title: main || label };
  }).filter((it) => it.label);
}
async function _acHere(q, key) {
  const d = await jsonGet('https://autosuggest.search.hereapi.com/v1/autosuggest?q=' + encodeURIComponent(q)
    + '&at=47.5,19.0&limit=6&apiKey=' + encodeURIComponent(key));
  return ((d && d.items) || []).filter((it) => it.address || it.title)
    .map((it) => ({ label: (it.address && it.address.label) || it.title, title: it.title })).filter((it) => it.label);
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
    if (cfg.vendor === 'here') { const r = await _acHere(q, cfg.key); if (r.length) return r; }
    else if (cfg.vendor === 'google') { const r = await _acGoogle(q, cfg.key); if (r.length) return r; }
  } catch (_) { /* fallback */ }
  try { return await _acFree(q); } catch (_) { return []; }
}

// ── Geokódolás (cím → koordináta), geo_cache-sel ──
async function _geoFree(addr) {
  const d = await jsonGet('https://photon.komoot.io/api/?q=' + encodeURIComponent(addr) + '&limit=1');
  const f = (d.features || [])[0];
  if (!f || !f.geometry) return null;
  const p = f.properties || {};
  return { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], label: [p.name, p.city, p.country].filter(Boolean).join(', ') || addr };
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

module.exports = { autocomplete, geocode, getConfig, clearConfigCache, testProvider };
