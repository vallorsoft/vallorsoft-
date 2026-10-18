// ============================================================
//  VallorSoft — lib/gpsTrack.js
//  GPS útvonal-előzmény: a CargoTrack eszköz TELJES pont-sorának
//  letöltése (napi bontásban mentve a gps_track_days táblába), az
//  úthálózatra illesztés (OSRM map-matching) és a menet/állás bontás.
//
//  Pont-formátum (tömör): [t (epoch mp), lat, lng, speed km/h, ign 1/0/null,
//  mileage km|null, fuelUsed L|null]
//  A napot az Europe/Bucharest naptár szerint számoljuk.
// ============================================================
const pool = require('../db');
const ct = require('../services/cargotrack');

const TZ = 'Europe/Bucharest';
const OSRM = (process.env.OSRM_MATCH_URL || 'https://router.project-osrm.org').replace(/\/+$/, '');
const UA = 'VallorSoft/1.0 (flottakezelo)';
const MATCH_CHUNK = 90;          // pont / map-matching kérés (a publikus OSRM max. 100-at enged)
const OSRM_PAUSE_MS = 1100;      // a publikus OSRM fair-use: ~1 kérés / mp
const CT_PAUSE_MS = 150;         // CargoTrack: max. ~400 kérés / perc (a limit 1000/perc)
const STOP_MIN_SEC = 5 * 60;     // ennél rövidebb állás nem „Stop"
const MOVE_KMH = 5;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Idő (Europe/Bucharest) ───────────────────────────────────
const _dtf = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
function tzOffsetMin(ms) {
  const p = {};
  for (const x of _dtf.formatToParts(new Date(ms))) p[x.type] = x.value;
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}
const _dayFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ });
function localDay(ms) { return _dayFmt.format(new Date(ms)); }
function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function dayStartMs(day) {
  const [y, m, d] = day.split('-').map(Number);
  let g = Date.UTC(y, m - 1, d);
  for (let i = 0; i < 2; i++) g = Date.UTC(y, m - 1, d) - tzOffsetMin(g) * 60000;
  return g;
}
function isDay(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !isNaN(Date.parse(s + 'T00:00:00Z')); }

// ── Geometria ────────────────────────────────────────────────
function distM(a, b) {
  const R = 6371000, rad = (x) => x * Math.PI / 180;
  const dLat = rad(b[1] - a[1]), dLng = rad(b[2] - a[2]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
function sumKm(pts, i0, i1) {
  let m = 0;
  for (let i = (i0 || 0) + 1; i <= (i1 == null ? pts.length - 1 : i1); i++) m += distM(pts[i - 1], pts[i]);
  return m / 1000;
}
// Google polyline (precision 6) — a kliens dekódolja
function encodePolyline(coords, precision) {
  const f = Math.pow(10, precision || 6);
  let out = '', pLat = 0, pLng = 0;
  const enc = (v) => { v = v < 0 ? ~(v << 1) : (v << 1); let s = ''; while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } return s + String.fromCharCode(v + 63); };
  for (const [lat, lng] of coords) {
    const a = Math.round(lat * f), b = Math.round(lng * f);
    out += enc(a - pLat) + enc(b - pLng); pLat = a; pLng = b;
  }
  return out;
}

// ── CargoTrack rekord → tömör pont ──────────────────────────
function num(v, dec) { const n = parseFloat(v); if (!isFinite(n)) return null; const f = Math.pow(10, dec); return Math.round(n * f) / f; }
function normalizeItem(it) {
  if (!it) return null;
  const pos = it.position || {};
  const lat = parseFloat(pos.latitude), lng = parseFloat(pos.longitude);
  if (!isFinite(lat) || !isFinite(lng) || (Math.abs(lat) < 0.001 && Math.abs(lng) < 0.001)) return null;
  const t = Math.floor(Date.parse(it.datetime) / 1000);
  if (!isFinite(t)) return null;
  const calc = (it.inputs && it.inputs.calculated_inputs) || it.calculated_inputs || {};
  const ig = it.ignition_status;
  const ign = ig == null ? null : ((ig === true || ig === 1 || String(ig).toLowerCase() === 'on' || String(ig) === '1') ? 1 : 0);
  return [t, num(lat, 5), num(lng, 5), num(pos.speed, 0), ign, num(calc.mileage, 1), num(calc.fuel_consumption, 2)];
}

// Rendezés + duplikátum-szűrés + GPS-ugrások kiszűrése (>180 km/h látszólagos sebesség)
function cleanPoints(pts) {
  const sorted = (pts || []).filter(Boolean).slice().sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const p of sorted) {
    const last = out[out.length - 1];
    if (last && last[0] === p[0]) continue;
    if (last) {
      const dt = p[0] - last[0];
      if (dt > 0 && dt < 1800 && distM(last, p) / dt * 3.6 > 180) continue;
    }
    out.push(p);
  }
  return out;
}

// Időablak összes rekordja: 3 órás darabokban; ha egy darab eléri a 1000-es
// limitet és nincs lapozó-token, kettébontjuk.
async function fetchRange(apiKey, objectId, fromMs, toMs, opts) {
  const pause = (opts && opts.pauseMs != null) ? opts.pauseMs : CT_PAUSE_MS;
  const iso = (ms) => new Date(ms).toISOString();
  async function win(a, b, depth) {
    const first = await ct.getCoordinates(apiKey, objectId, iso(a), iso(b));
    if (pause) await sleep(pause);
    let items = first.items, tok = first.continuation_token, guard = 0;
    while (tok && guard++ < 20) {
      const nx = await ct.getCoordinates(apiKey, objectId, iso(a), iso(b), tok);
      if (pause) await sleep(pause);
      items = items.concat(nx.items); tok = nx.continuation_token;
    }
    if (!first.continuation_token && items.length >= 1000 && (b - a) > 10 * 60000 && depth < 8) {
      const mid = a + Math.floor((b - a) / 2);
      return (await win(a, mid, depth + 1)).concat(await win(mid, b, depth + 1));
    }
    return items;
  }
  const out = [];
  const STEP = 3 * 3600 * 1000;
  for (let a = fromMs; a < toMs; a += STEP) {
    const items = await win(a, Math.min(toMs, a + STEP), 0);
    for (const it of items) { const p = normalizeItem(it); if (p) out.push(p); }
  }
  return out;
}

// Pontok összefésülése egy nap sorába (upsert); a fetched_until előre lép.
async function mergeDay(cid, plate, objectId, day, newPts, fetchedUntilMs, markComplete) {
  const r = await pool.query(`SELECT points_json FROM gps_track_days WHERE company_id=$1 AND rendszam=$2 AND day=$3`, [cid, plate, day]);
  let pts = [];
  if (r.rows.length) { try { pts = JSON.parse(r.rows[0].points_json || '[]'); } catch (_) { pts = []; } }
  const ds = dayStartMs(day), de = dayStartMs(addDays(day, 1));
  const merged = cleanPoints(pts.concat((newPts || []).filter((p) => p[0] * 1000 >= ds && p[0] * 1000 < de)));
  await pool.query(
    `INSERT INTO gps_track_days (company_id, rendszam, object_id, day, points_json, point_count, fetched_until, complete, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
     ON CONFLICT (company_id, rendszam, day) DO UPDATE SET
       points_json = EXCLUDED.points_json, point_count = EXCLUDED.point_count, object_id = EXCLUDED.object_id,
       fetched_until = GREATEST(COALESCE(gps_track_days.fetched_until, EXCLUDED.fetched_until), EXCLUDED.fetched_until),
       complete = gps_track_days.complete OR EXCLUDED.complete,
       matched_at = CASE WHEN EXCLUDED.complete AND NOT gps_track_days.complete THEN NULL ELSE gps_track_days.matched_at END,
       updated_at = NOW()`,
    [cid, plate, objectId || null, day, JSON.stringify(merged), merged.length, new Date(fetchedUntilMs).toISOString(), !!markComplete]);
  return merged.length;
}

// ── Menet / állás bontás ─────────────────────────────────────
function isMoving(p) { return p[3] != null ? p[3] >= MOVE_KMH : false; }
// endMs: a nap/időszak vége (a záró állás eddig tart, de a jelenig legfeljebb)
function detectStops(pts, endSec) {
  const stops = [], n = pts.length;
  let i = 0;
  while (i < n) {
    if (isMoving(pts[i])) { i++; continue; }
    let j = i;
    while (j + 1 < n && !isMoving(pts[j + 1]) && distM(pts[i], pts[j + 1]) < 300) j++;
    const to = (j + 1 < n) ? pts[j + 1][0] : Math.max(pts[j][0], endSec || pts[j][0]);
    if (to - pts[i][0] >= STOP_MIN_SEC) stops.push({ from: pts[i][0], to, lat: pts[i][1], lng: pts[i][2], i0: i, i1: j });
    i = j + 1;
  }
  // Két mozgó pont közötti hosszú adathiány közel azonos helyen = állás
  for (let k = 1; k < n; k++) {
    const dt = pts[k][0] - pts[k - 1][0];
    if (dt >= STOP_MIN_SEC && isMoving(pts[k - 1]) && distM(pts[k - 1], pts[k]) < 300) {
      stops.push({ from: pts[k - 1][0], to: pts[k][0], lat: pts[k - 1][1], lng: pts[k - 1][2], i0: k - 1, i1: k - 1 });
    }
  }
  return stops.sort((a, b) => a.from - b.from);
}

function odoDelta(pts, i0, i1, max) {
  let a = null, b = null;
  for (let i = i0; i <= i1; i++) if (pts[i][5] != null) { a = pts[i][5]; break; }
  for (let i = i1; i >= i0; i--) if (pts[i][5] != null) { b = pts[i][5]; break; }
  if (a == null || b == null) return null;
  const d = b - a;
  return (d >= 0 && d < (max || 3000)) ? Math.round(d * 100) / 100 : null;
}
function fuelDelta(pts, i0, i1, max) {
  let a = null, b = null;
  for (let i = i0; i <= i1; i++) if (pts[i][6] != null) { a = pts[i][6]; break; }
  for (let i = i1; i >= i0; i--) if (pts[i][6] != null) { b = pts[i][6]; break; }
  if (a == null || b == null) return null;
  const d = b - a;
  return (d >= 0 && d < (max || 3000)) ? Math.round(d * 100) / 100 : null;
}

// Menetek (két állás között) + állások — a CargoTrack „Start/Stop" listájához
function buildTimeline(pts, endSec) {
  if (!pts.length) return { trips: [], stops: [] };
  const stops = detectStops(pts, endSec);
  const trips = [];
  let cur = 0;
  const pushTrip = (i0, i1) => {
    if (i1 <= i0) return;
    const km_gps = Math.round(sumKm(pts, i0, i1) * 100) / 100;
    if (km_gps < 0.05) return;
    let la0 = Infinity, la1 = -Infinity, ln0 = Infinity, ln1 = -Infinity;
    for (let i = i0; i <= i1; i++) { la0 = Math.min(la0, pts[i][1]); la1 = Math.max(la1, pts[i][1]); ln0 = Math.min(ln0, pts[i][2]); ln1 = Math.max(ln1, pts[i][2]); }
    trips.push({ from: pts[i0][0], to: pts[i1][0], km_gps, km_odo: odoDelta(pts, i0, i1), fuel: fuelDelta(pts, i0, i1), bbox: [la0, ln0, la1, ln1] });
  };
  // menet = az előző állás utolsó pontjától a következő állás első pontjáig
  for (const s of stops) {
    if (s.i0 < cur) continue;
    pushTrip(cur, s.i0);
    cur = Math.max(cur, s.i1);
  }
  pushTrip(cur, pts.length - 1);
  return { trips, stops: stops.map((s) => ({ from: s.from, to: s.to, lat: s.lat, lng: s.lng })) };
}

// ── Úthálózatra illesztés (OSRM) ─────────────────────────────
async function osrmGet(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 25000);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA } });
      if (res.status === 429 && attempt === 0) { await sleep(3000); continue; }
      let body; try { body = await res.json(); } catch (_) { body = {}; }
      return body;
    } catch (_) {
      if (attempt === 0) { await sleep(1500); continue; }
      return null;
    } finally { clearTimeout(t); }
  }
  return null;
}

// Egy nap pontjainak illesztése → { segments:[{p,k}], km_road, km_raw, source }
async function matchPoints(pts, opts) {
  const pause = (opts && opts.pauseMs != null) ? opts.pauseMs : OSRM_PAUSE_MS;
  const get = (opts && opts.get) || osrmGet;
  const res = { segments: [], km_road: 0, km_raw: Math.round(sumKm(pts) * 100) / 100, source: 'osrm' };
  if (pts.length < 2) { res.km_road = 0; return res; }
  // ritkítás: álló helyzetű „remegés" ki (≥25 m elmozdulás kell)
  const thin = [pts[0]];
  for (let i = 1; i < pts.length; i++) if (distM(thin[thin.length - 1], pts[i]) >= 25) thin.push(pts[i]);
  if (thin.length < 2) return res;
  // futamok: hosszú adathiány (≥30 perc) új futamot kezd
  const runs = [[thin[0]]];
  for (let i = 1; i < thin.length; i++) {
    if (thin[i][0] - thin[i - 1][0] >= 1800) runs.push([]);
    runs[runs.length - 1].push(thin[i]);
  }
  let usedRaw = false, usedOsrm = false, firstCall = true;
  const call = async (url) => { if (!firstCall && pause) await sleep(pause); firstCall = false; return get(url); };
  const rawSeg = (arr) => { res.segments.push({ p: encodePolyline(arr.map((p) => [p[1], p[2]])), k: 'r' }); res.km_road += sumKm(arr); usedRaw = true; };
  let prevEnd = null;
  for (const run of runs) {
    // adathiány áthidalása az úton (ha közben elmozdult)
    if (prevEnd && run.length && distM(prevEnd, run[0]) > 500) {
      const b = await call(`${OSRM}/route/v1/driving/${prevEnd[2]},${prevEnd[1]};${run[0][2]},${run[0][1]}?overview=full&geometries=polyline6`);
      if (b && b.code === 'Ok' && b.routes && b.routes[0]) {
        res.segments.push({ p: b.routes[0].geometry, k: 'g' }); res.km_road += b.routes[0].distance / 1000;
      } else rawSeg([prevEnd, run[0]]);
    }
    if (run.length >= 2) {
      for (let s = 0; s < run.length - 1; s += MATCH_CHUNK - 1) {
        const chunk = run.slice(s, s + MATCH_CHUNK);
        if (chunk.length < 2) break;
        const coords = chunk.map((p) => p[2] + ',' + p[1]).join(';');
        const ts = []; let lastT = 0;
        for (const p of chunk) { const tt = Math.max(p[0], lastT + 1); ts.push(tt); lastT = tt; }
        const rad = chunk.map(() => 25).join(';');
        const b = await call(`${OSRM}/match/v1/driving/${coords}?timestamps=${ts.join(';')}&radiuses=${rad}&overview=full&geometries=polyline6&gaps=split&tidy=true`);
        const rawKm = sumKm(chunk);
        const mm = (b && b.code === 'Ok' && Array.isArray(b.matchings)) ? b.matchings : null;
        const mKm = mm ? mm.reduce((a, m) => a + (m.distance || 0), 0) / 1000 : 0;
        if (mm && mm.length && (rawKm < 0.2 || (mKm >= rawKm * 0.9 && mKm <= rawKm * 2.0 + 0.5))) {
          for (const m of mm) res.segments.push({ p: m.geometry, k: 'm' });
          res.km_road += mKm; usedOsrm = true;
        } else rawSeg(chunk);
      }
    }
    prevEnd = run[run.length - 1];
  }
  res.km_road = Math.round(res.km_road * 100) / 100;
  res.source = usedOsrm ? (usedRaw ? 'mixed' : 'osrm') : 'raw';
  return res;
}

// Egy nap illesztése és mentése (ha változott)
const _matchLocks = new Set();
async function matchAndSaveDay(row, opts) {
  const key = row.company_id + '|' + row.rendszam + '|' + row.day;
  if (_matchLocks.has(key)) return null;
  _matchLocks.add(key);
  try {
    let pts = [];
    try { pts = JSON.parse(row.points_json || '[]'); } catch (_) {}
    const m = await matchPoints(pts, opts);
    await pool.query(
      `UPDATE gps_track_days SET segments=$4::jsonb, km_road=$5, km_raw=$6, match_source=$7, matched_count=$8, matched_at=NOW()
        WHERE company_id=$1 AND rendszam=$2 AND day=$3`,
      [row.company_id, row.rendszam, row.day, JSON.stringify(m.segments), m.km_road, m.km_raw, m.source, pts.length]);
    return m;
  } finally { _matchLocks.delete(key); }
}

module.exports = {
  TZ, localDay, addDays, dayStartMs, isDay, distM, sumKm, encodePolyline, normalizeItem, cleanPoints,
  fetchRange, mergeDay, detectStops, buildTimeline, odoDelta, fuelDelta, matchPoints, matchAndSaveDay,
};
