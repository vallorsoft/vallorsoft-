// ============================================================
//  handlers/gpsToll.js — Útdíj a GPS-naplóból (HERE Route Import)
//    gpsTollParams — a jármű kamion-paraméterei az útdíjhoz:
//                    útvonaltervező alap ← jármű adata (vehicles) → előtöltés
//    gpsTrackToll  — két dátum közti GPS-útvonal (gps_track_days) útdíja
//                    a HERE-ből, naponként cache-elve (gps_toll_days);
//                    a kamion-paraméterek: alap ← jármű ← kézi bevitel
//  Admin/Manager, company_id-szűrt, paraméteres SQL. Kapuk: `toll-becsles`
//  csomag-kapcsoló + a cég HERE-kulcsa (mapsProvider, developer állítja).
//  Kulcs nélkül az ingyenes, ráta-alapú becslést adja vissza.
// ============================================================
const crypto = require('crypto');
const pool = require('../db');
const gt = require('../lib/gpsTrack');
const tp = require('../lib/tollProvider');
const maps = require('../lib/mapsProvider');
const { estimateFromPolyline } = require('../lib/tollEstimate');
const { featureEnabled } = require('../lib/featureEnabled');
const audit = require('../lib/audit');

const handlers = {};
const _am = (u) => u && ['Admin', 'Manager'].includes(u.pozicio);
const normPlate = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const MAX_DAYS = 31;
const CONCURRENCY = 2;
const MATCH_ON_DEMAND = 5;      // kérésenként ennyi még nem illesztett napot illesztünk az útra
// A számítási mód verziója a cache-kulcsban: módszer-változáskor (pl. a ritka
// nyomvonal → sűrített, útra illesztett geometria) a régi eredmény nem jön vissza.
const CALC_VERSION = 'v2-matched-dense';
const RAW_MARK = 'vs:raw';      // a cache-sor nyers (nem illesztett) nyomvonalból készült

function paramsHash(t) {
  const keys = Object.keys(t).sort();
  return crypto.createHash('sha1').update(CALC_VERSION + JSON.stringify(keys.map((k) => [k, t[k]]))).digest('hex');
}

// Egy nap HERE-nek küldendő geometriája: az úthálózatra illesztett szakaszok
// (OSRM, gps_track_days.segments), ha a nap illesztve van; különben a nyers pontok.
function dayGeometry(row, pts) {
  const matched = row.matched_count === row.point_count && Array.isArray(row.segments) && row.segments.length > 0;
  if (matched) {
    const geo = [];
    for (const sg of row.segments) {
      if (!sg || !sg.p) continue;
      for (const c of gt.decodePolyline(sg.p)) geo.push(c);
    }
    if (geo.length >= 2) return { geo, matched: true };
  }
  return { geo: pts.map((p) => [p[1], p[2]]), matched: false };
}

// A cég GPS-párosított járműve + a vehicles sor (kamion-mezőkkel)
async function _findVehicle(cid, plateIn) {
  const mp = await pool.query(
    `SELECT rendszam, object_id FROM vehicle_gps_map WHERE company_id=$1 AND provider='cargotrack'`, [cid]);
  const map = mp.rows.find((r) => normPlate(r.rendszam) === normPlate(plateIn)) || null;
  let veh = null;
  try {
    const vr = await pool.query(
      `SELECT id, rendszam, tip, marca, model, weight_kg, height_cm, length_cm, width_cm, weight_per_axle_kg,
              axle_count, trailer_count, emission_class
         FROM vehicles WHERE company_id=$1`, [cid]);
    veh = vr.rows.find((r) => normPlate(r.rendszam) === normPlate(plateIn)) || null;
  } catch (e) {
    // migráció előtt (nincs emission_class) — nélküle
    if (e && e.code === '42703') {
      const vr = await pool.query(
        `SELECT id, rendszam, tip, marca, model, weight_kg, height_cm, length_cm, width_cm, weight_per_axle_kg,
                axle_count, trailer_count
           FROM vehicles WHERE company_id=$1`, [cid]);
      veh = vr.rows.find((r) => normPlate(r.rendszam) === normPlate(plateIn)) || null;
    } else throw e;
  }
  return { map, veh };
}

handlers.gpsTollParams = async function (req, res, args) {
  try {
    const u = req.session.user;
    if (!_am(u)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = u.company_id;
    const a = (args && args[0]) || {};
    const plateIn = String(a.rendszam || '').trim();
    if (!plateIn) return res.json({ result: { ok: false, err: 'Nr. înmatriculare lipsă.' } });
    const { map, veh } = await _findVehicle(cid, plateIn);
    if (!map && !veh) return res.json({ result: { ok: false, err: 'Vehiculul nu a fost găsit.' } });
    const vehLayer = tp.normalizeTruck(tp.truckFromVehicle(veh));
    const cfg = await maps.getConfig(cid).catch(() => ({ vendor: 'free' }));
    return res.json({ result: {
      ok: true,
      defaults: tp.TRUCK_DEFAULTS,
      from_vehicle: vehLayer,
      params: tp.mergeTruck(vehLayer),
      vehicle: veh ? { id: veh.id, rendszam: veh.rendszam, tip: veh.tip, marca: veh.marca, model: veh.model } : null,
      emission_classes: tp.EMISSION_CLASSES,
      has_here_key: !!(cfg && cfg.vendor === 'here' && cfg.key),
    } });
  } catch (err) {
    console.error('gpsTollParams hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// Egyszerű párhuzamosság-korlát
async function _pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  });
  await Promise.all(workers);
  return out;
}

handlers.gpsTrackToll = async function (req, res, args) {
  try {
    const u = req.session.user;
    if (!_am(u)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = u.company_id;
    if (!(await featureEnabled(cid, 'toll-becsles'))) {
      return res.json({ result: { ok: false, err: 'Functie nedisponibila in pachetul curent.' } });
    }
    const a = (args && args[0]) || {};
    const plateIn = String(a.rendszam || '').trim();
    const from = String(a.from || '').trim(), to = String(a.to || '').trim();
    if (!plateIn) return res.json({ result: { ok: false, err: 'Nr. înmatriculare lipsă.' } });
    if (!gt.isDay(from) || !gt.isDay(to) || to < from) return res.json({ result: { ok: false, err: 'Interval invalid (YYYY-MM-DD).' } });
    const span = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
    if (span > MAX_DAYS) return res.json({ result: { ok: false, err: 'Intervalul maxim pentru taxa de drum este de ' + MAX_DAYS + ' de zile.' } });

    const { map, veh } = await _findVehicle(cid, plateIn);
    if (!map) return res.json({ result: { ok: false, err: 'Vehiculul nu este asociat cu GPS.' } });
    const plate = map.rendszam;

    // Kamion-paraméterek: útvonaltervező alap ← jármű ← kézi bevitel
    const vehLayer = tp.truckFromVehicle(veh);
    const truck = tp.mergeTruck(vehLayer, a.truck || {});
    const hash = paramsHash(truck);

    let rows;
    try {
      ({ rows } = await pool.query(
        `SELECT company_id, rendszam, day::text AS day, points_json, point_count, segments, matched_count FROM gps_track_days
          WHERE company_id=$1 AND rendszam=$2 AND day BETWEEN $3::date AND $4::date ORDER BY day`,
        [cid, plate, from, to]));
    } catch (e) {
      if (e && e.code === '42P01') return res.json({ result: { ok: false, err: 'Istoricul GPS nu este încă disponibil.' } });
      throw e;
    }

    // napi pontsorok; a nap elejére az előző (szomszédos) nap utolsó pontja kerül,
    // hogy a két nap nyomvonala összeérjen
    const days = [];
    let prevLast = null, prevDay = null;
    for (const r of rows) {
      let pts = [];
      try { pts = JSON.parse(r.points_json || '[]'); } catch (_) { pts = []; }
      const joinPrev = prevLast && prevDay === gt.addDays(r.day, -1) && pts.length ? prevLast : null;
      if (pts.length) { prevLast = pts[pts.length - 1]; prevDay = r.day; }
      days.push({ row: r, day: r.day, pts, joinPrev, point_count: r.point_count || 0 });
    }
    const missingDays = span - rows.filter((r) => r.point_count > 0).length;

    // ingyenes becslés (összehasonlításhoz / kulcs nélkül): ritkított teljes nyomvonal
    const allPts = [].concat(...days.map((d) => d.pts));
    let estimate = null;
    try {
      const thin = tp.thinTrace(allPts, { stepM: 2000, maxPoints: 3000 });
      if (thin.length >= 2) estimate = await estimateFromPolyline(cid, thin.map((p) => [p.lat, p.lng]));
    } catch (e) { console.warn('[GpsToll] becslés hiba', e.message); }

    const cfg = await maps.getConfig(cid).catch(() => ({ vendor: 'free' }));
    const key = cfg && cfg.vendor === 'here' ? cfg.key : null;
    if (!key) {
      return res.json({ result: {
        ok: true, rendszam: plate, from, to, source: 'estimate', no_here_key: true,
        truck_used: truck, emission_missing: !truck.emissionClass, estimate, missing_days: missingDays, days: [],
      } });
    }

    // cache
    const cache = {};
    try {
      const c = await pool.query(
        `SELECT day::text AS day, point_count, total_eur, km, breakdown, passes, notices
           FROM gps_toll_days WHERE company_id=$1 AND rendszam=$2 AND params_hash=$3 AND day BETWEEN $4::date AND $5::date`,
        [cid, plate, hash, from, to]);
      c.rows.forEach((r) => { cache[r.day] = r; });
    } catch (e) { if (!(e && e.code === '42P01')) throw e; }

    let hereCalls = 0;
    let matchBudget = MATCH_ON_DEMAND;
    const results = await _pool(days, CONCURRENCY, async (d) => {
      if (d.point_count < 2) return { day: d.day, total: 0, km: 0, breakdown: [], passes: [], cached: false, empty: true };
      const c = cache[d.day];
      const nowMatched = d.row.matched_count === d.row.point_count && Array.isArray(d.row.segments);
      const cacheRaw = c && Array.isArray(c.notices) && c.notices.includes(RAW_MARK);
      if (c && Number(c.point_count) === d.point_count && !(cacheRaw && nowMatched)) {
        const n = c.notices || [];
        return { day: d.day, total: parseFloat(c.total_eur) || 0, km: c.km != null ? parseFloat(c.km) : null,
          breakdown: c.breakdown || [], passes: c.passes || [], notices: n,
          approx: n.includes('importSplitRoute'), cached: true };
      }
      if (tp.thinTrace(d.pts).length < 2) return { day: d.day, total: 0, km: 0, breakdown: [], passes: [], cached: false, empty: true };
      // még nem illesztett nap → előbb az útra illesztjük (OSRM), mert a HERE a
      // ritka, kanyart levágó GPS-mintát nem tudja egyben ráilleszteni
      if (!(d.row.matched_count === d.row.point_count && Array.isArray(d.row.segments)) && matchBudget > 0) {
        matchBudget--;
        try {
          const m = await gt.matchAndSaveDay(d.row);
          if (m) { d.row.segments = m.segments; d.row.matched_count = d.row.point_count; }
        } catch (e) { console.warn('[GpsToll] illesztés hiba', plate, d.day, e.message); }
      }
      const g = dayGeometry(d.row, d.pts);
      if (d.joinPrev) g.geo.unshift([d.joinPrev[1], d.joinPrev[2]]);
      const depIso = d.pts[0] && d.pts[0][0] ? new Date(d.pts[0][0] * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z') : null;
      try {
        const r = await tp.hereTollFromTrace(g.geo, key, truck, { depIso });
        hereCalls += r.calls || 0;
        if (!g.matched) r.notices = (r.notices || []).concat([RAW_MARK]);
        await pool.query(
          `INSERT INTO gps_toll_days (company_id, rendszam, day, params_hash, params, point_count, total_eur, km, breakdown, passes, notices, here_calls, computed_at)
           VALUES ($1,$2,$3::date,$4,$5::jsonb,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12,NOW())
           ON CONFLICT (company_id, rendszam, day, params_hash) DO UPDATE SET
             params=EXCLUDED.params, point_count=EXCLUDED.point_count, total_eur=EXCLUDED.total_eur, km=EXCLUDED.km,
             breakdown=EXCLUDED.breakdown, passes=EXCLUDED.passes, notices=EXCLUDED.notices,
             here_calls=EXCLUDED.here_calls, computed_at=NOW()`,
          [cid, plate, d.day, hash, JSON.stringify(truck), d.point_count, r.total, r.km,
            JSON.stringify(r.breakdown), JSON.stringify(r.passes), JSON.stringify(r.notices || []), r.calls || 0])
          .catch((e) => { if (!(e && e.code === '42P01')) console.warn('[GpsToll] cache-mentés hiba', e.message); });
        return { day: d.day, total: r.total, km: r.km, breakdown: r.breakdown, passes: r.passes, notices: r.notices,
          approx: !!r.approx, cached: false, pieces: r.pieces };
      } catch (e) {
        hereCalls += e.calls || 0;
        console.warn('[GpsToll] HERE hiba', plate, d.day, e.message);
        return { day: d.day, error: String(e.message || 'HERE eroare').slice(0, 200) };
      }
    });
    for (let i = 0; i < hereCalls; i++) maps.bump(cid, 'here');

    // összesítés
    const byC = {};
    const passes = [];
    let total = 0, km = 0, errors = 0, approxDays = 0, okDays = 0, cachedDays = 0;
    results.forEach((r) => {
      if (r.empty) return;
      if (r.error) { errors++; return; }
      okDays++;
      if (r.approx) approxDays++;
      if (r.cached) cachedDays++;
      total += r.total || 0; km += r.km || 0;
      (r.breakdown || []).forEach((b) => { byC[b.country] = (byC[b.country] || 0) + (Number(b.cost) || 0); });
      (r.passes || []).forEach((p) => passes.push(Object.assign({ day: r.day }, p)));
    });
    const breakdown = Object.keys(byC).map((cc) => ({ country: cc, cost: Math.round(byC[cc] * 100) / 100 }))
      .sort((x, y) => y.cost - x.cost);

    audit.fromReq(req, 'gps.toll', 'vehicle', plate,
      { from, to, total: Math.round(total * 100) / 100, here_calls: hereCalls, errors });

    return res.json({ result: {
      ok: true, rendszam: plate, from, to, source: 'here', currency: 'EUR',
      total: Math.round(total * 100) / 100, km: Math.round(km * 10) / 10, breakdown, passes,
      days: results.filter((r) => !r.empty), errors, ok_days: okDays, approx_days: approxDays, cached_days: cachedDays,
      here_calls: hereCalls,
      truck_used: truck, emission_missing: !truck.emissionClass, estimate, missing_days: missingDays,
    } });
  } catch (err) {
    console.error('gpsTrackToll hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

module.exports = handlers;
Object.defineProperty(module.exports, '_paramsHash', { value: paramsHash, enumerable: false });
