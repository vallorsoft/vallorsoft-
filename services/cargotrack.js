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
    case 400: return 'Hibás kérés (400) — ellenőrizd a paramétereket.';
    case 401: return 'Érvénytelen vagy hiányzó API-kulcs (401).';
    case 403: return 'A kulcsnak nincs jogosultsága ehhez (403).';
    case 404: return 'Nem található (404) — lehet, rossz az object ID.';
    case 429: return 'Túl sok kérés (429) — várj (limit: 1000 kérés/perc).';
    case 500: return 'CargoTrack szerverhiba (500) — próbáld később.';
    default:  return `Ismeretlen hiba (${status}). ${body || ''}`.trim();
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
      const err = new Error('Időtúllépés — a CargoTrack nem válaszolt időben.'); err.status = 504; throw err;
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

// Aktuális állapot (v2): pozíció + üzemanyag + fogyasztás + km, az utolsó pár óra
// előzményéből a legfrissebb rekord. (Nincs dedikált "latest" végpont.)
async function getLatestStatus(apiKey, objectId, lookbackHours = 6) {
  const to = new Date();
  const from = new Date(to.getTime() - lookbackHours * 3600 * 1000);
  const data = await fmGet(
    `/objects/${encodeURIComponent(objectId)}/coordinates`,
    { from_datetime: from.toISOString(), to_datetime: to.toISOString(), limit: 1000 },
    apiKey, '2'
  );
  const items = data.items || [];
  if (!items.length) return null;
  // a sorrend nem garantált a doksiban -> a legfrissebb rekordot a datetime alapján választjuk
  const last = items.reduce((a, b) => (new Date(b.datetime) > new Date(a.datetime) ? b : a));
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
