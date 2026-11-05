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

// ── Térképes nézet: terv vs. valós út + mutatók ─────────────
const OFF_KM = 1;          // ennél messzebb a tervtől = „letért"
const STOP_MIN_SEC = 300;  // megállás (≥ 5 perc)

// Pont távolsága (km) egy [lat,lng] vonaltól — síkvetület, rövid távon pontos
function distToLineKm(lat, lng, line) {
  if (!line || line.length === 0) return null;
  const kx = 111.32 * Math.cos(lat * Math.PI / 180), ky = 110.57;
  let best = Infinity;
  for (let i = 0; i < line.length; i++) {
    const a = line[i], b = line[i + 1] || line[i];
    const ax = (a[1] - lng) * kx, ay = (a[0] - lat) * ky, bx = (b[1] - lng) * kx, by = (b[0] - lat) * ky;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? -(ax * dx + ay * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const px = ax + t * dx, py = ay + t * dy;
    const d = Math.sqrt(px * px + py * py);
    if (d < best) best = d;
  }
  return best;
}

// A valós nyomvonal mutatói + a tervtől letért szakaszok (tiszta, tesztelhető)
function trackStats(track, fromSec, toSec, planLine, maxPts) {
  const win = (track || []).filter((p) => p[0] >= fromSec && p[0] <= toSec && isFinite(p[1]) && isFinite(p[2]));
  const out = { points: [], off: [], duration_h: null, drive_h: null, avg_kmh: null, max_kmh: null, stops: 0,
    stop_h: 0, max_off_km: null, off_km: 0, off_pct: null };
  if (win.length < 2) return out;
  out.duration_h = Math.round((win[win.length - 1][0] - win[0][0]) / 360) / 10;
  let drive = 0, vmax = 0, stopStart = null, stopSec = 0, totKm = 0, offKm = 0, maxOff = 0, run = null;
  const offRuns = [];
  for (let i = 0; i < win.length; i++) {
    const p = win[i], q = win[i - 1];
    const v = Number(p[3]);
    if (isFinite(v) && v > vmax) vmax = v;
    if (q) {
      const dt = p[0] - q[0], dk = gt.distM(q, p) / 1000;
      totKm += dk;
      const moving = isFinite(v) ? v >= 5 : dk / Math.max(dt, 1) * 3600 >= 5;
      if (moving && dt < 1800) drive += dt;
      if (!moving) { if (stopStart == null) stopStart = q[0]; }
      else if (stopStart != null) { const d = q[0] - stopStart; if (d >= STOP_MIN_SEC) { out.stops++; stopSec += d; } stopStart = null; }
    }
    const off = planLine && planLine.length ? distToLineKm(p[1], p[2], planLine) : null;
    if (off != null) {
      if (off > maxOff) maxOff = off;
      if (off > OFF_KM) {
        if (!run) { run = [[q ? q[1] : p[1], q ? q[2] : p[2]]]; }
        run.push([p[1], p[2]]);
        if (q) offKm += gt.distM(q, p) / 1000;
      } else if (run) { run.push([p[1], p[2]]); offRuns.push(run); run = null; }
    }
  }
  if (stopStart != null) { const d = win[win.length - 1][0] - stopStart; if (d >= STOP_MIN_SEC) { out.stops++; stopSec += d; } }
  if (run) offRuns.push(run);
  out.drive_h = Math.round(drive / 360) / 10;
  out.stop_h = Math.round(stopSec / 360) / 10;
  out.max_kmh = vmax ? Math.round(vmax) : null;
  out.avg_kmh = drive > 0 ? Math.round(totKm / (drive / 3600)) : null;
  if (planLine && planLine.length) {
    out.max_off_km = Math.round(maxOff * 10) / 10;
    out.off_km = Math.round(offKm * 10) / 10;
    out.off_pct = totKm > 0 ? Math.round(offKm / totKm * 1000) / 10 : 0;
  }
  // ritkítás a térképhez (≥ 40 m, max. maxPts pont)
  const thinPts = [win[0]];
  for (let i = 1; i < win.length; i++) if (gt.distM(thinPts[thinPts.length - 1], win[i]) >= 40) thinPts.push(win[i]);
  const step = Math.max(1, Math.ceil(thinPts.length / (maxPts || 800)));
  for (let i = 0; i < thinPts.length; i += step) out.points.push([Math.round(thinPts[i][1] * 1e5) / 1e5, Math.round(thinPts[i][2] * 1e5) / 1e5]);
  const lw = win[win.length - 1];
  out.points.push([Math.round(lw[1] * 1e5) / 1e5, Math.round(lw[2] * 1e5) / 1e5]);
  out.off = offRuns.filter((r) => r.length >= 2).slice(0, 60).map((r) => {
    const st = Math.max(1, Math.ceil(r.length / 120)), o = [];
    for (let i = 0; i < r.length; i += st) o.push([Math.round(r[i][0] * 1e5) / 1e5, Math.round(r[i][1] * 1e5) / 1e5]);
    const l = r[r.length - 1]; o.push([Math.round(l[0] * 1e5) / 1e5, Math.round(l[1] * 1e5) / 1e5]);
    return o;
  });
  return out;
}

// Egy fuvar térképes adatai (a már tárolt ellenőrzésből + a GPS-naplóból)
async function mapItem(cid, orderId, opts) {
  const o = (await pool.query(
    `SELECT o.id, o.fuvar_no, o.client, o.rendszam_camion, o.nume_sofer, o.loc_incarcare, o.loc_descarcare, o.status,
            d.planned_km, d.actual_km, d.diff_km, d.diff_pct, d.status AS dev_status, d.source, d.km_source,
            d.from_at, d.to_at, d.planned_geo, d.detail, d.checked_at
       FROM orders o LEFT JOIN order_route_deviation d ON d.order_id = o.id AND d.company_id = o.company_id
      WHERE o.id = $1 AND o.company_id = $2`, [orderId, cid])).rows[0];
  if (!o) return null;
  const item = { order_id: o.id, fuvar_no: o.fuvar_no, client: o.client, rendszam: o.rendszam_camion, sofer: o.nume_sofer,
    loc_from: o.loc_incarcare, loc_to: o.loc_descarcare, order_status: o.status,
    status: o.dev_status || 'not_checked', planned_km: o.planned_km != null ? Number(o.planned_km) : null,
    actual_km: o.actual_km != null ? Number(o.actual_km) : null, diff_km: o.diff_km != null ? Number(o.diff_km) : null,
    diff_pct: o.diff_pct != null ? Number(o.diff_pct) : null, source: o.source, km_source: o.km_source,
    from_at: o.from_at, to_at: o.to_at, checked_at: o.checked_at,
    planned: Array.isArray(o.planned_geo) ? o.planned_geo : [],
    waypoints: (o.detail && Array.isArray(o.detail.waypoints)) ? o.detail.waypoints : [],
    actual: [], off: [], stats: null };
  const fromSec = _sec(o.from_at), toSec = _sec(o.to_at);
  if (fromSec != null && toSec != null && toSec > fromSec && o.rendszam_camion) {
    const track = await autoEv.loadPoints(cid, o.rendszam_camion, gt.localDay(fromSec * 1000), gt.localDay(toSec * 1000));
    const st = trackStats(track, fromSec, toSec, item.planned, (opts && opts.maxPts) || 800);
    item.actual = st.points; item.off = st.off;
    delete st.points; delete st.off;
    item.stats = st;
  }
  return item;
}

// Több fuvar összesítése (menetlevél / időszak)
function summarize(items) {
  const s = { orders: items.length, checked: 0, deviation: 0, ok: 0, no_data: 0, not_checked: 0,
    planned_km: 0, actual_km: 0, extra_km: 0, saved_km: 0, off_km: 0, drive_h: 0, stops: 0 };
  for (const it of items) {
    s[it.status] = (s[it.status] || 0) + 1;
    if (it.planned_km != null && it.actual_km != null) {
      s.checked++; s.planned_km += it.planned_km; s.actual_km += it.actual_km;
      if (it.status === 'deviation') s.extra_km += Math.max(0, it.diff_km || 0);
      if ((it.diff_km || 0) < 0) s.saved_km += -it.diff_km;
    }
    if (it.stats) { s.off_km += it.stats.off_km || 0; s.drive_h += it.stats.drive_h || 0; s.stops += it.stats.stops || 0; }
  }
  for (const k of ['planned_km', 'actual_km', 'extra_km', 'saved_km', 'off_km', 'drive_h']) s[k] = Math.round(s[k] * 10) / 10;
  s.diff_km = Math.round((s.actual_km - s.planned_km) * 10) / 10;
  s.diff_pct = s.planned_km > 0 ? Math.round(s.diff_km / s.planned_km * 1000) / 10 : null;
  return s;
}

module.exports = { judge, kmBetween, thin, plannedRoute, checkOrder, pickQueue, TOL_KM, TOL_PCT,
  distToLineKm, trackStats, mapItem, summarize, OFF_KM };
