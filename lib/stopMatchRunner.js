// ============================================================
//  VallorSoft — lib/stopMatchRunner.js
//  Egy fuvar állomásainak tényleges helye a GPS-ből: adatgyűjtés (fuvar,
//  állomások, gps_track_days, telephely, helymemória), geokódolás, reverse
//  geokód (cache + fair-use fojtás), a lib/stopMatch motor futtatása és a
//  mentés az order_stops actual_* mezőibe. Háttérben fut (ütemező / kézi
//  újrafuttatás) — felhasználói kérésben SOHA nem await-eljük.
//  Minden lekérdezés company_id-szűrt, paraméteres.
// ============================================================
const pool = require('../db');
const gt = require('./gpsTrack');
const sm = require('./stopMatch');
const maps = require('./mapsProvider');
const wb = require('./stopWaybill');

const MAX_WINDOW_DAYS = 14;
const MAX_REVERSE_PER_ORDER = 12;
const EXTRA_MIN_DWELL_SEC = 8 * 60;     // kevés pontszámnál a rövidebb állások is jelöltek
const EXTRA_REVERSE_PER_ORDER = 8;
const MAX_CANDIDATES_LOW = 8;           // ennyi jelöltet mutatunk, ha a pontszám alacsony
const UA = 'VallorSoft/1.0 (flottakezelo)';
const PLATE_SQL = (col) => `UPPER(REGEXP_REPLACE(COALESCE(${col},''),'[^A-Za-z0-9]','','g'))`;
const normPlate = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (sec) => (sec == null ? null : new Date(sec * 1000).toISOString());
// pg DATE → 'YYYY-MM-DD' (a pg helyi éjfélként adja — ne String().slice-szal alakítsuk)
function isoDate(v) {
  if (!v) return null;
  if (v instanceof Date) { if (isNaN(v.getTime())) return null; return v.getFullYear() + '-' + String(v.getMonth() + 1).padStart(2, '0') + '-' + String(v.getDate()).padStart(2, '0'); }
  const s = String(v).slice(0, 10);
  return gt.isDay(s) ? s : null;
}

// ── Reverse geokód (Nominatim, ~11 m-es rács, DB-cache, 1 kérés / 1,1 mp) ──
let _revChain = Promise.resolve();
let _revLast = 0;
function _throttle(fn) {
  const run = _revChain.then(async () => {
    const wait = 1100 - (Date.now() - _revLast);
    if (wait > 0) await sleep(wait);
    try { return await fn(); } finally { _revLast = Date.now(); }
  });
  _revChain = run.catch(() => {});
  return run;
}
function _placeFromNominatim(d) {
  if (!d || d.error) return null;
  const a = d.address || {};
  const city = a.city || a.town || a.village || a.hamlet || a.suburb || null;
  const road = [a.road || a.industrial || a.neighbourhood, a.house_number].filter(Boolean).join(' ');
  const parts = [d.name && d.name !== road && d.name !== city ? d.name : null, road || null, city,
    a.postcode || null, a.county || a.state || null, (a.country_code || '').toUpperCase() || null];
  const uniq = [];
  for (const p of parts) { const s = String(p || '').trim(); if (s && !uniq.includes(s)) uniq.push(s); }
  return {
    address: uniq.join(', ') || d.display_name || null,
    name: d.name || null,
    city, municipality: a.municipality || a.city_district || null,
    county: a.county || a.state || null,
    country: (a.country_code || '').toUpperCase() || null,
    category: d.category || null, type: d.type || null,
  };
}
async function reversePlace(lat, lng, opts) {
  const key = Number(lat).toFixed(4) + ',' + Number(lng).toFixed(4);
  try {
    const c = await pool.query('SELECT data FROM geo_reverse_cache WHERE key=$1', [key]);
    if (c.rows.length) return c.rows[0].data;
  } catch (_) {}
  const fetchFn = (opts && opts.fetch) || fetch;
  const data = await _throttle(async () => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const r = await fetchFn('https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=18&accept-language=ro&lat='
        + encodeURIComponent(lat) + '&lon=' + encodeURIComponent(lng), { signal: ctrl.signal, headers: { 'User-Agent': UA } });
      if (!r.ok) return null;
      return _placeFromNominatim(await r.json());
    } catch (_) { return null; } finally { clearTimeout(t); }
  });
  if (data) pool.query('INSERT INTO geo_reverse_cache (key, data) VALUES ($1,$2::jsonb) ON CONFLICT (key) DO NOTHING', [key, JSON.stringify(data)]).catch(() => {});
  return data;
}

async function _geo(cid, text) {
  const s = String(text || '').trim();
  if (s.length < 2) return null;
  try { const g = await maps.geocode(cid, s); return g ? { lat: Number(g.lat), lng: Number(g.lng) } : null; } catch (_) { return null; }
}

// ── Állapot-napló ─────────────────────────────────────────────
async function _state(cid, orderId, status, note) {
  await pool.query(
    `INSERT INTO stop_match_state (order_id, company_id, status, attempts, attempted_at, requeued, note)
     VALUES ($1,$2,$3,1,NOW(),false,$4)
     ON CONFLICT (order_id) DO UPDATE SET status=EXCLUDED.status, attempts=stop_match_state.attempts+1,
       attempted_at=NOW(), requeued=false, note=EXCLUDED.note`,
    [orderId, cid, status, note ? String(note).slice(0, 300) : null]).catch(() => {});
}

// ── Egy fuvar feldolgozása ───────────────────────────────────
async function matchOrder(cid, orderId, opts) {
  opts = opts || {};
  const o = (await pool.query(
    `SELECT id, status, rendszam_camion, data_incarcare, data_descarcare, created_at, finalized_at
       FROM orders WHERE id=$1 AND company_id=$2`, [orderId, cid])).rows[0];
  if (!o) return { ok: false, status: 'missing' };
  const plate = normPlate(o.rendszam_camion);
  if (!plate) { await _state(cid, orderId, 'no_plate'); return { ok: true, status: 'no_plate' }; }
  const stops = (await pool.query(
    `SELECT id, kind, loc, firma, data, arrived_at, done_at, match_status, waybill_apply, actual_lat, actual_lng
       FROM order_stops WHERE order_id=$1 AND company_id=$2
      ORDER BY COALESCE(seq_index, 999999), (kind='pickup') DESC, stop_index`, [orderId, cid])).rows;
  if (!stops.length) { await _state(cid, orderId, 'no_stops'); return { ok: true, status: 'no_stops' }; }
  for (const s of stops) s.data = isoDate(s.data);

  // időablak: tervezett dátumok + gombnyomások, ±1 nap, max. 14 nap
  const days = [];
  const pushDay = (v) => { if (v) days.push(v); };
  const pushTs = (v) => { if (!v) return; const t = v instanceof Date ? v.getTime() : Date.parse(v); if (isFinite(t)) days.push(gt.localDay(t)); };
  for (const s of stops) { pushDay(s.data); pushTs(s.done_at); pushTs(s.arrived_at); }
  pushDay(isoDate(o.data_incarcare)); pushDay(isoDate(o.data_descarcare));
  if (!days.length) { pushTs(o.created_at); pushTs(o.finalized_at || new Date()); }
  days.sort();
  // a lerakás gyakran a tervezett nap UTÁN (másnap, harmadnap) történik → +2 nap
  let from = gt.addDays(days[0], -1), to = gt.addDays(days[days.length - 1], 2);
  const today = gt.localDay(Date.now());
  if (to > today) to = today;
  if (Math.abs((Date.parse(to) - Date.parse(from)) / 86400000) > MAX_WINDOW_DAYS - 1) from = gt.addDays(to, -(MAX_WINDOW_DAYS - 1));

  const { rows: dayRows } = await pool.query(
    `SELECT day::text AS day, points_json, segments, complete FROM gps_track_days
      WHERE company_id=$1 AND ${PLATE_SQL('rendszam')}=$2 AND day BETWEEN $3::date AND $4::date ORDER BY day`,
    [cid, plate, from, to]);
  let pts = [];
  const roadLines = [];
  let allComplete = dayRows.length > 0;
  for (const r of dayRows) {
    try { const p = JSON.parse(r.points_json || '[]'); if (Array.isArray(p)) pts = pts.concat(p); } catch (_) {}
    if (!r.complete) allComplete = false;
    for (const seg of (Array.isArray(r.segments) ? r.segments : [])) {
      if (!seg || !seg.p || seg.k === 'r') continue;
      try { roadLines.push(gt.decodePolyline(seg.p, 6)); } catch (_) {}
    }
  }
  pts.sort((a, b) => a[0] - b[0]);
  if (pts.length < 10) { await _state(cid, orderId, 'no_gps', from + '..' + to); return { ok: true, status: 'no_gps' }; }

  let refuels = [];
  try { const lf = gt.levelFuel(pts, 0, pts.length - 1); refuels = (lf && lf.refuels) || []; } catch (_) {}
  const cands = sm.buildCandidates(pts, { roadLines, refuels });

  // elvárások: település, cég, helymemória, saját telephely
  let hq = null;
  try {
    const c = (await pool.query('SELECT adresa FROM companies WHERE id=$1', [cid])).rows[0];
    if (c && c.adresa) hq = await _geo(cid, c.adresa);
  } catch (_) {}
  let memRows = [];
  try {
    memRows = (await pool.query(
      `SELECT label, firma, lat, lng, radius_m FROM favorite_locations
        WHERE company_id=$1 AND lat IS NOT NULL AND lng IS NOT NULL LIMIT 2000`, [cid])).rows;
  } catch (_) {}
  // tanulás: a cég korábbi döntései (jel-súlyok + elvetett helyek)
  let weights = {}, badPlaces = [];
  try {
    weights = sm.weightsFromFeedback((await pool.query(
      'SELECT signal, accepted, rejected FROM stop_match_feedback WHERE company_id=$1', [cid])).rows);
  } catch (_) {}
  try {
    badPlaces = (await pool.query(
      'SELECT lat, lng, firma_norm, hits FROM stop_match_bad_places WHERE company_id=$1 ORDER BY last_at DESC LIMIT 2000', [cid])).rows;
  } catch (_) {}
  const expect = [];
  for (const s of stops) {
    const cq = sm.cityQuery(s.loc);
    const cityGeo = cq ? await _geo(cid, cq) : null;
    let firmaGeo = null;
    if (s.firma && cq) {
      firmaGeo = await _geo(cid, String(s.firma).slice(0, 120) + ', ' + cq);
      // a fuzzy keresés máshová is vihet — csak a tervezett település közelében hihető
      if (firmaGeo && cityGeo && gt.distM([0, firmaGeo.lat, firmaGeo.lng], [0, cityGeo.lat, cityGeo.lng]) > 40000) firmaGeo = null;
    }
    const ft = sm.firmaTokens(s.firma);
    const memory = ft.length ? memRows.filter((m) => {
      const mt = sm.firmaTokens(m.firma || m.label);
      return mt.length && ft.filter((t) => mt.includes(t)).length >= Math.min(2, ft.length);
    }) : [];
    expect.push({ cityGeo, firmaGeo, memory, hq, weights, badPlaces });
  }

  // reverse-geokód a legígéretesebb jelöltekre
  const pre = sm.prescore(stops, cands, expect);
  const order = pre.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).filter((x) => x[0] > -20).slice(0, MAX_REVERSE_PER_ORDER);
  for (const [, i] of order) {
    cands[i].place = await reversePlace(cands[i].lat, cands[i].lng, opts);
  }

  const res = sm.align(stops, cands, expect);
  const settings = await wb.getSettings(cid);
  let matched = 0, applied = 0;
  // Kevés pontszám (nem „biztos") → több jelölt: a rövidebb (≥ 8 perces) állásokból is
  let extra = [];
  if (res.some((r) => r.status !== 'auto') || stops.some((x) => x.match_status === 'rejected')) {
    try {
      const near = (a, b) => Math.abs(a.lat - b.lat) < 0.003 && Math.abs(a.lng - b.lng) < 0.004 && a.from < b.to + 1800 && b.from < a.to + 1800;
      extra = sm.buildCandidates(pts, { roadLines, refuels, minDwellSec: EXTRA_MIN_DWELL_SEC })
        .filter((e) => !cands.some((c) => near(c, e)))
        .map((e) => ({ ...e, short: true }));
      const preX = sm.prescore(stops, extra, expect);
      const pick = preX.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).slice(0, EXTRA_REVERSE_PER_ORDER);
      for (const [, i] of pick) extra[i].place = await reversePlace(extra[i].lat, extra[i].lng, opts);
      extra = pick.map(([, i]) => extra[i]);
    } catch (e) { extra = []; }
  }
  const candOut = (c, score, signals) => ({ lat: c.lat, lng: c.lng, from: iso(c.from), to: iso(c.to), score,
    address: c.place ? c.place.address : null, city: c.place ? c.place.city : null,
    country: c.place ? c.place.country : null, signals: signals || [], short: !!c.short });

  for (const r of res) {
    const s = stops[r.stopIdx];
    if (s.match_status === 'confirmed') { matched++; continue; }
    if (s.match_status === 'rejected') {
      // elvetett pont: a döntés marad, de további jelölteket kínálunk (az elvetett hely nélkül)
      const far = (c) => s.actual_lat == null || Math.abs(c.lat - s.actual_lat) > 0.002 || Math.abs(c.lng - s.actual_lng) > 0.003;
      let alt = r.ranked.map((x) => candOut(cands[x.j], x.score, x.signals));
      alt = alt.concat(extra.map((e) => { const sp = sm.scorePair(s, e, expect[r.stopIdx]); return candOut(e, sp.score, sp.signals); }));
      alt = alt.filter(far).sort((a, b) => b.score - a.score).slice(0, MAX_CANDIDATES_LOW);
      await pool.query(
        `UPDATE order_stops SET match_detail = jsonb_set(COALESCE(match_detail,'{}'::jsonb), '{candidates}', $3::jsonb)
          WHERE id=$1 AND company_id=$2 AND match_status='rejected'`, [s.id, cid, JSON.stringify(alt)]);
      continue;
    }
    const low = r.status !== 'auto';
    let top = r.ranked.slice(0, low ? MAX_CANDIDATES_LOW : 4).filter((x) => x.score > -20 || low).map((x) => candOut(cands[x.j], x.score, x.signals));
    if (low && extra.length) {
      const ex = extra.map((e) => { const sp = sm.scorePair(s, e, expect[r.stopIdx]); return candOut(e, sp.score, sp.signals); });
      top = top.concat(ex).sort((a, b) => b.score - a.score).slice(0, MAX_CANDIDATES_LOW);
    }
    const c = r.candIdx != null ? cands[r.candIdx] : null;
    const detail = { v: 1, margin: r.margin, signals: r.signals, candidates: top,
      dur_min: c ? Math.round(c.dur / 60) : null, road_m: c ? c.road_m : null, maneuvers: c ? c.maneuvers : null };
    if (c) matched++;
    await pool.query(
      `UPDATE order_stops SET actual_lat=$3, actual_lng=$4, actual_address=$5, actual_city=$6, actual_country=$7,
              gps_arrived_at=$8, gps_left_at=$9, match_score=$10, match_source=$11, match_status=$12,
              match_detail=$13::jsonb, matched_at=NOW()
        WHERE id=$1 AND company_id=$2 AND COALESCE(match_status,'') NOT IN ('confirmed','rejected')`,
      [s.id, cid, c ? c.lat : null, c ? c.lng : null, c && c.place ? c.place.address : null,
        c && c.place ? (c.place.city || c.place.municipality) : null, c && c.place ? c.place.country : null,
        c ? iso(c.from) : null, c ? iso(c.to) : null, r.score, c ? (r.signals.some((x) => x[0] === 'memory') ? 'memory' : 'gps') : null,
        r.status, JSON.stringify(detail)]);
    // automatikus rátétel a menetlevélre, ha a cég bekapcsolta és a pontszám eléri a küszöböt
    if (c && c.place && c.place.address && (s.waybill_apply === true || wb.qualifies(settings, r.status, r.score))) {
      try { const x = await wb.applyStop(cid, s.id); if (x.ok) applied += x.points; }
      catch (e) { console.warn('[StopMatch] auto-rátétel hiba', s.id, e.message); }
    }
  }
  const finished = ['Finalizat', 'Anulat'].includes(o.status) && allComplete;
  const status = matched === stops.length ? 'done' : (finished ? 'done' : 'partial');
  await _state(cid, orderId, status, matched + '/' + stops.length);
  return { ok: true, status, matched, applied, total: stops.length, candidates: cands.length };
}

// ── Sor kiválasztása az ütemezőnek ───────────────────────────
// Lezárt / folyamatban lévő fuvarok, amelyeknél van GPS-párosított jármű, és
// még nem dolgoztuk fel (vagy kézzel újrasorba tették, vagy 6 órája részleges).
async function pickQueue(limit) {
  const { rows } = await pool.query(
    `SELECT o.id, o.company_id FROM orders o
       LEFT JOIN stop_match_state st ON st.order_id = o.id
      WHERE o.status IN ('In Curs','Finalizat','Parkolt','Raktarban')
        AND COALESCE(o.rendszam_camion,'') <> ''
        AND EXISTS (SELECT 1 FROM vehicle_gps_map g WHERE g.company_id=o.company_id
                     AND ${PLATE_SQL('g.rendszam')} = ${PLATE_SQL('o.rendszam_camion')})
        AND (
          (st.order_id IS NULL AND COALESCE(o.finalized_at, o.created_at) > NOW() - INTERVAL '120 days')
          OR st.requeued = true
          OR (st.status IN ('partial','no_gps','error') AND st.attempted_at < NOW() - INTERVAL '6 hours' AND st.attempts < 12)
        )
      ORDER BY st.requeued DESC NULLS LAST, COALESCE(o.finalized_at, o.created_at) DESC
      LIMIT $1`, [limit]);
  return rows;
}

// ── Tanulás az iroda döntéseiből ─────────────────────────────
// signals: [[jel, érték], ...] — csak a pozitív jeleket számoljuk (ezek „győztek")
async function recordFeedback(cid, signals, accepted) {
  const keys = [...new Set((signals || []).filter((x) => Array.isArray(x) && x[1] > 0).map((x) => String(x[0]).slice(0, 32)))];
  for (const k of keys) {
    await pool.query(
      `INSERT INTO stop_match_feedback (company_id, signal, accepted, rejected) VALUES ($1,$2,$3,$4)
       ON CONFLICT (company_id, signal) DO UPDATE SET accepted = stop_match_feedback.accepted + EXCLUDED.accepted,
         rejected = stop_match_feedback.rejected + EXCLUDED.rejected, updated_at = NOW()`,
      [cid, k, accepted ? 1 : 0, accepted ? 0 : 1]).catch(() => {});
  }
}
async function recordBadPlace(cid, lat, lng, firma) {
  if (lat == null || lng == null) return;
  const fn = sm.firmaTokens(firma).join(' ').slice(0, 200) || null;
  const { rows } = await pool.query(
    `SELECT id, lat, lng FROM stop_match_bad_places WHERE company_id=$1
       AND lat BETWEEN $2::float8 - 0.005 AND $2::float8 + 0.005 AND lng BETWEEN $3::float8 - 0.008 AND $3::float8 + 0.008
       AND COALESCE(firma_norm,'') = COALESCE($4,'')`, [cid, lat, lng, fn]);
  const near = rows.find((r) => gt.distM([0, r.lat, r.lng], [0, lat, lng]) <= 250);
  if (near) await pool.query('UPDATE stop_match_bad_places SET hits = hits + 1, last_at = NOW() WHERE id=$1 AND company_id=$2', [near.id, cid]);
  else await pool.query('INSERT INTO stop_match_bad_places (company_id, lat, lng, firma_norm) VALUES ($1,$2,$3,$4)', [cid, lat, lng, fn]);
}
// Egy döntés után a cég többi még nem lezárt (javasolt / nem talált) fuvarját újraszámoljuk,
// hogy a tanultak rájuk is hassanak (a háttér-ütemező dolgozza fel, körönként 15 fuvar).
async function requeueOpen(cid, exceptOrderId) {
  const r = await pool.query(
    `UPDATE stop_match_state st SET requeued = true, attempts = 0
      WHERE st.company_id = $1 AND st.order_id <> $2 AND st.requeued = false
        AND st.order_id IN (
          SELECT DISTINCT s.order_id FROM order_stops s
           WHERE s.company_id = $1 AND s.match_status IN ('auto','suggested','unmatched')
             AND s.matched_at > NOW() - INTERVAL '120 days'
           LIMIT 300)`, [cid, String(exceptOrderId || '')]);
  return r.rowCount || 0;
}

// ── Helymemória: elfogadott cím → kedvenc helyszín (auto) ────
async function learnPlace(cid, stop) {
  if (stop.actual_lat == null || stop.actual_lng == null) return;
  const { rows } = await pool.query(
    `SELECT id, lat, lng FROM favorite_locations WHERE company_id=$1 AND lat IS NOT NULL AND lng IS NOT NULL
        AND lat BETWEEN $2::float8 - 0.01 AND $2::float8 + 0.01 AND lng BETWEEN $3::float8 - 0.015 AND $3::float8 + 0.015`,
    [cid, stop.actual_lat, stop.actual_lng]);
  const near = rows.find((r) => gt.distM([0, r.lat, r.lng], [0, stop.actual_lat, stop.actual_lng]) <= 200);
  if (near) {
    await pool.query(
      `UPDATE favorite_locations SET hit_count=COALESCE(hit_count,0)+1, last_seen_at=NOW(),
              firma=COALESCE(firma, $3) WHERE id=$1 AND company_id=$2`, [near.id, cid, stop.firma || null]);
    return;
  }
  const label = String(stop.firma || stop.actual_city || stop.loc || 'GPS').slice(0, 200);
  await pool.query(
    `INSERT INTO favorite_locations (company_id, label, address, lat, lng, type, firma, source, radius_m, hit_count, last_seen_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'auto',250,1,NOW())`,
    [cid, label, String(stop.actual_address || stop.loc || label).slice(0, 500), stop.actual_lat, stop.actual_lng,
      stop.kind === 'pickup' ? 'load' : 'unload', stop.firma || null]);
}

module.exports = { matchOrder, pickQueue, learnPlace, reversePlace, isoDate, recordFeedback, recordBadPlace, requeueOpen, _placeFromNominatim };
