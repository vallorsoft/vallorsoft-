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
const autoEv = require('./stopAutoEvents');

const MAX_WINDOW_DAYS = 14;
const MAX_REVERSE_PER_ORDER = 12;
const EXTRA_MIN_DWELL_SEC = 8 * 60;     // kevés pontszámnál a rövidebb állások is jelöltek
const EXTRA_REVERSE_PER_ORDER = 8;
const MAX_CANDIDATES_LOW = 8;           // ennyi jelöltet mutatunk, ha a pontszám alacsony
// Heti újraellenőrzés: a cél-pontszám alatti (nem iroda által eldöntött) állomást a rendszer
// hetente újraelemzi; RECHECK_MAX sikertelen újraellenőrzés után kézi megerősítésre hagyja.
const RECHECK_TARGET = Math.max(1, parseInt(process.env.STOP_RECHECK_TARGET, 10) || 150);
const RECHECK_MAX = Math.max(1, parseInt(process.env.STOP_RECHECK_MAX, 10) || 10);
const RECHECK_DAYS = Math.max(1, parseInt(process.env.STOP_RECHECK_DAYS, 10) || 7);
const MOVED_M = 50;                     // ennél többet mozdult hely → a fuvar / menetlevél útvonala újraszámolandó
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
  // addr: cégnév NÉLKÜL (a környező cég neve gyakran nem az, ahol az autó állt)
  const plain = [];
  for (const p of parts.slice(1)) { const s = String(p || '').trim(); if (s && !plain.includes(s)) plain.push(s); }
  return {
    address: uniq.join(', ') || d.display_name || null,
    addr: plain.join(', ') || null,
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
  if (opts && opts.cacheOnly) return null;   // visszamérés: külső hívás nélkül
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

// A menetlevélre / listába kerülő cím: utca, település, irsz., megye, ország + (pontos koordináta)
// — cégnév nélkül (régi cache-sornál a név levágva).
function coordText(lat, lng) {
  return (isFinite(Number(lat)) && isFinite(Number(lng))) ? Number(lat).toFixed(5) + ', ' + Number(lng).toFixed(5) : '';
}
function formatAddress(place, lat, lng) {
  let a = '';
  if (place) {
    a = place.addr || place.address || '';
    if (!place.addr && place.name && a.indexOf(place.name + ', ') === 0) a = a.slice(place.name.length + 2);
  }
  a = String(a || '').replace(/\s*\(-?\d+\.\d+,\s*-?\d+\.\d+\)\s*$/, '').trim();
  const co = coordText(lat, lng);
  if (!co) return a || null;
  return a ? a + ' (' + co + ')' : co;
}

// ── Régi címek átírása az új formára (cégnév nélkül + „(lat, lng)") ──
// Egyszeri, idempotens: csak a még koordináta nélküli címeket fogja meg.
// A megerősített / menetlevélre kért állomásnál a menetlevél is frissül.
const COORD_TAIL_RE = /\(-?\d+\.\d+,\s*-?\d+\.\d+\)\s*$/;
const COORD_ONLY_RE = /^-?\d+\.\d+,\s*-?\d+\.\d+$/;
function upgradedAddress(old, place, lat, lng) {
  const a = String(old || '').trim();
  if (COORD_TAIL_RE.test(a)) return a;
  if (!a || COORD_ONLY_RE.test(a)) return coordText(lat, lng) || a;
  if (place) {
    const full = place.address || '', plain = place.addr || '';
    const generated = a === full || (plain && a === plain) || (full && a.endsWith(', ' + full))
      || (place.name && a.indexOf(place.name + ', ') === 0);
    if (generated) return formatAddress(place, lat, lng);
  }
  return formatAddress({ addr: a }, lat, lng);   // kézzel írt cím: a szöveg marad, mögé a koordináta
}
async function _cachedPlace(lat, lng) {
  try {
    const c = await pool.query('SELECT data FROM geo_reverse_cache WHERE key=$1', [Number(lat).toFixed(4) + ',' + Number(lng).toFixed(4)]);
    return c.rows.length ? c.rows[0].data : null;
  } catch (_) { return null; }
}
async function upgradeAddressFormat(limit) {
  const { rows } = await pool.query(
    `SELECT id, company_id, actual_lat, actual_lng, actual_address, match_status, waybill_apply
       FROM order_stops
      WHERE actual_lat IS NOT NULL AND actual_lng IS NOT NULL AND actual_address IS NOT NULL
        AND COALESCE(match_status,'') <> 'rejected'
        AND actual_address !~ '\\(-?[0-9]+\\.[0-9]+, *-?[0-9]+\\.[0-9]+\\)[[:space:]]*$'
        AND actual_address !~ '^-?[0-9]+\\.[0-9]+, *-?[0-9]+\\.[0-9]+$'
      ORDER BY id LIMIT $1`, [limit || 200]);
  let updated = 0, applied = 0;
  for (const r of rows) {
    const addr = String(upgradedAddress(r.actual_address, await _cachedPlace(r.actual_lat, r.actual_lng), r.actual_lat, r.actual_lng) || '').slice(0, 500);
    if (!COORD_TAIL_RE.test(addr)) continue;   // nem alakítható (hibás koordináta)
    await pool.query('UPDATE order_stops SET actual_address=$3 WHERE id=$1 AND company_id=$2', [r.id, r.company_id, addr]);
    updated++;
    if (r.match_status === 'confirmed' || r.waybill_apply === true) {
      try { const x = await wb.applyStop(r.company_id, r.id); if (x.ok) applied += x.points || 0; }
      catch (e) { console.warn('[StopMatch] régi cím menetlevél-frissítés hiba', r.id, e.message); }
    }
  }
  return { checked: rows.length, updated, points: applied };
}

async function _geo(cid, text) {
  const s = String(text || '').trim();
  if (s.length < 2) return null;
  try { const g = await maps.geocode(cid, s); return g ? { lat: Number(g.lat), lng: Number(g.lng) } : null; } catch (_) { return null; }
}

// ── Állapot-napló ─────────────────────────────────────────────
async function _stateWrite(cid, orderId, status, note) {
  await pool.query(
    `INSERT INTO stop_match_state (order_id, company_id, status, attempts, attempted_at, requeued, note)
     VALUES ($1,$2,$3,1,NOW(),false,$4)
     ON CONFLICT (order_id) DO UPDATE SET status=EXCLUDED.status, attempts=stop_match_state.attempts+1,
       attempted_at=NOW(), requeued=false, note=EXCLUDED.note`,
    [orderId, cid, status, note ? String(note).slice(0, 300) : null]).catch(() => {});
}

// ── Heti újraellenőrzés + útvonal-érvénytelenítés ────────────
const RECHECK_BUMP_SQL = `
  UPDATE order_stops SET recheck_count = recheck_count + 1, recheck_at = NOW(),
         needs_manual = (recheck_count + 1 >= $3),
         match_status = CASE WHEN recheck_count + 1 >= $3 AND match_status = 'auto' THEN 'suggested' ELSE match_status END
   WHERE order_id = $1 AND company_id = $2
     AND match_status IN ('auto','suggested','unmatched') AND COALESCE(match_score, 0) < $4
     AND needs_manual = false AND recheck_count < $3
     AND matched_at IS NOT NULL AND COALESCE(recheck_at, matched_at) < NOW() - ($5::int * INTERVAL '1 day')`;

// A hely érdemben mozdult-e (új hely, eltűnt hely, vagy MOVED_M-nél messzebb)
function _moved(s, c) {
  const had = s.actual_lat != null && s.actual_lng != null;
  if (!had && !c) return false;
  if (!had || !c) return true;
  return gt.distM([0, Number(s.actual_lat), Number(s.actual_lng)], [0, c.lat, c.lng]) > MOVED_M;
}

// A fuvar útvonal-eltérése és a fuvart tartalmazó menetlevelek teljes útja újraszámolandó
async function invalidateRoutes(cid, orderId) {
  try { await pool.query('DELETE FROM order_route_deviation WHERE order_id=$1 AND company_id=$2', [orderId, cid]); }
  catch (e) { if (!(e && e.code === '42P01')) console.warn('[StopMatch] útvonal-eltérés érvénytelenítés hiba', orderId, e.message); }
  try {
    await pool.query(
      `UPDATE waybill_route_check SET sig = NULL
        WHERE company_id = $1 AND waybill_id IN (SELECT id FROM fuvarlevelek WHERE company_id = $1 AND order_ids @> jsonb_build_array($2::text))`,
      [cid, String(orderId)]);
  } catch (e) { if (!(e && e.code === '42P01')) console.warn('[StopMatch] menetlevél-út érvénytelenítés hiba', orderId, e.message); }
}

// ── Elvetett helyek (az iroda „✕ rossz" döntései) ───────────
// Egy elvetett állomásnál a rendszer új helyet keres; az addig elvetett helyek
// a match_detail.rejected_pts-ben gyűlnek, ezekre többé nem tesszük vissza.
const RETRY_MIN_SCORE = 0;
const REJ_MAX = 20;
function _sec(v) { const t = v ? Date.parse(v) : NaN; return isFinite(t) ? t / 1000 : null; }
function nearAny(c, pts) {
  return (pts || []).some((p) => Math.abs(c.lat - p.lat) < 0.002 && Math.abs(c.lng - p.lng) < 0.003);
}
function rejectedPoints(s) {
  const out = [];
  const det = s && s.match_detail && typeof s.match_detail === 'object' ? s.match_detail : {};
  for (const p of (Array.isArray(det.rejected_pts) ? det.rejected_pts : [])) {
    const lat = Number(p && p.lat), lng = Number(p && p.lng);
    if (isFinite(lat) && isFinite(lng)) out.push({ lat, lng });
  }
  if (s && s.match_status === 'rejected' && s.actual_lat != null && isFinite(Number(s.actual_lat))) {
    const p = { lat: Number(s.actual_lat), lng: Number(s.actual_lng) };
    if (!nearAny(p, out)) out.push(p);
  }
  return out.slice(-REJ_MAX);
}

// ── Egy fuvar feldolgozása ───────────────────────────────────
// Rögzített állomás: a már beírt (sofőr-gomb pótlása) vagy megerősített állomás GPS-állása.
// Ezt az újraszámolás nem cseréli le, és más (pl. később ugyanide eső) állomás nem kaphatja meg.
function pinOf(s) {
  if (!s || !s.done_at || !s.gps_arrived_at || !s.gps_left_at) return null;
  if (s.match_status !== 'confirmed' && !s.auto_filled) return null;
  const from = _sec(s.gps_arrived_at), to = _sec(s.gps_left_at);
  return from != null && to != null && to >= from ? { from, to } : null;
}

async function matchOrder(cid, orderId, opts) {
  opts = opts || {};
  // dryRun: csak számol, semmit nem ír (visszamérés valós adaton — scripts/stop-match-backtest.js)
  // noMemory: a tanult adatok (helymemória, jel-súlyok, elvetett helyek) nélkül — a nyers motor mérése
  const dry = !!opts.dryRun;
  const _state = dry ? async () => {} : _stateWrite;
  const o = (await pool.query(
    `SELECT id, status, rendszam_camion, data_incarcare, data_descarcare, created_at, finalized_at,
            to_jsonb(orders) -> 'route_geo' AS route_geo
       FROM orders WHERE id=$1 AND company_id=$2`, [orderId, cid])).rows[0];
  if (!o) return { ok: false, status: 'missing' };
  const closed = o.status === 'Finalizat';   // lezárt fuvar: nincs felajánlás, csak háttér-ellenőrzés
  const plate = normPlate(o.rendszam_camion);
  if (!plate) { await _state(cid, orderId, 'no_plate'); return { ok: true, status: 'no_plate' }; }
  const stops = (await pool.query(
    `SELECT id, kind, loc, firma, data, arrived_at, done_at, match_status, waybill_apply, actual_lat, actual_lng,
            actual_address, match_detail, gps_arrived_at, gps_left_at,
            (to_jsonb(order_stops) ->> 'auto_filled') AS auto_filled,
            COALESCE((to_jsonb(order_stops) ->> 'needs_manual')::boolean, false) AS needs_manual
       FROM order_stops WHERE order_id=$1 AND company_id=$2
      ORDER BY COALESCE(seq_index, 999999), (kind='pickup') DESC, stop_index`, [orderId, cid])).rows;
  if (!stops.length) { await _state(cid, orderId, 'no_stops'); return { ok: true, status: 'no_stops' }; }
  for (const s of stops) s.data = isoDate(s.data);
  // heti újraellenőrzés: az esedékes állomások számlálója most lép (akkor is, ha ma nincs új adat),
  // a RECHECK_MAX-adik után kézi megerősítésre kerül (a „biztos" jelölés lekerül róla)
  if (opts.recheck && !dry) {
    try { await pool.query(RECHECK_BUMP_SQL, [orderId, cid, RECHECK_MAX, RECHECK_TARGET, RECHECK_DAYS]); }
    catch (e) { if (!(e && e.code === '42703')) console.warn('[StopMatch] újraellenőrzés-számláló hiba', orderId, e.message); }
  }

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

  // elvárások: település, cég, helymemória, saját telephely
  let hq = null;
  try {
    const c = (await pool.query('SELECT adresa FROM companies WHERE id=$1', [cid])).rows[0];
    if (c && c.adresa) hq = await _geo(cid, c.adresa);
  } catch (_) {}
  let memRows = [];
  if (!opts.noMemory) try {
    memRows = (await pool.query(
      `SELECT label, firma, address, lat, lng, radius_m FROM favorite_locations
        WHERE company_id=$1 AND lat IS NOT NULL AND lng IS NOT NULL LIMIT 2000`, [cid])).rows;
  } catch (_) {}
  // tanulás: a cég korábbi döntései (jel-súlyok + elvetett helyek)
  let weights = {}, badPlaces = [];
  if (!opts.noMemory) try {
    weights = sm.weightsFromFeedback((await pool.query(
      'SELECT signal, accepted, rejected FROM stop_match_feedback WHERE company_id=$1', [cid])).rows);
  } catch (_) {}
  if (!opts.noMemory) try {
    badPlaces = (await pool.query(
      'SELECT lat, lng, firma_norm, hits FROM stop_match_bad_places WHERE company_id=$1 ORDER BY last_at DESC LIMIT 2000', [cid])).rows;
  } catch (_) {}
  // a fuvar-kiíráskor a címkiegészítőből választott pontos koordináták (route_geo.waypoints)
  const wpCoords = new Map();
  try {
    const rg = typeof o.route_geo === 'string' ? JSON.parse(o.route_geo) : o.route_geo;
    for (const w of (rg && Array.isArray(rg.waypoints) ? rg.waypoints : [])) {
      const k = sm.norm(w && (w.address || w.label));
      if (k && isFinite(Number(w.lat)) && isFinite(Number(w.lng)) && w.lat != null) wpCoords.set(k, { lat: Number(w.lat), lng: Number(w.lng) });
    }
  } catch (_) {}
  const expect = [];
  for (const s of stops) {
    const cq = sm.cityQuery(s.loc);
    let cityGeo = cq ? await _geo(cid, cq) : null;
    // a teljes tervezett cím pontja (pl. „Policlinica AS, Strada Făt Frumos, Arad, …"):
    // a kiíráskor kiválasztott koordináta, ennek hiányában a teljes cím geokódolva
    let addrGeo = null;
    const fullLoc = String(s.loc || '').trim();
    if (fullLoc && sm.norm(fullLoc) !== sm.norm(cq)) {
      addrGeo = wpCoords.get(sm.norm(fullLoc)) || await _geo(cid, fullLoc.slice(0, 200));
      if (addrGeo && cityGeo && gt.distM([0, addrGeo.lat, addrGeo.lng], [0, cityGeo.lat, cityGeo.lng]) > 40000) addrGeo = null;
    }
    if (!cityGeo && addrGeo) cityGeo = addrGeo;
    let firmaGeo = null;
    if (s.firma && cq) {
      firmaGeo = await _geo(cid, String(s.firma).slice(0, 120) + ', ' + cq);
      // a fuzzy keresés máshová is vihet — csak a tervezett település közelében hihető
      if (firmaGeo && cityGeo && gt.distM([0, firmaGeo.lat, firmaGeo.lng], [0, cityGeo.lat, cityGeo.lng]) > 40000) firmaGeo = null;
    }
    // a cég neve nem található, de a pontos cím igen (és nem a település közepe) → az a cég helye
    if (!firmaGeo && addrGeo && cityGeo !== addrGeo
        && gt.distM([0, addrGeo.lat, addrGeo.lng], [0, cityGeo.lat, cityGeo.lng]) > 300) firmaGeo = addrGeo;
    // a cég mentett helyei: az állomásé (cégnév / a fuvarba írt cím egyezik) + a település környékiek
    const sv = sm.savedFor(s, memRows, cityGeo, addrGeo);
    const memory = sv.memory, saved = sv.saved;
    // a fuvar már felismert (iroda által megerősített / biztos), azonos helyű állomása is ismert hely
    // (pl. ugyanoda többször rak le) — ott a rövid állás is rakodás
    for (const x of stops) {
      if (x.id === s.id || x.actual_lat == null || x.actual_lng == null) continue;
      if (x.match_status !== 'confirmed' && x.match_status !== 'auto') continue;
      if (!sm.sameSite(s, x)) continue;
      memory.push({ label: x.loc, firma: x.firma, lat: Number(x.actual_lat), lng: Number(x.actual_lng), radius_m: 250, sibling: true });
    }
    // a sofőr gombnyomásai ugyanennek a helynek a többi állomásánál (ott állt, amikor megnyomta)
    try {
      const sibs = stops.filter((x) => x.id !== s.id && x.match_status !== 'rejected' && sm.sameSite(s, x));
      for (const p of sm.pressSites(pts, sibs)) memory.push({ label: s.loc, firma: s.firma, ...p });
    } catch (_) {}
    // az előző állomások legkésőbbi „kész" ideje (sofőr-gomb / pótlás) — sorrend-korlát
    let prevDone = null;
    for (const x of stops) {
      if (x === s) break;
      const d = _sec(x.done_at);
      if (d != null && (prevDone == null || d > prevDone)) prevDone = d;
    }
    expect.push({ cityGeo, firmaGeo, memory, saved, hq, weights, badPlaces, prevDone, pin: closed ? null : pinOf(s),   // lezárt fuvarnál szabad újraszámolás (ellenőrzés)
      repeatSite: stops.slice(0, stops.indexOf(s)).some((x) => sm.sameSite(s, x)) });
  }
  // ismert rakodóhelyek: helymemória + a tervezett cég pontos (nem a település-középpontra eső) helye
  const sitePoints = [];
  for (const e of expect) {
    for (const m of e.memory) sitePoints.push(m);
    for (const m of e.saved || []) sitePoints.push(m);
    if (e.firmaGeo && (!e.cityGeo || gt.distM([0, e.firmaGeo.lat, e.firmaGeo.lng], [0, e.cityGeo.lat, e.cityGeo.lng]) > 500)) sitePoints.push(e.firmaGeo);
  }
  const cands = sm.buildCandidates(pts, { roadLines, refuels, sitePoints });

  // reverse-geokód a legígéretesebb jelöltekre
  const pre = sm.prescore(stops, cands, expect);
  const order = pre.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).filter((x) => x[0] > -20).slice(0, MAX_REVERSE_PER_ORDER);
  for (const [, i] of order) {
    cands[i].place = await reversePlace(cands[i].lat, cands[i].lng, opts);
  }

  const baseCands = cands.slice();   // a független ellenőrzésekhez (a következtetett állások nélkül)
  const res = sm.align(stops, cands, expect);
  // a következő állomás megvan → a kimaradt előző is megtörtént: járt-e a tervezett helyen a kamion?
  try {
    for (const v of sm.inferVisits(stops, res, cands, expect, pts)) {
      const c = { from: v.from, to: v.to, dur: v.to - v.from, dwell: v.still, lat: v.lat, lng: v.lng, day: sm.localDay(v.from),
        maneuvers: 0, night: 0, ign_off: null, road_m: null, refuel: false, place: null, inferred: true };
      try { c.place = await reversePlace(c.lat, c.lng, opts); } catch (_) {}
      cands.push(c);
      const r = res[v.stopIdx];
      r.candIdx = cands.length - 1; r.status = 'suggested'; r.score = v.score; r.margin = null; r.signals = v.signals;
    }
  } catch (e) { console.warn('[StopMatch] következtetés hiba', orderId, e.message); }
  // Többszörös ellenőrzés: ugyanaz a nap / útvonal még kétszer, más szemmel —
  //  (2) tanult adatok nélkül (helymemória, mentett helyek, jel-súlyok nélkül),
  //  (3) szigorú dátummal (a tervezett nap előtti állás gyanús).
  // Egy állomás csak akkor ajánlható a sofőrnek, ha a 3-ból legalább 2 ugyanazt az állást adja.
  let votes = stops.map(() => null);
  let histWin = stops.map(() => null);
  try {
    const primary = sm.matchWindows(stops, res, cands, []);
    const variants = [
      expect.map((e) => ({ ...e, weights: {} })),   // tanult jel-súlyok nélkül (a mentett helyek maradnak)
      expect.map((e) => ({ ...e, strictDate: true })),
    ].map((ev) => {
      const r2 = sm.align(stops, baseCands, ev);
      let inf = [];
      try { inf = sm.inferVisits(stops, r2, baseCands, ev, pts); } catch (_) {}
      return sm.matchWindows(stops, r2, baseCands, inf);
    });
    votes = sm.agreeVotes(primary, variants);
    // 15 percenként egymás után: az előző 2 kör eredménye is szavaz (3-ból 2 kell)
    histWin = primary;
    votes = votes.map((v, i) => Math.max(v || 0, sm.historyVotes(primary[i], stops[i].match_detail && stops[i].match_detail.vote_hist)));
  } catch (e) { console.warn('[StopMatch] többszörös ellenőrzés hiba', orderId, e.message); }
  if (dry) {
    return { ok: true, status: 'dry', total: stops.length, candidates: cands.length, stops: res.map((r) => {
      const c = r.candIdx != null ? cands[r.candIdx] : null;
      return { stop_id: stops[r.stopIdx].id, status: r.status, score: r.score, lat: c ? c.lat : null, lng: c ? c.lng : null,
        from: c ? iso(c.from) : null, to: c ? iso(c.to) : null, rest: c ? c.rest || null : null, hop: c ? !!c.hop : false, site: c ? !!c.atSite : false };
    }) };
  }
  const settings = await wb.getSettings(cid);
  let matched = 0, applied = 0, moved = false, retried = 0;
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
    address: formatAddress(c.place, c.lat, c.lng), city: c.place ? c.place.city : null,
    country: c.place ? c.place.country : null, signals: signals || [], short: !!c.short,
    rest: c.rest || null, hop: !!c.hop, site: !!c.atSite });

  for (const r of res) {
    const s = stops[r.stopIdx];
    if (s.match_status === 'confirmed') { matched++; continue; }
    // a rendszer ebből a GPS-állásból írta be a gombot (a sofőr ezt látja / hagyja jóvá) → az ideje rögzített
    if (pinOf(s) && s.match_status !== 'rejected') {
      matched++;
      // lezárt fuvar: a friss újraszámolás eredményét eltesszük ellenőrzésre (a hely és az idő nem íródik át itt)
      if (closed && !dry) {
        const cc = r.candIdx != null ? cands[r.candIdx] : null;
        const review = cc ? { from: iso(cc.from), to: iso(cc.to), lat: cc.lat, lng: cc.lng, votes: votes[r.stopIdx], at: new Date().toISOString() }
                          : { none: true, at: new Date().toISOString() };
        try {
          await pool.query(`UPDATE order_stops SET match_detail = COALESCE(match_detail,'{}'::jsonb) || jsonb_build_object('review', $3::jsonb)
                             WHERE id=$1 AND company_id=$2`, [s.id, cid, JSON.stringify(review)]);
        } catch (_) {}
      }
      continue;
    }
    // az iroda által már elvetett helyek ennél az állomásnál (ide nem tesszük vissza)
    const rejPts = rejectedPoints(s);
    if (s.match_status === 'rejected') {
      // elvetett pont: új találatot keresünk (az elvetett helyek nélkül); ha van, „javaslat" lesz belőle,
      // és a menetlevélre is ráírjuk a pontos koordinátás címmel. Ha nincs, az elvetés marad.
      let alt = r.ranked.map((x) => candOut(cands[x.j], x.score, x.signals));
      alt = alt.concat(extra.map((e) => { const sp = sm.scorePair(s, e, expect[r.stopIdx]); return candOut(e, sp.score, sp.signals); }));
      alt = alt.filter((c) => !nearAny(c, rejPts)).sort((a, b) => b.score - a.score).slice(0, MAX_CANDIDATES_LOW);
      // ne a fuvar egy másik állomásának a helyét adjuk neki
      const others = stops.filter((x) => x.id !== s.id && x.actual_lat != null && x.match_status !== 'rejected')
        .map((x) => ({ lat: Number(x.actual_lat), lng: Number(x.actual_lng) }));
      const best = alt.find((c) => c.score > RETRY_MIN_SCORE && !nearAny(c, others)) || null;
      if (!best) {
        await pool.query(
          `UPDATE order_stops SET match_detail = jsonb_set(COALESCE(match_detail,'{}'::jsonb), '{candidates}', $3::jsonb)
                                   || jsonb_build_object('rejected_pts', $4::jsonb)
            WHERE id=$1 AND company_id=$2 AND match_status='rejected'`, [s.id, cid, JSON.stringify(alt), JSON.stringify(rejPts)]);
        continue;
      }
      let place = null;
      try { place = await reversePlace(best.lat, best.lng, opts); } catch (_) {}
      const addr = formatAddress(place, best.lat, best.lng);
      const det = { v: 1, retry: true, signals: best.signals, candidates: alt, rejected_pts: rejPts };
      const up = await pool.query(
        `UPDATE order_stops SET actual_lat=$3, actual_lng=$4, actual_address=$5, actual_city=$6, actual_country=$7,
                gps_arrived_at=$8, gps_left_at=$9, match_score=$10, match_source='retry', match_status='suggested',
                match_detail=$11::jsonb, matched_at=NOW()
          WHERE id=$1 AND company_id=$2 AND match_status='rejected'`,
        [s.id, cid, best.lat, best.lng, addr.slice(0, 500), place ? (place.city || place.municipality || null) : best.city,
          place ? place.country : best.country, best.from, best.to, Math.round(best.score), JSON.stringify(det)]);
      if (up.rowCount) {
        matched++; moved = true; retried++;
        try { const x = await wb.applyStop(cid, s.id); if (x.ok) applied += x.points; }
        catch (e) { console.warn('[StopMatch] új találat rátétele hiba', s.id, e.message); }
      }
      continue;
    }
    const low = r.status !== 'auto';
    let top = r.ranked.slice(0, low ? MAX_CANDIDATES_LOW : 4).filter((x) => x.score > -20 || low).map((x) => candOut(cands[x.j], x.score, x.signals));
    if (low && extra.length) {
      const ex = extra.map((e) => { const sp = sm.scorePair(s, e, expect[r.stopIdx]); return candOut(e, sp.score, sp.signals); });
      top = top.concat(ex).sort((a, b) => b.score - a.score).slice(0, MAX_CANDIDATES_LOW);
    }
    let c = r.candIdx != null ? cands[r.candIdx] : null;
    let st = r.status, sc = r.score, sig = r.signals;
    if (rejPts.length) {
      top = top.filter((x) => !nearAny(x, rejPts));
      // a motor ugyanazt az elvetett helyet választaná → a következő, nem elvetett jelölt (csak javaslatként)
      if (c && nearAny(c, rejPts)) {
        const b = top.find((x) => x.score > RETRY_MIN_SCORE);
        c = b ? { lat: b.lat, lng: b.lng, from: _sec(b.from), to: _sec(b.to), place: null, dur: 0 } : null;
        if (c) { try { c.place = await reversePlace(c.lat, c.lng, opts); } catch (_) {} }
        st = c ? 'suggested' : 'unmatched'; sc = b ? Math.round(b.score) : null; sig = b ? b.signals : [];
      } else if (st === 'auto') st = 'suggested';   // már tévedett itt egyszer → kézi megerősítés kell
    }
    const detail = { v: 1, margin: r.margin, signals: sig, candidates: top,
      votes: (r.candIdx != null && c === cands[r.candIdx]) ? votes[r.stopIdx] : undefined,
      dur_min: c && c.dur ? Math.round(c.dur / 60) : null, road_m: c ? c.road_m : null, maneuvers: c ? c.maneuvers : null };
    if (rejPts.length) detail.rejected_pts = rejPts;
    // az egymás utáni körök eredménye (a következő kör szavazásához) — legfeljebb az utolsó 3
    detail.vote_hist = sm.pushHistory(s.match_detail && s.match_detail.vote_hist, histWin[r.stopIdx]);
    // a végellenőrzés által elvetett állás megmarad (ne kerüljön újra beírásra ugyanabból)
    if (s.match_detail && s.match_detail.verify_fail) detail.verify_fail = s.match_detail.verify_fail;
    if (c) matched++;
    if (_moved(s, c)) moved = true;
    await pool.query(
      `UPDATE order_stops SET actual_lat=$3, actual_lng=$4, actual_address=$5, actual_city=$6, actual_country=$7,
              gps_arrived_at=$8, gps_left_at=$9, match_score=$10, match_source=$11,
              match_status = CASE WHEN $12 = 'auto' AND $10::int < $14 AND needs_manual THEN 'suggested' ELSE $12 END,
              needs_manual = CASE WHEN $10::int >= $14 THEN false ELSE needs_manual END,
              recheck_at = COALESCE(recheck_at, NOW()),
              match_detail=$13::jsonb, matched_at=NOW()
        WHERE id=$1 AND company_id=$2 AND COALESCE(match_status,'') NOT IN ('confirmed','rejected')`,
      [s.id, cid, c ? c.lat : null, c ? c.lng : null, c ? formatAddress(c.place, c.lat, c.lng).slice(0, 500) : null,
        c && c.place ? (c.place.city || c.place.municipality) : null, c && c.place ? c.place.country : null,
        c ? iso(c.from) : null, c ? iso(c.to) : null, sc, c ? (rejPts.length ? 'retry' : c.inferred ? 'inferred' : (sig.some((x) => x[0] === 'memory') ? 'memory' : 'gps')) : null,
        st, JSON.stringify(detail), RECHECK_TARGET]);
    // automatikus rátétel a menetlevélre, ha a cég bekapcsolta és a pontszám eléri a küszöböt
    const capped = st === 'auto' && sc < RECHECK_TARGET && s.needs_manual === true ? 'suggested' : st;
    if (c && (s.waybill_apply === true || rejPts.length || wb.qualifies(settings, capped, sc))) {
      try { const x = await wb.applyStop(cid, s.id); if (x.ok) applied += x.points; }
      catch (e) { console.warn('[StopMatch] auto-rátétel hiba', s.id, e.message); }
    }
  }
  // elfelejtett állomás-gomb pótlása a biztos GPS-állásból (a sofőr következő belépéskor átnézi)
  let autoFilled = 0;
  try { autoFilled = (await autoEv.applyAutoEvents(cid, orderId, { lastPtSec: pts[pts.length - 1][0] })).filled || 0; }
  catch (e) { if (!(e && (e.code === '42703' || e.code === '42P01'))) console.warn('[StopMatch] auto-esemény hiba', orderId, e.message); }
  // ha egy állomás helye érdemben változott, a fuvar és a menetlevél útvonal-ellenőrzése is újraszámolandó
  if (moved) await invalidateRoutes(cid, orderId);
  const finished = ['Finalizat', 'Anulat'].includes(o.status) && allComplete;
  const status = matched === stops.length ? 'done' : (finished ? 'done' : 'partial');
  await _state(cid, orderId, status, matched + '/' + stops.length);
  // lezárt fuvar háttér-ellenőrzése akkor kész, ha a napok GPS-adata teljes (különben később újra)
  if (closed && allComplete) {
    try { await pool.query('UPDATE stop_match_state SET closed_review_at = NOW() WHERE order_id=$1', [orderId]); } catch (_) {}
  }
  return { ok: true, status, matched, applied, retried, autoFilled, total: stops.length, candidates: cands.length };
}

// ── Sor kiválasztása az ütemezőnek ───────────────────────────
// esedékes heti újraellenőrzés ($2 = max, $3 = cél-pontszám, $4 = napok)
const RECHECK_DUE_SQL = `EXISTS (SELECT 1 FROM order_stops rs WHERE rs.order_id = o.id AND rs.company_id = o.company_id
    AND rs.match_status IN ('auto','suggested','unmatched') AND COALESCE(rs.match_score, 0) < $3
    AND rs.needs_manual = false AND rs.recheck_count < $2
    AND rs.matched_at IS NOT NULL AND COALESCE(rs.recheck_at, rs.matched_at) < NOW() - ($4::int * INTERVAL '1 day'))`;
// Elfelejtett állomás-gomb keresése: a legtöbb fuvaron csak dátum van, pontos idő nem,
// ezért a nyitott (sofőr által még nem lezárt) állomásokat a dátumuktól kezdve
// nappal (8–19 h, helyi idő) óránként újranézzük; ha estig nincs meg, éjfél után
// egyszer (az esti lerakás miatt), majd másnap nappal újra óránként — amíg meg
// nem találjuk (a sofőr megnyomja, vagy a GPS-ből pótoljuk), legfeljebb
// PRESS_WINDOW_DAYS napig a tervezett dátum után.
const PRESS_TZ = 'Europe/Bucharest';
const PRESS_DAY_FROM = 5, PRESS_DAY_TO = 23;     // 15 percenkénti keresés ablaka (helyi óra); éjjel éjfél után egyszer
const PRESS_EVERY_MIN = 14;                      // „15 percenként" (kis tűréssel az 5 perces körhöz)
const PRESS_WINDOW_DAYS = 14;
// $5 = ablak (nap), $6 = „most" (tesztelhető). Csak bekapcsolt automatikus pótlásnál és belső sofőrös fuvaron.
const PRESS_DUE_SQL = `(
    o.status IN ('Alocat','In Curs','Finalizat') AND COALESCE(o.email_sofer,'') <> ''
    AND COALESCE((SELECT ms.auto_events FROM stop_match_settings ms WHERE ms.company_id = o.company_id), true)
    AND EXISTS (SELECT 1 FROM order_stops ps WHERE ps.order_id = o.id AND ps.company_id = o.company_id
                 AND ps.done_at IS NULL
                 AND COALESCE(ps.data, o.data_incarcare, o.created_at::date) <= ($6::timestamptz AT TIME ZONE '${PRESS_TZ}')::date
                 AND COALESCE(ps.data, o.data_incarcare, o.created_at::date) >= ($6::timestamptz AT TIME ZONE '${PRESS_TZ}')::date - $5::int)
    AND (
      (EXTRACT(HOUR FROM $6::timestamptz AT TIME ZONE '${PRESS_TZ}') >= ${PRESS_DAY_FROM}
        AND EXTRACT(HOUR FROM $6::timestamptz AT TIME ZONE '${PRESS_TZ}') < ${PRESS_DAY_TO}
        AND st.attempted_at < $6::timestamptz - INTERVAL '${PRESS_EVERY_MIN} minutes')
      OR (EXTRACT(HOUR FROM $6::timestamptz AT TIME ZONE '${PRESS_TZ}') < ${PRESS_DAY_FROM}
        AND st.attempted_at < (date_trunc('day', $6::timestamptz AT TIME ZONE '${PRESS_TZ}') AT TIME ZONE '${PRESS_TZ}'))
    ))`;

// Lezárt / folyamatban lévő fuvarok, amelyeknél van GPS-párosított jármű, és
// még nem dolgoztuk fel (vagy kézzel újrasorba tették, vagy 6 órája részleges).
async function pickQueue(limit, now) {
  const { rows } = await pool.query(
    `SELECT o.id, o.company_id, (` + RECHECK_DUE_SQL + `) AS recheck FROM orders o
       LEFT JOIN stop_match_state st ON st.order_id = o.id
      WHERE (o.status IN ('In Curs','Finalizat','Parkolt','Raktarban')
             OR (o.status = 'Alocat' AND COALESCE(o.email_sofer,'') <> '' AND o.data_incarcare <= CURRENT_DATE))
        AND COALESCE(o.rendszam_camion,'') <> ''
        AND EXISTS (SELECT 1 FROM vehicle_gps_map g WHERE g.company_id=o.company_id
                     AND ${PLATE_SQL('g.rendszam')} = ${PLATE_SQL('o.rendszam_camion')})
        AND (
          (st.order_id IS NULL AND COALESCE(o.finalized_at, o.created_at) > NOW() - INTERVAL '120 days')
          OR st.requeued = true
          OR (st.status IN ('partial','no_gps','error') AND st.attempted_at < NOW() - INTERVAL '6 hours' AND st.attempts < 12)
          OR (COALESCE(o.finalized_at, o.created_at) > NOW() - INTERVAL '200 days' AND (` + RECHECK_DUE_SQL + `))
          OR ` + PRESS_DUE_SQL + `
          OR (o.status = 'Finalizat' AND o.finalized_at > NOW() - INTERVAL '30 days'
              AND (st.order_id IS NULL OR st.attempted_at < NOW() - INTERVAL '1 hour')
              AND (st.order_id IS NULL OR (to_jsonb(st) ->> 'closed_review_at') IS NULL
                   OR (to_jsonb(st) ->> 'closed_review_at')::timestamptz < o.finalized_at))
        )
      ORDER BY st.requeued DESC NULLS LAST, COALESCE(o.finalized_at, o.created_at) DESC
      LIMIT $1`, [limit, RECHECK_MAX, RECHECK_TARGET, RECHECK_DAYS, PRESS_WINDOW_DAYS, now || new Date()]);
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

module.exports = { pinOf, PRESS_DUE_SQL, PRESS_WINDOW_DAYS, PRESS_DAY_FROM, PRESS_DAY_TO, nearAny, rejectedPoints, RETRY_MIN_SCORE, RECHECK_TARGET, RECHECK_MAX, RECHECK_DAYS, RECHECK_BUMP_SQL, invalidateRoutes, _moved, matchOrder, pickQueue, learnPlace, reversePlace, isoDate, recordFeedback, recordBadPlace, requeueOpen, _placeFromNominatim, formatAddress, coordText, upgradedAddress, upgradeAddressFormat };
