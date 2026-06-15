// ============================================================
//  VallorSoft — lib/vehiclePositions.js
//  Élő jármű-pozíciók (CargoTrack) cégenkénti, rövid memória-cache-sel.
//  A vehicle_gps_map csak rendszám<->object_id párosítást tárol; a
//  pozíció ÉLŐBEN jön a GPS-szolgáltatótól. A cache (30 mp) megfogja,
//  hogy a Vezérlőpult ÉS a Visszfuvar-radar (több nyitott felület)
//  ne sokszorozza a szolgáltató felé menő hívásokat — 300 usernél ez
//  a fő upstream-terhelés-csökkentő.
// ============================================================
const pool = require('../db');
const ctSvc = require('../services/cargotrack');
const { decrypt } = require('./crypto');
const { featureEnabled } = require('./featureEnabled');

const _posCache = new Map(); // company_id -> { ts, payload }
const POS_CACHE_MS = 30 * 1000;

// → { ok, gps_configured, positions: [{rendszam, object_name, lat, lng, speed, ignition, datetime}] }
async function getPositions(cid) {
  const cached = _posCache.get(cid);
  if (cached && Date.now() - cached.ts < POS_CACHE_MS) return cached.payload;

  if (!(await featureEnabled(cid, 'gps-integracio'))) {
    return { ok: true, gps_configured: false, positions: [] };
  }

  const keyR = await pool.query(
    `SELECT credentials_enc, enabled FROM company_integrations
     WHERE company_id = $1 AND provider = 'cargotrack'`,
    [cid]
  );
  if (!keyR.rows.length || !keyR.rows[0].credentials_enc || !keyR.rows[0].enabled) {
    const payload = { ok: true, gps_configured: false, positions: [] };
    _posCache.set(cid, { ts: Date.now(), payload });
    return payload;
  }
  const apiKey = decrypt(keyR.rows[0].credentials_enc);

  const mapR = await pool.query(
    `SELECT rendszam, object_id, object_name FROM vehicle_gps_map
     WHERE company_id = $1 AND provider = 'cargotrack'`,
    [cid]
  );
  if (!mapR.rows.length) {
    const payload = { ok: true, gps_configured: true, positions: [] };
    _posCache.set(cid, { ts: Date.now(), payload });
    return payload;
  }

  // Azonos object_id-k összevonása (egy GPS-eszköz több rendszámhoz párosítva
  // se kérdeződjön le többször).
  const byObjectId = new Map();
  for (const m of mapR.rows) if (!byObjectId.has(m.object_id)) byObjectId.set(m.object_id, m);

  // Párhuzamos lekérés, jármű-hibák ne döntsék el az egészet.
  const settled = await Promise.allSettled(
    [...byObjectId.values()].map(async (m) => {
      const st = await ctSvc.getLatestStatus(apiKey, m.object_id);
      if (!st || st.latitude == null || st.longitude == null) return null;
      return {
        rendszam: m.rendszam,
        object_name: m.object_name || m.rendszam,
        lat: st.latitude,
        lng: st.longitude,
        speed: st.speed,
        ignition: st.ignition,
        datetime: st.datetime,
      };
    })
  );
  const positions = settled
    .filter((r) => r.status === 'fulfilled' && r.value)
    .map((r) => r.value);

  const payload = { ok: true, gps_configured: true, positions };
  _posCache.set(cid, { ts: Date.now(), payload });
  return payload;
}

module.exports = { getPositions };
