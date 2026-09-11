// lib/reverseGeo.js — ingyenes reverse geocode: lat/lng → olvasható cím.
// Photon (Komoot) elsőként, Nominatim (OSM) fallback. Best-effort: hiba/üres →
// null (a hívó megjeleníti a koordinátát nyersen).
//
// A hívások server-oldalon mennek → nem terheli a klienst kulcs-hiánynál.
// Timeout 6 mp.
//
// FONTOS — rács-alapú memória-cache (mint `lib/vehiclePositions.js` `_posCache`):
// a hívó (`getMyAssignedVehicle`) minden dashboard-betöltésnél/pull-to-refresh-
// nél/session-recovery-nél meghívódhat, ami cache NÉLKÜL percenként több élő
// hívást is indítana a Nominatim felé. A Nominatim usage policy szigorú
// (max 1 req/mp, egyébként IP-tiltás — a MEGOSZTOTT szerver-IP-t érintené,
// ami a projekt egészének geokódolását/autocomplete-jét eltörné). Ezért a
// koordinátát ~1.1 km pontosságú rácsra kerekítjük (2 tizedesjegy) és 10 percig
// cache-eljük — egy álló/lassan mozgó jármű ismételt lekérdezése a rácson belül
// NEM indít új külső hívást.
const _revCache = new Map(); // "latRounded,lngRounded,lang" -> { ts, result }
const _REV_CACHE_MS = 10 * 60 * 1000;
const _REV_GRID = 2; // tizedesjegy — kb. 1.1 km rács

// Takarítás: a Map rács-kulcsonként korlátlanul nőhetne hosszú futás alatt
// (napi útvonal-változás miatt egyre több rács-cella). Periodikusan (30 perc)
// kidobjuk a lejárt bejegyzéseket — a memória-lábnyom így korlátos marad.
// `unref()` — ne tartsa életben a process-t magában (pl. teszt-környezetben).
const _sweepTimer = setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _revCache) { if (now - v.ts > _REV_CACHE_MS) _revCache.delete(k); }
}, 30 * 60 * 1000);
if (typeof _sweepTimer.unref === 'function') _sweepTimer.unref();

const _UA = 'VallorSoft/1.0 (vallorsoft.fly.dev)';

async function _fetchT(url, ms = 6000) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': _UA, 'Accept': 'application/json,application/geo+json' }
    });
    clearTimeout(to);
    if (!r.ok) return null;
    return await r.json();
  } catch (_) { clearTimeout(to); return null; }
}

function _photonAddr(feat) {
  const p = feat && feat.properties;
  if (!p) return null;
  // Ország-kód szűrő nélkül fogadjuk (a sofőr külföldön is lehet).
  const parts = [];
  if (p.name && p.name !== p.city) parts.push(p.name);
  if (p.street) parts.push(p.street + (p.housenumber ? ' ' + p.housenumber : ''));
  if (p.city) parts.push(p.city);
  else if (p.town) parts.push(p.town);
  else if (p.village) parts.push(p.village);
  if (p.state) parts.push(p.state);
  if (p.country) parts.push(p.country);
  const uniq = [];
  for (const it of parts) { const s = String(it || '').trim(); if (s && !uniq.includes(s)) uniq.push(s); }
  return uniq.length ? uniq.join(', ') : null;
}

async function _photonReverse(lat, lng, lang) {
  const url = `https://photon.komoot.io/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&lang=${encodeURIComponent(lang || 'ro')}&limit=1`;
  const d = await _fetchT(url);
  if (!d || !Array.isArray(d.features) || !d.features.length) return null;
  return _photonAddr(d.features[0]);
}

async function _nominatimReverse(lat, lng, lang) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&accept-language=${encodeURIComponent(lang || 'ro')}&zoom=17`;
  const d = await _fetchT(url);
  if (!d || !d.display_name) return null;
  return String(d.display_name).trim() || null;
}

// reverseGeocode(lat, lng, lang='ro') → { address?: string } | null
// null = mindkét provider hibázott / üres. Rács-cache-elt (lásd fent).
async function reverseGeocode(lat, lng, lang) {
  const la = parseFloat(lat), ln = parseFloat(lng);
  if (!isFinite(la) || !isFinite(ln)) return null;
  if (Math.abs(la) > 90 || Math.abs(ln) > 180) return null;

  const key = la.toFixed(_REV_GRID) + ',' + ln.toFixed(_REV_GRID) + ',' + (lang || 'ro');
  const cached = _revCache.get(key);
  if (cached && (Date.now() - cached.ts) < _REV_CACHE_MS) return cached.result;

  let result = null;
  try {
    const p = await _photonReverse(la, ln, lang);
    if (p) result = { address: p };
  } catch (_) {}
  if (!result) {
    try {
      const n = await _nominatimReverse(la, ln, lang);
      if (n) result = { address: n };
    } catch (_) {}
  }
  // Sikertelen lekérdezést is cache-elünk (rövidebb ideig nem próbálja újra
  // minden hívás — pl. eldugott vidéki koordinátára, amit egyik provider sem
  // ismer fel), de a null-t csak 1/5 ideig őrizzük, hogy egy átmeneti hálózati
  // hiba ne blokkolja hosszan a friss próbálkozást.
  _revCache.set(key, { ts: Date.now() - (result ? 0 : _REV_CACHE_MS * 0.8), result });
  return result;
}

module.exports = { reverseGeocode };
