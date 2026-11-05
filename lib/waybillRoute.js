// ============================================================
//  VallorSoft — lib/waybillRoute.js
//  Menetlevél teljes útvonala: Plecare → minden fel-/lerakó (a menetlevélen
//  rögzített sorrendben) → Sosire. Tervezett km rakott / üres bontással, és
//  összevetés a km-óra (km_sfarsit − km_inceput) és a GPS szerinti km-rel.
//  A pont helye: ha a sor állomáshoz kötött és van GPS-ből felismert tényleges
//  helye, azt használja; különben a szövegben lévő koordináta; különben a cím.
//  Háttérben fut, company_id-szűrt, paraméteres.
// ============================================================
const pool = require('../db');
const gt = require('./gpsTrack');
const rc = require('./routeChain');
const rd = require('./routeDeviation');
const autoEv = require('./stopAutoEvents');

const _failed = new Map();
const FAIL_BACKOFF_MS = 6 * 3600 * 1000;
const MAX_LEG_PTS = 160;

const _sec = (v) => { if (!v) return null; const t = v instanceof Date ? v.getTime() : Date.parse(v); return isFinite(t) ? t / 1000 : null; };
const _r1 = (v) => (v == null || !isFinite(v)) ? null : Math.round(Number(v) * 10) / 10;

// Pont-típus a menetlevél sorból
function typeOf(tip) {
  const s = String(tip || '').toLowerCase();
  if (s.startsWith('incarc') || s.startsWith('încărc')) return 'loading';
  if (s.startsWith('descarc') || s.startsWith('descărc')) return 'unloading';
  if (s === 'plecare') return 'plecare';
  if (s === 'sosire') return 'sosire';
  return 'waypoint';
}

// Koordináta a szövegből: „… (46.18, 21.31)" vagy tisztán koordináta
function coordsIn(text) {
  const t = String(text || '');
  const m = t.match(/\((-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\)/);
  if (m) { const lat = Number(m[1]), lng = Number(m[2]); if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng }; }
  try { const c = require('./coordParse').parseCoords(t); if (c && c.lat != null) return c; } catch (_) {}
  return null;
}

// Sorrendtartó aláírás (változás-figyeléshez)
function sigOf(f) {
  const p = (Array.isArray(f.puncte) ? f.puncte : []).map((x) => [x && x.tip, x && x.loc, x && x.stopId].join('|'));
  return p.join(' > ') + ' # ' + (f.km_inceput || '') + '-' + (f.km_sfarsit || '') + ' # ' + (f.indulas_dt ? String(_sec(f.indulas_dt)) : '') + '-' + (f.erkezes_dt ? String(_sec(f.erkezes_dt)) : '');
}

// A tervezett vonal szétvágása szakaszokra (a pontokhoz legközelebbi töréspontoknál) — tiszta
function splitPolyline(poly, wps) {
  const out = [];
  if (!Array.isArray(poly) || poly.length < 2 || !Array.isArray(wps) || wps.length < 2) return out;
  const idx = [0];
  let from = 0;
  for (let w = 1; w < wps.length - 1; w++) {
    let best = from, bd = Infinity;
    for (let i = from; i < poly.length; i++) {
      const d = Math.abs(poly[i][0] - wps[w].lat) + Math.abs(poly[i][1] - wps[w].lng);
      if (d < bd) { bd = d; best = i; }
    }
    idx.push(best); from = best;
  }
  idx.push(poly.length - 1);
  for (let k = 0; k < idx.length - 1; k++) out.push(poly.slice(idx[k], idx[k + 1] + 1));
  return out;
}

function thinPts(p, max) {
  if (!Array.isArray(p) || p.length <= max) return (p || []).map((x) => [Math.round(x[0] * 1e5) / 1e5, Math.round(x[1] * 1e5) / 1e5]);
  const st = Math.ceil(p.length / max), o = [];
  for (let i = 0; i < p.length; i += st) o.push([Math.round(p[i][0] * 1e5) / 1e5, Math.round(p[i][1] * 1e5) / 1e5]);
  const l = p[p.length - 1]; o.push([Math.round(l[0] * 1e5) / 1e5, Math.round(l[1] * 1e5) / 1e5]);
  return o;
}

async function _save(cid, id, row) {
  await pool.query(
    `INSERT INTO waybill_route_check (waybill_id, company_id, planned_km, loaded_km, empty_km, odo_km, gps_km, diff_km, diff_pct,
       status, planned_h, planned_geo, detail, sig, checked_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,NOW())
     ON CONFLICT (waybill_id) DO UPDATE SET company_id=EXCLUDED.company_id, planned_km=EXCLUDED.planned_km, loaded_km=EXCLUDED.loaded_km,
       empty_km=EXCLUDED.empty_km, odo_km=EXCLUDED.odo_km, gps_km=EXCLUDED.gps_km, diff_km=EXCLUDED.diff_km, diff_pct=EXCLUDED.diff_pct,
       status=EXCLUDED.status, planned_h=EXCLUDED.planned_h, planned_geo=EXCLUDED.planned_geo, detail=EXCLUDED.detail,
       sig=EXCLUDED.sig, checked_at=NOW()`,
    [id, cid, row.planned_km ?? null, row.loaded_km ?? null, row.empty_km ?? null, row.odo_km ?? null, row.gps_km ?? null,
      row.diff_km ?? null, row.diff_pct ?? null, row.status, row.planned_h ?? null,
      JSON.stringify(row.planned_geo || null), JSON.stringify(row.detail || null), row.sig || null]);
}

async function checkWaybill(cid, id, opts) {
  const f = (await pool.query(
    `SELECT id, puncte, numar_camion, indulas_dt, erkezes_dt, km_inceput, km_sfarsit, total_km
       FROM fuvarlevelek WHERE id=$1 AND company_id=$2`, [id, cid])).rows[0];
  if (!f) return { status: 'missing' };
  const sig = sigOf(f);
  const rows = (Array.isArray(f.puncte) ? f.puncte : []).filter((p) => p && (String(p.loc || '').trim() || p.stopId));
  // állomáshoz kötött sorok: a GPS-ből felismert tényleges hely
  const stopIds = rows.map((p) => parseInt(p.stopId, 10)).filter((n) => n > 0);
  const actual = new Map();
  if (stopIds.length) {
    for (const s of (await pool.query(
      `SELECT id, actual_lat, actual_lng, loc FROM order_stops WHERE company_id=$1 AND id = ANY($2::bigint[])`, [cid, stopIds])).rows) {
      actual.set(Number(s.id), s);
    }
  }
  const wps = [];
  for (const p of rows) {
    const t = typeOf(p.tip);
    const s = actual.get(parseInt(p.stopId, 10));
    const label = String(p.loc || (s && s.loc) || '').trim();
    if (s && s.actual_lat != null && s.actual_lng != null) wps.push({ type: t, address: label || null, lat: Number(s.actual_lat), lng: Number(s.actual_lng), tip: p.tip });
    else {
      const c = coordsIn(label);
      if (c) wps.push({ type: t, address: label, lat: c.lat, lng: c.lng, tip: p.tip });
      else if (label) wps.push({ type: t, address: label, tip: p.tip });
    }
  }
  const odo = (Number(f.km_sfarsit) > 0 && Number(f.km_sfarsit) > Number(f.km_inceput)) ? Number(f.km_sfarsit) - Number(f.km_inceput)
    : (Number(f.total_km) > 0 ? Number(f.total_km) : null);
  if (wps.length < 2) {
    await _save(cid, id, { status: 'no_data', odo_km: odo, sig, detail: { reason: 'points' } });
    return { status: 'no_data' };
  }
  let plan;
  try { plan = await rc.routeChain(cid, wps, opts); }
  catch (e) {
    // HERE nélkül nincs terv (az OSRM autós km félrevezető)
    if (!(e && e.code === 'NO_HERE')) throw e;
    await _save(cid, id, { status: 'no_data', odo_km: odo, sig, detail: { reason: 'no_here', free_reason: e.reason } });
    return { status: 'no_data', reason: 'no_here' };
  }
  // GPS: indulás → érkezés a menetlevél rendszámára
  const fromSec = _sec(f.indulas_dt), toSec = _sec(f.erkezes_dt);
  let gps = null, stats = null;
  const geoLegs = splitPolyline(plan.polyline, plan.waypoints);
  const flat = thinPts(plan.polyline, 600);
  if (fromSec && toSec && toSec > fromSec && f.numar_camion) {
    const track = await autoEv.loadPoints(cid, f.numar_camion, gt.localDay(fromSec * 1000), gt.localDay(toSec * 1000));
    const k = rd.kmBetween(track, fromSec, toSec);
    if (k) gps = k;
    stats = rd.trackStats(track, fromSec, toSec, flat, 10);
    delete stats.points; delete stats.off;
  }
  const actualKm = odo != null ? odo : (gps ? gps.km : null);
  const j = rd.judge(plan.km, actualKm);
  const row = {
    planned_km: plan.km, loaded_km: plan.loaded_km, empty_km: plan.empty_km, odo_km: odo, gps_km: gps ? gps.km : null,
    diff_km: j.diff_km, diff_pct: j.diff_pct, status: j.status, sig,
    planned_h: plan.durationSeconds ? Math.round(plan.durationSeconds / 360) / 10 : null,
    planned_geo: plan.legs.map((l, i) => ({ empty: l.empty, km: l.km, pts: thinPts(geoLegs[i] || [], MAX_LEG_PTS) })),
    detail: { waypoints: plan.waypoints.map((w, i) => ({ type: w.type, tip: wps[i] && wps[i].tip, loc: w.address, lat: w.lat, lng: w.lng })),
      legs: plan.legs.map((l) => ({ from: l.from, to: l.to, km: l.km, empty: l.empty })),
      actual_src: odo != null ? 'odo' : (gps ? gps.src : null), tol_km: j.tol_km, stats,
      src: plan.source || null, free_reason: plan.free_reason || null },
  };
  await _save(cid, id, row);
  return { status: j.status, planned_km: plan.km, loaded_km: plan.loaded_km, empty_km: plan.empty_km, odo_km: odo, gps_km: row.gps_km };
}

// Sor: friss menetlevelek, amik még nincsenek számolva vagy megváltoztak
async function pickQueue(limit) {
  const { rows } = await pool.query(
    `SELECT f.id, f.company_id, f.puncte, f.km_inceput, f.km_sfarsit, f.indulas_dt, f.erkezes_dt, c.sig, c.status, c.checked_at,
            c.detail->>'src' AS src,
            EXISTS (SELECT 1 FROM company_integrations ci WHERE ci.company_id = f.company_id AND ci.provider = 'maps'
                     AND ci.enabled AND ci.meta->>'vendor' = 'here' AND ci.credentials_enc IS NOT NULL) AS here_on
       FROM fuvarlevelek f
       LEFT JOIN waybill_route_check c ON c.waybill_id = f.id
      WHERE f.company_id IS NOT NULL
        AND COALESCE(f.erkezes_dt, f.indulas_dt, f.data_completare) > NOW() - INTERVAL '120 days'
        AND jsonb_array_length(COALESCE(f.puncte,'[]'::jsonb)) >= 2
      ORDER BY (c.waybill_id IS NULL) DESC, COALESCE(f.erkezes_dt, f.data_completare) DESC
      LIMIT 400`);
  const now = Date.now(), out = [];
  for (const r of rows) {
    if (_failed.has(r.id) && now - _failed.get(r.id) < FAIL_BACKOFF_MS) continue;
    const changed = r.sig !== sigOf(r);
    const retry = r.status === 'no_data' && r.checked_at && now - new Date(r.checked_at).getTime() > 2 * 86400000;
    // HERE-kulcs nélkül nem tervezünk (OSRM félrevezető); a régi, nem HERE-rel tervezett eredményt újraszámoljuk
    if (r.here_on !== true) continue;
    const notHere = r.status && r.status !== 'no_data' && r.src !== 'here-truck';
    if (r.sig == null || changed || retry || notHere) out.push({ id: r.id, company_id: r.company_id });
    if (out.length >= (limit || 15)) break;
  }
  return out;
}

function markFailed(id) {
  _failed.set(id, Date.now());
  if (_failed.size > 5000) _failed.delete(_failed.keys().next().value);
}

// Térképes nézethez: a tárolt eredmény + a GPS-nyomvonal
async function mapData(cid, id) {
  const c = (await pool.query(
    `SELECT c.*, f.numar_camion, f.indulas_dt, f.erkezes_dt FROM waybill_route_check c
       JOIN fuvarlevelek f ON f.id = c.waybill_id
      WHERE c.waybill_id=$1 AND c.company_id=$2`, [id, cid])).rows[0];
  if (!c) return null;
  const out = { status: c.status, reason: (c.detail && c.detail.reason) || null, free_reason: (c.detail && c.detail.free_reason) || null, planned_km: _r1(c.planned_km), loaded_km: _r1(c.loaded_km), empty_km: _r1(c.empty_km),
    odo_km: _r1(c.odo_km), gps_km: _r1(c.gps_km), diff_km: _r1(c.diff_km), diff_pct: _r1(c.diff_pct), planned_h: _r1(c.planned_h),
    legs: Array.isArray(c.planned_geo) ? c.planned_geo : [], waypoints: (c.detail && c.detail.waypoints) || [],
    leg_list: (c.detail && c.detail.legs) || [], actual_src: c.detail && c.detail.actual_src,
    stats: (c.detail && c.detail.stats) || null, actual: [], off: [], checked_at: c.checked_at };
  const fromSec = _sec(c.indulas_dt), toSec = _sec(c.erkezes_dt);
  if (fromSec && toSec && toSec > fromSec && c.numar_camion) {
    const track = await autoEv.loadPoints(cid, c.numar_camion, gt.localDay(fromSec * 1000), gt.localDay(toSec * 1000));
    const flat = [].concat.apply([], out.legs.map((l) => l.pts || []));
    const st = rd.trackStats(track, fromSec, toSec, flat, 900);
    out.actual = st.points; out.off = st.off;
  }
  return out;
}

module.exports = { typeOf, coordsIn, sigOf, splitPolyline, checkWaybill, pickQueue, markFailed, mapData };
