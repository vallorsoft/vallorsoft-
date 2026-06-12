// ============================================================
//  VallorSoft — handlers/routePlannerHandlers.js
//  Útvonaltervezés — INGYENES szolgáltatásokkal (HERE lecserélve):
//   - Geokódolás:  Photon (photon.komoot.io) — OpenStreetMap alapú, kulcs nélkül
//   - Útvonal:     OSRM (router.project-osrm.org) — kulcs nélkül, autós profil
//   - Csempék:     CartoDB/OSM (kliens oldalon, kulcs nélkül)
//  FIGYELEM: az OSRM autós profillal számol — kamion-korlátozásokat
//  (súly/magasság/szélesség) NEM vesz figyelembe. A jármű-paraméterek
//  a fogyasztás-becsléshez használatosak.
//
//  Séma-jegyzetek (a valós DB-hez igazítva):
//   - orders.tractor_id / trailer_id LÉTEZIK, de gyakran NULL -> a
//     rendszam_camion / rendszam_remorca alapján is feloldjuk a járművet.
//   - vehicle_gps_map NEM tárol lat/lng-t (csak rendszam<->object_id);
//     a pozíció ÉLŐBEN jön a CargoTrack szolgáltatótól (services/cargotrack).
// ============================================================
const pool = require('../db');
const ctSvc = require('../services/cargotrack');
const { decrypt } = require('../lib/crypto');

const GEO_TIMEOUT_MS = 15000;
const UA = 'VallorSoft/1.0 (flottakezelo; kapcsolat: admin)';

// Általános JSON GET időtúllépéssel + udvarias User-Agent (OSM-szabály).
async function jsonGet(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), GEO_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA } });
    let body;
    try { body = await res.json(); } catch (_) { body = {}; }
    if (!res.ok) {
      const e = new Error('Térkép-szolgáltatás hiba (' + res.status + ')');
      e.status = res.status;
      throw e;
    }
    return body;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('A térkép-szolgáltatás időtúllépés miatt nem válaszolt.');
    throw e;
  } finally {
    clearTimeout(t);
  }
}

// Cím -> koordináta (Photon / OpenStreetMap, ingyenes, kulcs nélkül)
async function geocodeFree(addr) {
  const url = 'https://photon.komoot.io/api/?q=' + encodeURIComponent(addr) + '&limit=1';
  const data = await jsonGet(url);
  const f = (data.features || [])[0];
  if (!f || !f.geometry || !Array.isArray(f.geometry.coordinates)) {
    throw new Error('Nem található koordináta ehhez a címhez: ' + addr);
  }
  const lng = f.geometry.coordinates[0];
  const lat = f.geometry.coordinates[1];
  const p = f.properties || {};
  const label = [p.name, p.city, p.country].filter(Boolean).join(', ');
  return { lat, lng, label: label || addr };
}

// OPCIONÁLIS kamionos routing: OpenRouteService driving-hgv profil
// (INGYENES API-kulccsal, ~2000 kérés/nap). Ha az ORS_API_KEY be van
// állítva, a jármű-paraméterekkel (súly/magasság) tervezünk; hiba esetén
// automatikus visszaesés az OSRM autós profilra.
async function orsLeg(a, b, cp) {
  const key = process.env.ORS_API_KEY;
  const num = (x) => { const n = parseFloat(x); return Number.isFinite(n) && n > 0 ? n : null; };
  const restrictions = {};
  if (num(cp.height)) restrictions.height = num(cp.height) / 100;            // cm -> m
  if (num(cp.width)) restrictions.width = num(cp.width) / 100;
  if (num(cp.length)) restrictions.length = num(cp.length) / 100;
  if (num(cp.grossWeight)) restrictions.weight = num(cp.grossWeight) / 1000; // kg -> t
  if (num(cp.weightPerAxle)) restrictions.axleload = num(cp.weightPerAxle) / 1000;
  const body = {
    coordinates: [[a.lng, a.lat], [b.lng, b.lat]],
    ...(Object.keys(restrictions).length ? { options: { profile_params: { restrictions } } } : {}),
  };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), GEO_TIMEOUT_MS);
  try {
    const res = await fetch('https://api.openrouteservice.org/v2/directions/driving-hgv/geojson', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Authorization': key, 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = new Error((data.error && data.error.message) || ('ORS hiba (' + res.status + ')'));
      e.status = res.status;
      throw e;
    }
    const feat = (data.features || [])[0];
    if (!feat || !feat.geometry) throw new Error('Nem található kamionos útvonal a pontok között.');
    const sum = (feat.properties && feat.properties.summary) || {};
    return {
      distance: sum.distance || 0,
      duration: sum.duration || 0,
      polyline: (feat.geometry.coordinates || []).map((c) => [c[1], c[0]]),
    };
  } finally { clearTimeout(t); }
}

// Két pont közötti útvonal-szakasz (OSRM, ingyenes, kulcs nélkül).
// Szakaszonként külön hívás -> minden szakasznak saját polyline-ja van
// (a felület színezve rajzolja: GPS-ráhordás szaggatva, fő szakasz pirossal).
async function osrmLeg(a, b) {
  const url = 'https://router.project-osrm.org/route/v1/driving/'
    + a.lng + ',' + a.lat + ';' + b.lng + ',' + b.lat
    + '?overview=full&geometries=geojson&alternatives=false&steps=false';
  const data = await jsonGet(url);
  if (data.code !== 'Ok' || !(data.routes || []).length) {
    throw new Error('Nem található útvonal a megadott pontok között.');
  }
  const r0 = data.routes[0];
  const coords = ((r0.geometry && r0.geometry.coordinates) || []).map((c) => [c[1], c[0]]); // [lng,lat] -> [lat,lng]
  return { distance: r0.distance || 0, duration: r0.duration || 0, polyline: coords };
}

// --- CargoTrack kulcs + object_id feloldás (élő GPS-hez) ---
async function getCargotrackKey(companyId) {
  const { rows } = await pool.query(
    `SELECT credentials_enc, enabled FROM company_integrations
     WHERE company_id = $1 AND provider = 'cargotrack'`, [companyId]);
  if (!rows.length || !rows[0].credentials_enc || !rows[0].enabled) return null;
  return decrypt(rows[0].credentials_enc);
}
async function objectIdForRendszam(companyId, rendszam) {
  const { rows } = await pool.query(
    `SELECT object_id FROM vehicle_gps_map WHERE company_id = $1 AND provider = 'cargotrack' AND rendszam = $2`,
    [companyId, rendszam]);
  return rows.length ? rows[0].object_id : null;
}

// Előfizetés: ki van-e kapcsolva az útvonaltervezés a cégnél (hiányzó sor = engedélyezett).
async function routeFeatureOff(companyId) {
  if (!companyId) return false;
  try {
    const r = await pool.query(
      "SELECT enabled FROM company_features WHERE company_id = $1 AND feature_key = 'utvonaltervezes'", [companyId]);
    return r.rows.length ? r.rows[0].enabled === false : false;
  } catch (e) { return false; }
}

const handlers = {};

// ─── Fuvarok az útvonaltervezőhöz ───────────────────────────
// A vontatót/pótkocsit tractor_id/trailer_id VAGY rendszám alapján oldjuk fel.
handlers.getOrdersForRoutePlanning = async function (req, res, args) {
  try {
    if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
      return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
    }
    const r = await pool.query(
      `SELECT o.id, o.loc_incarcare, o.loc_descarcare, o.status, o.client,
              v_t.id AS tractor_id, v_t.rendszam AS tractor_rendszam, v_t.marca AS tractor_marca,
              v_p.id AS trailer_id, v_p.rendszam AS trailer_rendszam, v_p.marca AS trailer_marca
       FROM orders o
       LEFT JOIN vehicles v_t ON v_t.company_id = o.company_id
         AND (v_t.id = o.tractor_id OR (o.tractor_id IS NULL AND v_t.rendszam = o.rendszam_camion))
       LEFT JOIN vehicles v_p ON v_p.company_id = o.company_id
         AND (v_p.id = o.trailer_id OR (o.trailer_id IS NULL AND v_p.rendszam = o.rendszam_remorca))
       WHERE o.company_id = $1
         AND o.status NOT IN ('Finalizat','Anulat')
       ORDER BY o.created_at DESC
       LIMIT 50`,
      [req.session.user.company_id]
    );
    return res.json({ result: { ok: true, orders: r.rows } });
  } catch (err) {
    console.error('getOrdersForRoutePlanning hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
  }
};

// ─── Járművek a routinghoz (vontató + pótkocsi) ─────────────
// has_gps: a rendszámhoz van-e CargoTrack párosítás (vehicle_gps_map).
handlers.getVehiclesForRouting = async function (req, res, args) {
  try {
    if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
      return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
    }
    const r = await pool.query(
      `SELECT id, rendszam, marca, model, tip,
              height_cm, width_cm, length_cm,
              weight_kg, weight_per_axle_kg,
              axle_count, trailer_count,
              tunnel_category, hazardous_goods,
              fuel_per_100km, nota,
              EXISTS(
                SELECT 1 FROM vehicle_gps_map vgm
                WHERE vgm.company_id = vehicles.company_id
                  AND vgm.rendszam = vehicles.rendszam
              ) AS has_gps
       FROM vehicles
       WHERE company_id = $1 AND activ = TRUE
       ORDER BY tip, rendszam`,
      [req.session.user.company_id]
    );
    return res.json({ result: { ok: true, vehicles: r.rows } });
  } catch (err) {
    console.error('getVehiclesForRouting hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
  }
};

// ─── Élő GPS pozíció egy járműhöz ───────────────────────────
handlers.getVehicleGpsPosition = async function (req, res, args) {
  try {
    if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
      return res.json({ result: { ok: false, message: 'Nincs jogosultsag' } });
    }
    const cid = req.session.user.company_id;
    const a = Array.isArray(args) ? (args[0] || {}) : (args || {});
    const vehicleId = parseInt(a.vehicleId, 10);
    if (!vehicleId) return res.json({ result: { ok: false, message: 'Hiányzó jármű azonosító' } });

    const vr = await pool.query('SELECT rendszam FROM vehicles WHERE id = $1 AND company_id = $2', [vehicleId, cid]);
    if (!vr.rows.length) return res.json({ result: { ok: false, message: 'Jármű nem található' } });
    const rendszam = vr.rows[0].rendszam;

    const apiKey = await getCargotrackKey(cid);
    if (!apiKey) return res.json({ result: { ok: false, message: 'GPS pozíció nem elérhető' } });
    const objectId = await objectIdForRendszam(cid, rendszam);
    if (!objectId) return res.json({ result: { ok: false, message: 'GPS pozíció nem elérhető' } });

    const st = await ctSvc.getLatestStatus(apiKey, objectId);
    if (!st || st.latitude == null || st.longitude == null) {
      return res.json({ result: { ok: false, message: 'GPS pozíció nem elérhető' } });
    }
    return res.json({ result: {
      ok: true, lat: st.latitude, lng: st.longitude, rendszam,
      updated_at: st.datetime, speed: st.speed,
    } });
  } catch (err) {
    console.error('getVehicleGpsPosition hiba:', err);
    return res.json({ result: { ok: false, message: 'GPS pozíció nem elérhető' } });
  }
};

// ─── Útvonal számítása (Photon geokódolás + OSRM routing) ────
// A válasz-formátum a korábbi HERE-s változattal kompatibilis
// (polyline/legs/waypoints/notices/violations/fuelEstimateL), így a
// kliens (utvonaltervezes.html) rajzoló-kódja változatlanul működik.
handlers.calculateRoute = async function (req, res, args) {
  try {
    if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
      return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
    }
    const cid = req.session.user.company_id;
    if (await routeFeatureOff(cid)) {
      return res.json({ result: { ok: false, err: 'Az útvonaltervezés nincs előfizetve ennél a cégnél.' } });
    }
    const a = Array.isArray(args) ? (args[0] || {}) : (args || {});
    const tractorId = parseInt(a.tractorId, 10) || null;
    let waypoints = Array.isArray(a.waypoints) ? a.waypoints.slice() : [];
    waypoints = waypoints.filter((w) => w && (w.address || (w.lat != null && w.lng != null)));
    if (waypoints.length < 2) {
      return res.json({ result: { ok: false, err: 'Legalább a felrakó és lerakó pont szükséges.' } });
    }
    if (waypoints.length > 9) waypoints = waypoints.slice(0, 9); // fair-use védelem

    // 1) Vontató (csak ellenőrzés + fogyasztás a becsléshez; multi-tenant)
    let fuelPer100 = null;
    if (tractorId) {
      const tr = await pool.query(
        'SELECT fuel_per_100km FROM vehicles WHERE id = $1 AND company_id = $2', [tractorId, cid]);
      if (!tr.rows.length) return res.json({ result: { ok: false, err: 'A vontató nem található.' } });
      fuelPer100 = tr.rows[0].fuel_per_100km;
    }

    // 2) Geokódolás a koordináta nélküli pontokra (Photon — ingyenes)
    const resolved = [];
    for (const w of waypoints) {
      if (w.lat != null && w.lng != null) {
        resolved.push({ type: w.type || 'waypoint', lat: w.lat, lng: w.lng, label: w.address || (Number(w.lat).toFixed(4) + ', ' + Number(w.lng).toFixed(4)) });
      } else {
        const g = await geocodeFree(w.address);
        resolved.push({ type: w.type || 'waypoint', lat: g.lat, lng: g.lng, label: w.address || g.label });
      }
    }

    // 3) Routing szakaszonként — ORS driving-hgv (kamionos), ha van kulcs;
    //    különben / hiba esetén OSRM (autós). Minden pontpár külön hívás,
    //    így szakaszonkénti polyline-t kapunk (a kliens színezve rajzolja).
    const cp = (a.params && typeof a.params === 'object') ? a.params : {};
    const useOrs = !!process.env.ORS_API_KEY;
    let profile = useOrs ? 'truck-ors' : 'car-free';
    let polyline = [];
    let distanceMeters = 0;
    let durationSeconds = 0;
    const legs = [];
    for (let i = 0; i < resolved.length - 1; i++) {
      const from = resolved[i];
      const to = resolved[i + 1];
      let leg;
      if (useOrs && profile === 'truck-ors') {
        try { leg = await orsLeg(from, to, cp); }
        catch (e) { profile = 'car-free'; leg = await osrmLeg(from, to); } // fallback
      } else {
        leg = await osrmLeg(from, to);
      }
      legs.push({
        fromType: from.type || null,
        toType: to.type || null,
        fromLabel: from.label || null,
        toLabel: to.label || null,
        distanceMeters: Math.round(leg.distance),
        durationSeconds: Math.round(leg.duration),
        polyline: leg.polyline,
      });
      distanceMeters += leg.distance;
      durationSeconds += leg.duration;
      let dd = leg.polyline;
      if (polyline.length && dd.length) dd = dd.slice(1); // szakaszhatáron duplikált pont
      polyline = polyline.concat(dd);
    }
    distanceMeters = Math.round(distanceMeters);
    durationSeconds = Math.round(durationSeconds);

    // 4) Fogyasztásbecslés a vontató L/100km értékéből
    let fuelEstimateL = null;
    if (fuelPer100 != null) {
      fuelEstimateL = Math.round((distanceMeters / 1000 / 100) * parseFloat(fuelPer100) * 10) / 10;
    }

    return res.json({ result: {
      ok: true,
      polyline,
      distanceMeters,
      durationSeconds,
      legs,
      waypoints: resolved,
      // A tiltott-szakasz jelölés (violations) egyik ingyenes profilban sem elérhető.
      notices: [],
      violations: [],
      profile,   // 'truck-ors' (ORS_API_KEY-jel, kamion-paraméterekkel) vagy 'car-free' (OSRM)
      fuelEstimateL,
    } });
  } catch (err) {
    console.error('calculateRoute hiba:', err);
    const msg = err && err.message ? err.message : 'Szerver hiba az útvonaltervezésnél.';
    return res.json({ result: { ok: false, err: msg } });
  }
};

// ─── Térképes km-becslés a FUVAR-KIÍRÓHOZ (külön az útvonaltervezőtől) ──
// OPT-IN funkció-kapcsoló: 'order-route-map' — a developer cégenként
// engedélyezi (hiányzó sor = KI; csak az explicit enabled=true kapcsol be).
// NEM keverendő az 'utvonaltervezes' prémium menüvel: ez alap km-segéd.
async function routeMapFeatureOn(companyId) {
  if (!companyId) return false;
  try {
    const r = await pool.query(
      "SELECT enabled FROM company_features WHERE company_id = $1 AND feature_key = 'order-route-map'",
      [companyId]);
    return r.rows.length ? r.rows[0].enabled === true : false;
  } catch (e) { return false; }
}

// Geokódolás geo_cache-sel — a közös lib/routeEstimate.js-ben él (a beérkező
// megrendelés jóváhagyása is onnan számol automata km-et a fuvarlistára).
const { estimateRoute } = require('../lib/routeEstimate');

// args: [{ waypoints:[{type, address?, lat?, lng?}] }]
// → { ok, km, durationSeconds, polyline:[[lat,lng]], waypoints:[{type,lat,lng,label}] }
// Csak Admin/Manager + az 'order-route-map' kapcsoló bekapcsolt állapotában.
handlers.orderRouteEstimate = async function (req, res, args) {
  try {
    if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
      return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
    }
    const cid = req.session.user.company_id;
    if (!(await routeMapFeatureOn(cid))) {
      return res.json({ result: { ok: false, err: 'A térképes útvonal-számítás nincs engedélyezve ennél a cégnél.' } });
    }
    const a = Array.isArray(args) ? (args[0] || {}) : (args || {});
    const est = await estimateRoute(a.waypoints);
    return res.json({ result: { ok: true, km: est.km, durationSeconds: est.durationSeconds,
      polyline: est.polyline, waypoints: est.waypoints } });
  } catch (err) {
    console.error('orderRouteEstimate hiba:', err);
    return res.json({ result: { ok: false, err: (err && err.message) || 'Szerver hiba az útvonal-számításnál.' } });
  }
};

module.exports = handlers;