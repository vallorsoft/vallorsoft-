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
// Opcionális `q` keresés: fuvar-szám / belső id / ügyfél / felrakó / lerakó.
// Az aktív fuvarok elöl; a lezárt (Finalizat) is betölthető utólagos ellenőrzésre.
handlers.getOrdersForRoutePlanning = async function (req, res, args) {
  try {
    if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
      return res.json({ result: { ok: false, err: 'Acces interzis' } });
    }
    const a = Array.isArray(args) ? (args[0] || {}) : (args || {});
    const q = String(a.q || '').trim().slice(0, 80);
    const params = [req.session.user.company_id];
    let qSql = '';
    if (q) {
      params.push('%' + q.toLowerCase() + '%');
      qSql = ` AND (LOWER(COALESCE(o.fuvar_no,'')) LIKE $2 OR LOWER(o.id) LIKE $2
                OR LOWER(COALESCE(o.client,'')) LIKE $2
                OR LOWER(COALESCE(o.loc_incarcare,'')) LIKE $2
                OR LOWER(COALESCE(o.loc_descarcare,'')) LIKE $2)`;
    }
    const r = await pool.query(
      `SELECT o.id, o.fuvar_no, o.loc_incarcare, o.loc_descarcare, o.status, o.client,
              o.data_incarcare, o.data_descarcare, o.km,
              v_t.id AS tractor_id, v_t.rendszam AS tractor_rendszam, v_t.marca AS tractor_marca,
              v_p.id AS trailer_id, v_p.rendszam AS trailer_rendszam, v_p.marca AS trailer_marca
       FROM orders o
       LEFT JOIN vehicles v_t ON v_t.company_id = o.company_id
         AND (v_t.id = o.tractor_id OR (o.tractor_id IS NULL AND v_t.rendszam = o.rendszam_camion))
       LEFT JOIN vehicles v_p ON v_p.company_id = o.company_id
         AND (v_p.id = o.trailer_id OR (o.trailer_id IS NULL AND v_p.rendszam = o.rendszam_remorca))
       WHERE o.company_id = $1
         AND o.status <> 'Anulat'${qSql}
       ORDER BY (o.status = 'Finalizat') ASC, o.created_at DESC
       LIMIT 60`,
      params
    );
    return res.json({ result: { ok: true, orders: r.rows } });
  } catch (err) {
    console.error('getOrdersForRoutePlanning hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// Egy fuvar ÖSSZES pontja az útvonaltervezőhöz, a diszpécser sorrendjében.
// Forrás: order_stops (seq_index), régi fuvarnál a felrakó/lerakó mező.
// Ha a fuvarhoz mentett route_geo van, és annak megállói egyeznek a stopokkal,
// a koordinátákat és a köztespontokat (csak km-hez) is átvesszük → ugyanaz a km,
// mint a fuvar-kiírásnál. Belső függvény a teszthez: _buildOrderRoutePoints.
function _buildOrderRoutePoints(order, stops, routeGeo) {
  const fmtDate = (d) => {
    if (!d) return null;
    if (d instanceof Date) return d.toISOString().slice(0, 10);
    return String(d).slice(0, 10);
  };
  let pts = (stops || []).map((s) => ({
    kind: s.kind === 'pickup' ? 'pickup' : 'delivery',
    label: String(s.loc || '').slice(0, 200),
    firma: s.firma || null,
    date: fmtDate(s.data),
    done: !!s.done_at,
    lat: null, lng: null,
  })).filter((p) => p.label);
  if (!pts.length) {
    if (order.loc_incarcare) pts.push({ kind: 'pickup', label: String(order.loc_incarcare).slice(0, 200), firma: order.firma_incarcare || null, date: fmtDate(order.data_incarcare), done: !!order.incarcat_at, lat: null, lng: null });
    if (order.loc_descarcare) pts.push({ kind: 'delivery', label: String(order.loc_descarcare).slice(0, 200), firma: order.firma_descarcare || null, date: fmtDate(order.data_descarcare), done: !!order.descarcat_at, lat: null, lng: null });
  }
  let rg = routeGeo;
  if (typeof rg === 'string') { try { rg = JSON.parse(rg); } catch (e) { rg = null; } }
  const wps = (rg && Array.isArray(rg.waypoints)) ? rg.waypoints : [];
  const stopWps = wps.filter((w) => w && w.type !== 'waypoint');
  let fromGeo = false;
  if (wps.length >= 2 && stopWps.length === pts.length) {
    // A mentett útvonal sorrendjét követjük; a megállók címkéi a stopokból.
    let si = 0;
    const merged = [];
    wps.forEach((w) => {
      const hasC = w.lat != null && w.lng != null && Number.isFinite(Number(w.lat)) && Number.isFinite(Number(w.lng));
      if (w.type === 'waypoint') {
        if (!hasC && !w.address) return;
        merged.push({ kind: 'via', label: String(w.address || (Number(w.lat).toFixed(4) + ', ' + Number(w.lng).toFixed(4))).slice(0, 200),
          firma: null, date: null, done: false, lat: hasC ? Number(w.lat) : null, lng: hasC ? Number(w.lng) : null });
      } else {
        const p = Object.assign({}, pts[si++]);
        if (hasC) { p.lat = Number(w.lat); p.lng = Number(w.lng); }
        merged.push(p);
      }
    });
    pts = merged;
    fromGeo = true;
  }
  return { points: pts.slice(0, 25), fromGeo, truncated: pts.length > 25 };
}

handlers.getOrderRouteForPlanning = async function (req, res, args) {
  try {
    if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
      return res.json({ result: { ok: false, err: 'Acces interzis' } });
    }
    const cid = req.session.user.company_id;
    if (await routeFeatureOff(cid)) {
      return res.json({ result: { ok: false, err: 'Planificarea rutei nu este abonata la aceasta firma.' } });
    }
    const a = Array.isArray(args) ? (args[0] || {}) : (args || {});
    const id = String(a.orderId || a.id || '').trim().slice(0, 40);
    if (!id) return res.json({ result: { ok: false, err: 'Lipseste cursa.' } });
    const or = await pool.query(
      `SELECT o.*, v_t.id AS tractor_vid, v_t.rendszam AS tractor_rendszam, v_t.fuel_per_100km AS tractor_fuel
       FROM orders o
       LEFT JOIN vehicles v_t ON v_t.company_id = o.company_id
         AND (v_t.id = o.tractor_id OR (o.tractor_id IS NULL AND v_t.rendszam = o.rendszam_camion))
       WHERE o.id = $1 AND o.company_id = $2
       LIMIT 1`,
      [id, cid]
    );
    if (!or.rows.length) return res.json({ result: { ok: false, err: 'Cursa nu a fost gasita.' } });
    const o = or.rows[0];
    let stops = [];
    try {
      const sr = await pool.query(
        `SELECT kind, stop_index, seq_index, loc, firma, data, done_at
         FROM order_stops WHERE order_id = $1 AND company_id = $2
         ORDER BY COALESCE(seq_index, 999999) ASC,
                  CASE WHEN kind = 'pickup' THEN 0 ELSE 1 END ASC, stop_index ASC`,
        [id, cid]
      );
      stops = sr.rows;
    } catch (e) { stops = []; } // migráció előtti DB → top-mezők
    const built = _buildOrderRoutePoints(o, stops, o.route_geo);
    if (built.points.length < 2) {
      return res.json({ result: { ok: false, err: 'Cursa nu are suficiente puncte (incarcare + descarcare).' } });
    }
    return res.json({ result: {
      ok: true,
      order: {
        id: o.id, fuvar_no: o.fuvar_no || null, client: o.client || null, status: o.status,
        pret: o.pret != null ? Number(o.pret) : null, km: o.km != null ? Number(o.km) : null,
        load_type: o.load_type || null, suly_kg: o.suly_kg != null ? Number(o.suly_kg) : null,
        tractor_id: o.tractor_vid || null, tractor_rendszam: o.tractor_rendszam || o.rendszam_camion || null,
        trailer_rendszam: o.rendszam_remorca || null, nume_sofer: o.nume_sofer || null,
        fuel_per_100km: o.tractor_fuel != null ? Number(o.tractor_fuel) : null,
      },
      points: built.points,
      fromSavedRoute: built.fromGeo,
      truncated: built.truncated,
    } });
  } catch (err) {
    console.error('getOrderRouteForPlanning hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// ─── Járművek a routinghoz (vontató + pótkocsi) ─────────────
// has_gps: a rendszámhoz van-e CargoTrack párosítás (vehicle_gps_map).
handlers.getVehiclesForRouting = async function (req, res, args) {
  try {
    if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
      return res.json({ result: { ok: false, err: 'Acces interzis' } });
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
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// ─── Élő GPS pozíció egy járműhöz ───────────────────────────
handlers.getVehicleGpsPosition = async function (req, res, args) {
  try {
    if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
      return res.json({ result: { ok: false, message: 'Acces interzis' } });
    }
    const cid = req.session.user.company_id;
    const a = Array.isArray(args) ? (args[0] || {}) : (args || {});
    const vehicleId = parseInt(a.vehicleId, 10);
    if (!vehicleId) return res.json({ result: { ok: false, message: 'ID-ul vehiculului lipseste' } });

    const vr = await pool.query('SELECT rendszam FROM vehicles WHERE id = $1 AND company_id = $2', [vehicleId, cid]);
    if (!vr.rows.length) return res.json({ result: { ok: false, message: 'Vehiculul nu a fost gasit' } });
    const rendszam = vr.rows[0].rendszam;

    const apiKey = await getCargotrackKey(cid);
    if (!apiKey) return res.json({ result: { ok: false, message: 'Pozitia GPS nu este disponibila' } });
    const objectId = await objectIdForRendszam(cid, rendszam);
    if (!objectId) return res.json({ result: { ok: false, message: 'Pozitia GPS nu este disponibila' } });

    const st = await ctSvc.getLatestStatus(apiKey, objectId);
    if (!st || st.latitude == null || st.longitude == null) {
      return res.json({ result: { ok: false, message: 'Pozitia GPS nu este disponibila' } });
    }
    return res.json({ result: {
      ok: true, lat: st.latitude, lng: st.longitude, rendszam,
      updated_at: st.datetime, speed: st.speed,
    } });
  } catch (err) {
    console.error('getVehicleGpsPosition hiba:', err);
    return res.json({ result: { ok: false, message: 'Pozitia GPS nu este disponibila' } });
  }
};

// ─── Útvonal számítása (HERE kamion-routing, 40 t; OSRM nincs) ────
// A válasz-formátum a korábbi HERE-s változattal kompatibilis
// (polyline/legs/waypoints/notices/violations/fuelEstimateL), így a
// kliens (utvonaltervezes.html) rajzoló-kódja változatlanul működik.
handlers.calculateRoute = async function (req, res, args) {
  try {
    if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
      return res.json({ result: { ok: false, err: 'Acces interzis' } });
    }
    const cid = req.session.user.company_id;
    if (await routeFeatureOff(cid)) {
      return res.json({ result: { ok: false, err: 'Planificarea rutei nu este abonata la aceasta firma.' } });
    }
    const a = Array.isArray(args) ? (args[0] || {}) : (args || {});
    const tractorId = parseInt(a.tractorId, 10) || null;
    let waypoints = Array.isArray(a.waypoints) ? a.waypoints.slice() : [];
    waypoints = waypoints.filter((w) => w && (w.address || (w.lat != null && w.lng != null)));
    if (waypoints.length < 2) {
      return res.json({ result: { ok: false, err: 'Sunt necesare cel putin punctul de incarcare si cel de descarcare.' } });
    }
    if (waypoints.length > 9) waypoints = waypoints.slice(0, 9); // fair-use védelem

    // 1) Vontató (csak ellenőrzés + fogyasztás a becsléshez; multi-tenant)
    let fuelPer100 = null;
    if (tractorId) {
      const tr = await pool.query(
        'SELECT fuel_per_100km FROM vehicles WHERE id = $1 AND company_id = $2', [tractorId, cid]);
      if (!tr.rows.length) return res.json({ result: { ok: false, err: 'Capul tractor nu a fost gasit.' } });
      fuelPer100 = tr.rows[0].fuel_per_100km;
    }

    // 2-3) Útvonal KIZÁRÓLAG HERE kamion-routinggal (40 t) — HERE-kulcs nélkül hiba
    //      (az autós OSRM km kamionra félrevezető, ezért nincs tartalék).
    const est = await require('../lib/routeEstimate').estimateRoute(waypoints, cid);
    const resolved = est.waypoints;
    const profile = 'truck-here';
    const polyline = est.polyline;
    let distanceMeters = est.km * 1000;
    let durationSeconds = est.durationSeconds;
    const legs = est.legs.map((l, i) => ({
      fromType: (resolved[i] && resolved[i].type) || null,
      toType: (resolved[i + 1] && resolved[i + 1].type) || null,
      fromLabel: l.fromLabel || null, toLabel: l.toLabel || null,
      distanceMeters: Math.round((l.km || 0) * 1000), durationSeconds: l.durationSeconds || 0,
      polyline: est.legs.length === 1 ? polyline : [],
    }));
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
      profile,        // 'truck-here' (HERE kamion, 40 t)
      truckRequested: true,
      truckAvailable: true,
      fuelEstimateL,
    } });
  } catch (err) {
    console.error('calculateRoute hiba:', err);
    const msg = err && err.message ? err.message : 'Eroare de server la planificarea rutei.';
    return res.json({ result: { ok: false, err: msg } });
  }
};

// ─── Térképes km-becslés a FUVAR-KIÍRÓHOZ (külön az útvonaltervezőtől) ──
// Funkció-kapcsoló: 'order-route-map' — alapból BE (a kódbázis „hiányzó sor =
// bekapcsolva" konvenciója szerint); a developer cégenként KI tudja kapcsolni
// (explicit enabled=false). NEM keverendő az 'utvonaltervezes' prémium menüvel:
// ez alap km-/útvonal-segéd a fuvar-kiíráshoz.
async function routeMapFeatureOn(companyId) {
  if (!companyId) return false;
  try {
    const r = await pool.query(
      "SELECT enabled FROM company_features WHERE company_id = $1 AND feature_key = 'order-route-map'",
      [companyId]);
    return r.rows.length ? r.rows[0].enabled === true : true;
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
      return res.json({ result: { ok: false, err: 'Acces interzis' } });
    }
    const cid = req.session.user.company_id;
    if (!(await routeMapFeatureOn(cid))) {
      return res.json({ result: { ok: false, err: 'Calculul rutei pe harta nu este activat la aceasta firma.' } });
    }
    const a = Array.isArray(args) ? (args[0] || {}) : (args || {});
    // minden pont a megadott sorrendben (20 pont fölött darabolva), szakaszonként rakott / üres jelzéssel
    const est = await require('../lib/routeChain').routeChain(cid, a.waypoints);
    return res.json({ result: { ok: true, km: est.km, durationSeconds: est.durationSeconds,
      polyline: est.polyline, waypoints: est.waypoints.map((w) => ({ type: w.type, lat: w.lat, lng: w.lng, label: w.address })),
      legs: est.legs.map((l) => ({ fromLabel: l.from, toLabel: l.to, km: l.km, durationSeconds: l.sec, empty: l.empty })),
      loaded_km: est.loaded_km, empty_km: est.empty_km, source: est.source, free_reason: est.free_reason || null } });
  } catch (err) {
    console.error('orderRouteEstimate hiba:', err);
    return res.json({ result: { ok: false, err: (err && err.message) || 'Eroare de server la calculul rutei.' } });
  }
};

module.exports = handlers;
// Teszt-segéd — NEM RPC (nem-enumerable, a registry nem fűzi be)
Object.defineProperty(module.exports, '_buildOrderRoutePoints', { value: _buildOrderRoutePoints, enumerable: false });