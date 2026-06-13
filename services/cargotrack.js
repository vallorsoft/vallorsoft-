// cargotrack-service.js
// CargoTrack a FM-Track (Ruptela) platformra épül. Host: api.fm-track.com
// Hitelesítés: api_key query-paraméter. Válasz: JSON. Minden hívás SZERVER OLDALON fut.
//
// Végpontok, amiket használunk:
//   GET /objects?version=1                         -> járműlista (teszt + párosítás)
//   GET /objects/{id}/coordinates?version=2&...     -> pozíció + ÜZEMANYAG + fogyasztás egyben (v2!)

const BASE = 'https://api.fm-track.com';
const TIMEOUT_MS = 15000;

function mapError(status, body) {
  switch (status) {
    case 400: return 'Cerere greșită (400) — verifică parametrii.';
    case 401: return 'Cheie API invalidă sau lipsă (401).';
    case 403: return 'Cheia nu are permisiune pentru aceasta (403).';
    case 404: return 'Nu a fost găsit (404) — poate object ID-ul este greșit.';
    case 429: return 'Prea multe cereri (429) — așteaptă (limită: 1000 cereri/minut).';
    case 500: return 'Eroare server CargoTrack (500) — încearcă mai târziu.';
    default:  return `Eroare necunoscută (${status}). ${body || ''}`.trim();
  }
}

async function fmGet(path, params, apiKey, version = '1') {
  const url = new URL(BASE + path);
  url.searchParams.set('version', version);
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }
  url.searchParams.set('api_key', apiKey);

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json;charset=UTF-8' },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      let body = ''; try { body = await res.text(); } catch (_) {}
      const err = new Error(mapError(res.status, body)); err.status = res.status; throw err;
    }
    return await res.json();
  } catch (e) {
    if (e.name === 'AbortError') {
      const err = new Error('Timeout — CargoTrack nu a răspuns la timp.'); err.status = 504; throw err;
    }
    throw e;
  } finally { clearTimeout(t); }
}

// Járműlista (v1) — teszt + rendszám↔object_id párosítás.
// A mezőneveket defenzíven kezeljük (Swagger szerint véglegesíthető).
async function listObjects(apiKey) {
  const data = await fmGet('/objects', {}, apiKey, '1');
  const arr = Array.isArray(data) ? data : (data.items || []);
  return arr.map((o) => ({
    object_id: o.id || o.object_id,
    name: o.name || o.label || o.object_id || o.id,
    imei: o.imei || null,
    plate: o.plate_number || o.licence_plate || o.plate || null,
  }));
}

async function testConnection(apiKey) {
  const objects = await listObjects(apiKey);
  return { ok: true, objectCount: objects.length };
}

// Egy adott időablak legfrissebb koordináta-rekordja.
// FONTOS: a /coordinates végpont limitált (1000) és a rekordokat időrendben
// (legrégebbi elöl) adhatja vissza. Sűrűn jelző járműnél a hosszú ablak így a
// RÉGI rekordokat hozza → elavult pozíció. Ezért kis ablakokkal kérdezünk.
async function fetchLatestInWindow(apiKey, objectId, hours) {
  const to = new Date();
  const from = new Date(to.getTime() - hours * 3600 * 1000);
  const data = await fmGet(
    `/objects/${encodeURIComponent(objectId)}/coordinates`,
    { from_datetime: from.toISOString(), to_datetime: to.toISOString(), limit: 1000 },
    apiKey, '2'
  );
  const items = data.items || [];
  if (!items.length) return null;
  // a sorrend nem garantált a doksiban -> a legfrissebb rekordot a datetime alapján választjuk
  return items.reduce((a, b) => (new Date(b.datetime) > new Date(a.datetime) ? b : a));
}

// Aktuális állapot (v2): pozíció + üzemanyag + fogyasztás + km — a LEGFRISSEBB rekord.
// Előbb rövid, friss ablakot kérünk (hogy aktív járműnél tényleg az aktuális pozíció
// jöjjön), és csak ha üres, tágítunk fokozatosan a teljes visszatekintésig.
async function getLatestStatus(apiKey, objectId, lookbackHours = 6) {
  let last = await fetchLatestInWindow(apiKey, objectId, 0.5);   // 30 perc (aktív jármű)
  if (!last) last = await fetchLatestInWindow(apiKey, objectId, 2);            // 2 óra
  if (!last) last = await fetchLatestInWindow(apiKey, objectId, lookbackHours); // 6 óra fallback
  if (!last) return null;
  const pos = last.position || {};
  const calc = (last.inputs && last.inputs.calculated_inputs) || last.calculated_inputs || {};
  return {
    object_id: last.object_id,
    datetime: last.datetime,
    ignition: last.ignition_status,
    latitude: pos.latitude,
    longitude: pos.longitude,
    speed: pos.speed,
    direction: pos.direction,
    fuel_level: calc.fuel_level,            // üzemanyag-szint (ha az eszköz méri)
    fuel_consumption: calc.fuel_consumption, // fogyasztás
    mileage: calc.mileage,
    rpm: calc.rpm,
  };
}

module.exports = { testConnection, listObjects, getLatestStatus };
