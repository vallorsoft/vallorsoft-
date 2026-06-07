// ============================================================
//  VallorSoft — handlers/routePlannerHandlers.js
//  Útvonaltervezés (HERE Maps) — szerver oldali handlerek.
//  A HERE_API_KEY SOHA nem kerül a kliensre; a geocoding + routing
//  hívások itt, szerver oldalon futnak.
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
const { logHereTransaction } = require('../lib/hereUsage');

const HERE_TIMEOUT_MS = 15000;

// --- HERE flexible polyline dekódolás a hivatalos @here/flexpolyline csomaggal ---
// A decode() { precision, thirdDim, polyline:[[lat,lng(,z)],...] } objektumot ad,
// helyes [lat,lng] sorrendben (a Leaflet is így várja).
const flexpolyline = require('@here/flexpolyline');
function decodeFlexPolyline(encoded) {
  try {
    const r = flexpolyline.decode(encoded);
    if (!r || !Array.isArray(r.polyline)) return [];
    // 3D esetén az elevation-t eldobjuk, csak [lat,lng] kell.
    return r.polyline.map(function (p) { return [p[0], p[1]]; });
  } catch (e) {
    return [];
  }
}

// HERE jármű-korlátozás emberi címkéje a notice.details alapján.
function noticeLabel(n) {
  if (!n) return 'Korlátozás';
  const d = (n.details && n.details[0]) || {};
  const gw = (d.maxGrossWeight != null) ? d.maxGrossWeight : (d.maxWeight && d.maxWeight.value);
  if (gw != null) return 'Súlykorlátozás: max ' + gw + ' kg';
  if (d.maxHeight != null) return 'Magasságkorlátozás: max ' + d.maxHeight + ' cm';
  if (d.maxWidth != null) return 'Szélességkorlátozás: max ' + d.maxWidth + ' cm';
  if (d.maxLength != null) return 'Hosszkorlátozás: max ' + d.maxLength + ' cm';
  if (d.maxWeightPerAxle != null) return 'Tengelyterhelés-korlátozás: max ' + d.maxWeightPerAxle + ' kg';
  return n.title || 'Jármű-korlátozás';
}

async function hereGet(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), HERE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    let body;
    try { body = await res.json(); } catch (_) { body = {}; }
    if (!res.ok) {
      const msg = (body && (body.title || body.error_description || body.error)) || ('HERE hiba (' + res.status + ')');
      const e = new Error(msg);
      e.status = res.status;
      throw e;
    }
    return body;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('A HERE szolgáltatás időtúllépés miatt nem válaszolt.');
    throw e;
  } finally {
    clearTimeout(t);
  }
}

// Opcionális HERE-hívás: hiba/429/megszűnt végpont esetén null (nem dob).
async function fetchJsonSafe(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { return null; }
  finally { clearTimeout(t); }
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

// ─── Útvonal számítása (HERE Geocoding + Routing, waypointokkal) ──
handlers.calculateRoute = async function (req, res, args) {
  try {
    if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
      return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
    }
    const apiKey = process.env.HERE_API_KEY;
    if (!apiKey) return res.json({ result: { ok: false, err: 'A HERE_API_KEY nincs beállítva a szerveren.' } });

    const cid = req.session.user.company_id;
    const uid = req.session.user.id;
    if (await routeFeatureOff(cid)) {
      return res.json({ result: { ok: false, err: 'Az útvonaltervezés nincs előfizetve ennél a cégnél.' } });
    }
    const a = Array.isArray(args) ? (args[0] || {}) : (args || {});
    const tractorId = parseInt(a.tractorId, 10) || null;
    const trailerId = parseInt(a.trailerId, 10) || null;
    let waypoints = Array.isArray(a.waypoints) ? a.waypoints.slice() : [];
    waypoints = waypoints.filter((w) => w && (w.address || (w.lat != null && w.lng != null)));
    if (waypoints.length < 2) {
      return res.json({ result: { ok: false, err: 'Legalább a felrakó és lerakó pont szükséges.' } });
    }

    // 1) Vontató (csak ellenőrzés + fogyasztás a becsléshez; multi-tenant)
    let fuelPer100 = null;
    if (tractorId) {
      const tr = await pool.query(
        'SELECT fuel_per_100km FROM vehicles WHERE id = $1 AND company_id = $2', [tractorId, cid]);
      if (!tr.rows.length) return res.json({ result: { ok: false, err: 'A vontató nem található.' } });
      fuelPer100 = tr.rows[0].fuel_per_100km;
    }

    // 2) Jármű-paraméterek a KLIENSTŐL — a felhasználó által megadott, ÖSSZEKAPCSOLT
    //    értékek (HERE v8 a végső kombinált méreteket/súlyt várja; nem összegzünk!).
    const cp = (a.params && typeof a.params === 'object') ? a.params : {};

    // 3) Geocoding a koordináta nélküli pontokra (minden hívás = 1 'geocode' tranzakció)
    const geocode = async (addr) => {
      const url = 'https://geocode.search.hereapi.com/v1/geocode?q=' +
        encodeURIComponent(addr) + '&lang=ro&apiKey=' + encodeURIComponent(apiKey);
      const data = await hereGet(url);
      logHereTransaction('geocode', 1, cid, uid);
      const item = (data.items || [])[0];
      if (!item || !item.position) {
        const e = new Error('Nem található koordináta ehhez a címhez: ' + addr);
        throw e;
      }
      return { lat: item.position.lat, lng: item.position.lng, label: item.address && item.address.label };
    };
    const resolved = [];
    for (const w of waypoints) {
      if (w.lat != null && w.lng != null) {
        resolved.push({ type: w.type || 'waypoint', lat: w.lat, lng: w.lng, label: w.address || (w.lat.toFixed(4) + ', ' + w.lng.toFixed(4)) });
      } else {
        const g = await geocode(w.address);
        resolved.push({ type: w.type || 'waypoint', lat: g.lat, lng: g.lng, label: w.address || g.label });
      }
    }

    // 4) Routing — origin/destination + via a közbülső pontokra
    const params = [
      'transportMode=truck',
      'origin=' + resolved[0].lat + ',' + resolved[0].lng,
      'destination=' + resolved[resolved.length - 1].lat + ',' + resolved[resolved.length - 1].lng,
      // 'notices' NEM érvényes return-típus a v8-ban; a notices a section-ökben automatikusan jön.
      // 'spans=notices' (KÜLÖN paraméter) adja meg, mely polyline-szakaszon sérül egy korlátozás.
      'return=polyline,summary,typicalDuration',
      'spans=notices',
    ];
    for (let k = 1; k < resolved.length - 1; k++) {
      params.push('via=' + resolved[k].lat + ',' + resolved[k].lng);
    }
    // HERE v8 jármű-paraméterek a kliens (összekapcsolt) értékeiből.
    const intOrNull = (x) => { const n = parseInt(x, 10); return Number.isFinite(n) ? n : null; };
    const TYPES = ['tractor', 'straightTruck'];
    const TUN = ['B', 'C', 'D', 'E'];
    const HAZ = ['explosive', 'gas', 'flammable', 'combustible', 'organic', 'poison', 'harmfulToWater'];
    const pushIf = (name, val) => { if (val !== null && val !== undefined && val !== '') params.push(name + '=' + encodeURIComponent(val)); };
    if (TYPES.includes(cp.type)) params.push('vehicle[type]=' + cp.type);
    pushIf('vehicle[height]', intOrNull(cp.height));
    pushIf('vehicle[width]', intOrNull(cp.width));
    pushIf('vehicle[length]', intOrNull(cp.length));
    pushIf('vehicle[grossWeight]', intOrNull(cp.grossWeight));
    pushIf('vehicle[weightPerAxle]', intOrNull(cp.weightPerAxle));
    pushIf('vehicle[axleCount]', intOrNull(cp.axleCount));
    pushIf('vehicle[trailerCount]', intOrNull(cp.trailerCount));
    pushIf('vehicle[tunnelCategory]', TUN.includes(cp.tunnelCategory) ? cp.tunnelCategory : null);
    pushIf('vehicle[shippedHazardousGoods]', HAZ.includes(cp.hazardousGoods) ? cp.hazardousGoods : null);
    params.push('apiKey=' + encodeURIComponent(apiKey));

    const routeData = await hereGet('https://router.hereapi.com/v8/routes?' + params.join('&'));
    logHereTransaction('routing_truck', 1, cid, uid);
    const route = (routeData.routes || [])[0];
    if (!route || !route.sections || !route.sections.length) {
      return res.json({ result: { ok: false, err: 'Nem található útvonal a megadott pontok között.' } });
    }

    // 5) Szakaszok -> legs (szakaszonkénti polyline), összesítés, notices, tiltott szakaszok
    let polyline = [];
    let distanceMeters = 0;
    let durationSeconds = 0;
    const notices = [];
    const legs = [];
    const violations = [];   // térképen megjelölendő, korlátozást sértő szakaszok
    route.sections.forEach((sec, idx) => {
      const full = sec.polyline ? decodeFlexPolyline(sec.polyline) : [];
      const legDist = sec.summary ? (sec.summary.length || 0) : 0;
      const legDur = sec.summary ? (sec.summary.typicalDuration != null ? sec.summary.typicalDuration : (sec.summary.duration || 0)) : 0;
      const from = resolved[idx] || {};
      const to = resolved[idx + 1] || {};
      legs.push({
        fromType: from.type || null,
        toType: to.type || null,
        fromLabel: from.label || null,
        toLabel: to.label || null,
        distanceMeters: legDist,
        durationSeconds: legDur,
        polyline: full,
      });
      distanceMeters += legDist;
      durationSeconds += legDur;

      const secNotices = sec.notices || [];
      secNotices.forEach((n) => {
        notices.push({ title: n.title || n.code || 'Figyelmeztetés', code: n.code || null, severity: n.severity || null });
      });
      // spans=notices: a span.offset .. következő span.offset közötti szakasz a tiltott rész
      const spans = sec.spans || [];
      spans.forEach((sp, si) => {
        if (sp.notices && sp.notices.length && full.length) {
          const start = sp.offset || 0;
          let end = (spans[si + 1] && spans[si + 1].offset != null) ? spans[si + 1].offset : full.length - 1;
          if (end < start) end = start;
          const sub = full.slice(start, Math.min(end + 1, full.length));
          if (sub.length) {
            const labels = sp.notices.map((ni) => noticeLabel(secNotices[ni])).filter(Boolean);
            violations.push({ polyline: sub, label: (labels.join(' · ') || 'Tiltott szakasz') });
          }
        }
      });

      // összefűzött polyline (a szakaszhatáron a duplikált pontot kihagyjuk)
      let dd = full;
      if (polyline.length && dd.length) dd = dd.slice(1);
      polyline = polyline.concat(dd);
    });

    // 6) Fogyasztásbecslés
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
      notices,
      violations,
      fuelEstimateL,
    } });
  } catch (err) {
    console.error('calculateRoute hiba:', err);
    const msg = err && err.message ? err.message : 'Szerver hiba az útvonaltervezésnél.';
    return res.json({ result: { ok: false, err: msg } });
  }
};

module.exports = handlers;
