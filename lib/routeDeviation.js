// ============================================================
//  VallorSoft — lib/routeDeviation.js
//  Útvonal-eltérés: a tervezett útvonal (HERE kamionos, HERE-kulcs nélkül OSRM)
//  km-e az első állomástól az utolsóig, a köztes állomásokon át, összevetve a
//  GPS-napló szerint ténylegesen megtett km-rel (km-óra különbség, ha nincs:
//  pontok közti távolság). Szabály: ha a kamion más úton ment, de a megtett km
//  nem több a tervezettnél (+ tűrés), az RENDBEN van — csak a többlet-km eltérés.
//  Háttérben fut (cím-felismerő ütemező), felhasználói kérésben nem await-eljük.
//  Minden lekérdezés company_id-szűrt, paraméteres. A HERE-hívás → maps.bump.
// ============================================================
const pool = require('../db');
const gt = require('./gpsTrack');
const maps = require('./mapsProvider');
const autoEv = require('./stopAutoEvents');

const TOL_KM = 5;          // abszolút tűrés (GPS / km-óra pontatlanság)
const TOL_PCT = 3;         // relatív tűrés (%)
const MAX_GEO_PTS = 300;   // a tárolt tervezett nyomvonal ritkítása
const HERE_TIMEOUT_MS = 20000;

const _sec = (v) => { if (!v) return null; const t = v instanceof Date ? v.getTime() : Date.parse(v); return isFinite(t) ? t / 1000 : null; };

// Tiszta döntés (tesztelhető): rendben van-e a megtett km a tervezetthez képest
function judge(plannedKm, actualKm) {
  // (figyelem: JS-ben null >= 0 igaz — ezért külön ellenőrizzük, hogy tényleg szám-e)
  if (plannedKm == null || actualKm == null || !isFinite(plannedKm) || !isFinite(actualKm) || !(plannedKm > 0) || actualKm < 0) {
    return { status: 'no_data' };
  }
  plannedKm = Number(plannedKm); actualKm = Number(actualKm);
  const diff = actualKm - plannedKm;
  const tol = Math.max(TOL_KM, plannedKm * TOL_PCT / 100);
  return { status: diff > tol ? 'deviation' : 'ok', diff_km: Math.round(diff * 10) / 10,
    diff_pct: Math.round(diff / plannedKm * 1000) / 10, tol_km: Math.round(tol * 10) / 10 };
}

// A pont-sorból a [fromSec, toSec] közötti megtett km: km-óra különbség, ha van, különben pont-távolság
function kmBetween(pts, fromSec, toSec) {
  let i0 = -1, i1 = -1;
  for (let i = 0; i < pts.length; i++) {
    const t = pts[i][0];
    if (t >= fromSec && i0 < 0) i0 = i;
    if (t <= toSec) i1 = i;
  }
  if (i0 < 0 || i1 <= i0) return null;
  const odo = gt.odoDelta(pts, i0, i1, 20000);
  if (odo != null && odo > 0) return { km: odo, src: 'odo' };
  return { km: Math.round(gt.sumKm(pts, i0, i1) * 10) / 10, src: 'gps' };
}

function thin(poly, max) {
  if (!Array.isArray(poly) || poly.length <= max) return poly || [];
  const step = Math.ceil(poly.length / max), out = [];
  for (let i = 0; i < poly.length; i += step) out.push([Math.round(poly[i][0] * 1e5) / 1e5, Math.round(poly[i][1] * 1e5) / 1e5]);
  const last = poly[poly.length - 1];
  out.push([Math.round(last[0] * 1e5) / 1e5, Math.round(last[1] * 1e5) / 1e5]);
  return out;
}

async function _hereTruckKm(wps, key, truck) {
  const tp = require('./tollProvider');
  const origin = wps[0].lat + ',' + wps[0].lng, dest = wps[wps.length - 1].lat + ',' + wps[wps.length - 1].lng;
  const via = wps.slice(1, -1).map((w) => 'via=' + w.lat + ',' + w.lng).join('&');
  const tq = tp.truckQuery(tp.mergeTruck(truck || {}));
  const url = 'https://router.hereapi.com/v8/routes?transportMode=truck&origin=' + encodeURIComponent(origin)
    + '&destination=' + encodeURIComponent(dest) + (via ? '&' + via : '') + (tq ? '&' + tq : '')
    + '&return=summary,polyline&apikey=' + encodeURIComponent(key);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), HERE_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error('HERE HTTP ' + r.status);
    const d = await r.json();
    const route = d && d.routes && d.routes[0];
    if (!route) throw new Error('HERE: nincs útvonal');
    let m = 0, poly = [];
    const flex = require('@here/flexpolyline');
    for (const s of route.sections || []) {
      m += Number((s.summary && s.summary.length) || 0);
      if (s.polyline) { try { poly = poly.concat(flex.decode(s.polyline).polyline.map((p) => [p[0], p[1]])); } catch (_) {} }
    }
    return { km: Math.round(m / 100) / 10, poly };
  } finally { clearTimeout(t); }
}

async function plannedRoute(cid, wps, truck) {
  let cfg = { vendor: 'free' };
  try { cfg = await maps.getConfig(cid); } catch (_) {}
  if (cfg.vendor === 'here' && cfg.key) {
    try { const r = await _hereTruckKm(wps, cfg.key, truck); maps.bump(cid, 'here'); return { km: r.km, poly: r.poly, source: 'here' }; }
    catch (e) { console.warn('[RouteDev] HERE hiba, OSRM tartalék:', e.message); }
  }
  const est = require('./routeEstimate');
  const r = await est.estimateRoute(wps.map((w) => ({ lat: w.lat, lng: w.lng })), cid);
  return { km: r.km, poly: r.polyline || [], source: 'osrm' };
}

async function _save(cid, orderId, row) {
  await pool.query(
    `INSERT INTO order_route_deviation (order_id, company_id, planned_km, actual_km, diff_km, diff_pct, status, source, km_source,
       from_at, to_at, planned_geo, detail, checked_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,NOW())
     ON CONFLICT (order_id) DO UPDATE SET company_id=EXCLUDED.company_id, planned_km=EXCLUDED.planned_km, actual_km=EXCLUDED.actual_km,
       diff_km=EXCLUDED.diff_km, diff_pct=EXCLUDED.diff_pct, status=EXCLUDED.status, source=EXCLUDED.source, km_source=EXCLUDED.km_source,
       from_at=EXCLUDED.from_at, to_at=EXCLUDED.to_at, planned_geo=EXCLUDED.planned_geo, detail=EXCLUDED.detail, checked_at=NOW()`,
    [orderId, cid, row.planned_km ?? null, row.actual_km ?? null, row.diff_km ?? null, row.diff_pct ?? null, row.status,
      row.source || null, row.km_source || null, row.from_at || null, row.to_at || null,
      JSON.stringify(row.planned_geo || null), JSON.stringify(row.detail || null)]);
}

// Egy fuvar ellenőrzése: első állomás távozása → utolsó állomás érkezése
async function checkOrder(cid, orderId) {
  const o = (await pool.query(
    `SELECT o.id, o.rendszam_camion, v.weight_kg, v.height_cm, v.length_cm, v.width_cm, v.weight_per_axle_kg,
            v.axle_count, v.trailer_count, v.tip
       FROM orders o
       LEFT JOIN vehicles v ON v.company_id = o.company_id
         AND UPPER(REGEXP_REPLACE(COALESCE(v.rendszam,''),'[^A-Za-z0-9]','','g')) = UPPER(REGEXP_REPLACE(COALESCE(o.rendszam_camion,''),'[^A-Za-z0-9]','','g'))
      WHERE o.id=$1 AND o.company_id=$2 LIMIT 1`, [orderId, cid])).rows[0];
  if (!o) return { status: 'missing' };
  const stops = (await pool.query(
    `SELECT id, kind, loc, actual_lat, actual_lng, gps_arrived_at, gps_left_at, arrived_at, done_at
       FROM order_stops WHERE order_id=$1 AND company_id=$2
      ORDER BY COALESCE(seq_index, 999999), (kind='pickup') DESC, stop_index`, [orderId, cid])).rows;
  const first = stops[0], last = stops[stops.length - 1];
  const fromSec = first ? _sec(first.gps_left_at || first.done_at) : null;
  const toSec = last ? _sec(last.gps_arrived_at || last.arrived_at) : null;
  const pts = stops.filter((s) => s.actual_lat != null && s.actual_lng != null);
  if (stops.length < 2 || pts.length !== stops.length || fromSec == null || toSec == null || toSec <= fromSec) {
    await _save(cid, orderId, { status: 'no_data', detail: { reason: 'stops' } });
    return { status: 'no_data' };
  }
  const wps = stops.map((s) => ({ lat: Number(s.actual_lat), lng: Number(s.actual_lng), kind: s.kind, loc: s.loc || null }));
  const day0 = gt.localDay(fromSec * 1000), day1 = gt.localDay(toSec * 1000);
  const track = await autoEv.loadPoints(cid, o.rendszam_camion, day0, day1);
  const act = kmBetween(track, fromSec, toSec);
  if (!act) {
    await _save(cid, orderId, { status: 'no_data', detail: { reason: 'gps' } });
    return { status: 'no_data' };
  }
  const tp = require('./tollProvider');
  const plan = await plannedRoute(cid, wps, tp.truckFromVehicle(o));
  const j = judge(plan.km, act.km);
  const row = { planned_km: plan.km, actual_km: act.km, diff_km: j.diff_km, diff_pct: j.diff_pct, status: j.status,
    source: plan.source, km_source: act.src, from_at: new Date(fromSec * 1000).toISOString(), to_at: new Date(toSec * 1000).toISOString(),
    planned_geo: thin(plan.poly, MAX_GEO_PTS), detail: { waypoints: wps, tol_km: j.tol_km } };
  await _save(cid, orderId, row);
  return { status: j.status, planned_km: plan.km, actual_km: act.km };
}

// Sor az ütemezőnek: lezárt fuvarok (60 nap), ahol a cím-felismerés már lefutott;
// „nincs adat" esetén 2 naponta újrapróbál.
async function pickQueue(limit) {
  const { rows } = await pool.query(
    `SELECT o.id, o.company_id FROM orders o
      WHERE o.status = 'Finalizat' AND COALESCE(o.finalized_at, o.updated_at) > NOW() - INTERVAL '60 days'
        AND COALESCE(o.rendszam_camion,'') <> ''
        AND EXISTS (SELECT 1 FROM order_stops s WHERE s.order_id=o.id AND s.company_id=o.company_id AND s.gps_arrived_at IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM order_route_deviation d WHERE d.order_id=o.id
                         AND (d.status <> 'no_data' OR d.checked_at > NOW() - INTERVAL '2 days'))
      ORDER BY o.finalized_at DESC NULLS LAST LIMIT $1`, [limit]);
  return rows;
}

module.exports = { judge, kmBetween, thin, plannedRoute, checkOrder, pickQueue, TOL_KM, TOL_PCT };
