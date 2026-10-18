// ============================================================
//  handlers/gpsTrack.js — GPS útvonal-előzmény (napi bontás, max. 31 nap)
//    gpsTrackVehicles  — a cég GPS-párosított járművei + hány nap van mentve
//    gpsTrackRange     — egy jármű útvonala egy időszakra: úthálózatra
//                        illesztett vonal, km (út / km-óra / GPS), menetek
//                        és állások naponként, összesítő, tankolások
//    gpsTrackPoint     — a térképen kattintott ponthoz legközelebbi GPS-rekord
//                        (idő, sebesség, km-óra, tartály-szint, fogyasztás)
//  Admin/Manager, company_id-szűrt, paraméteres SQL. Adat: gps_track_days
//  (a services/scheduler.js startGpsTrackHistoryScheduler gyűjti).
// ============================================================
const pool = require('../db');
const gt = require('../lib/gpsTrack');
const { decrypt } = require('../lib/crypto');
const { featureEnabled } = require('../lib/featureEnabled');

const handlers = {};
const _am = (u) => u && ['Admin', 'Manager'].includes(u.pozicio);
const normPlate = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const MAX_DAYS = 31;
const ONDEMAND_MATCH_DAYS = 2;            // kérésenként ennyi még nem illesztett napot illeszt azonnal
const _liveRefresh = new Map();           // `${cid}|${plate}` -> utolsó élő frissítés ideje

// Hely-név (indulás/érkezés) — Nominatim reverse, memória-cache, rövid timeout
const _revCache = new Map();
async function reverseName(lat, lng) {
  const k = lat.toFixed(3) + ',' + lng.toFixed(3);
  if (_revCache.has(k)) return _revCache.get(k);
  let name = null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 4000);
  try {
    const r = await fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&accept-language=ro&lat=' + lat + '&lon=' + lng,
      { signal: ctrl.signal, headers: { 'User-Agent': 'VallorSoft/1.0 (flottakezelo)' } });
    const d = await r.json();
    const a = (d && d.address) || {};
    const city = a.city || a.town || a.village || a.municipality || a.county || '';
    const road = [a.road, a.house_number].filter(Boolean).join(' ');
    name = [(a.country_code || '').toUpperCase(), city, road].filter(Boolean).join(', ') || (d && d.display_name) || null;
  } catch (_) { name = null; } finally { clearTimeout(t); }
  if (_revCache.size > 2000) _revCache.clear();
  _revCache.set(k, name);
  return name;
}

handlers.gpsTrackVehicles = async function (req, res) {
  try {
    if (!_am(req.session.user)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = req.session.user.company_id;
    const { rows } = await pool.query(
      `SELECT m.rendszam, MAX(v.marca) AS marca, MAX(v.model) AS model
         FROM vehicle_gps_map m
    LEFT JOIN vehicles v ON v.company_id = m.company_id
              AND UPPER(REGEXP_REPLACE(COALESCE(v.rendszam,''),'[^A-Za-z0-9]','','g'))
                = UPPER(REGEXP_REPLACE(COALESCE(m.rendszam,''),'[^A-Za-z0-9]','','g'))
        WHERE m.company_id = $1 AND m.provider = 'cargotrack'
        GROUP BY m.rendszam ORDER BY m.rendszam`, [cid]);
    let stat = {};
    try {
      const s = await pool.query(
        `SELECT rendszam, COUNT(*)::int AS days, MIN(day)::text AS first_day, MAX(day)::text AS last_day
           FROM gps_track_days WHERE company_id=$1 AND point_count > 0 GROUP BY rendszam`, [cid]);
      for (const r of s.rows) stat[r.rendszam] = r;
    } catch (e) { if (!(e && e.code === '42P01')) throw e; }
    return res.json({ result: { ok: true, today: gt.localDay(Date.now()),
      vehicles: rows.map((v) => Object.assign({}, v, stat[v.rendszam] || { days: 0 })) } });
  } catch (err) {
    console.error('gpsTrackVehicles hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

handlers.gpsTrackRange = async function (req, res, args) {
  try {
    const u = req.session.user;
    if (!_am(u)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = u.company_id;
    const a = (args && args[0]) || {};
    const plateIn = String(a.rendszam || '').trim();
    const from = String(a.from || '').trim(), to = String(a.to || '').trim();
    if (!plateIn) return res.json({ result: { ok: false, err: 'Nr. înmatriculare lipsă.' } });
    if (!gt.isDay(from) || !gt.isDay(to) || to < from) return res.json({ result: { ok: false, err: 'Interval invalid (YYYY-MM-DD).' } });
    const span = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
    if (span > MAX_DAYS) return res.json({ result: { ok: false, err: 'Intervalul maxim este de ' + MAX_DAYS + ' de zile.' } });

    // a jármű a cégé (GPS-párosítás)
    const mp = await pool.query(
      `SELECT rendszam, object_id FROM vehicle_gps_map WHERE company_id=$1 AND provider='cargotrack'`, [cid]);
    const map = mp.rows.find((r) => normPlate(r.rendszam) === normPlate(plateIn));
    if (!map) return res.json({ result: { ok: false, err: 'Vehiculul nu este asociat cu GPS.' } });
    const plate = map.rendszam;

    const now = Date.now();
    const today = gt.localDay(now);

    // élő frissítés: ha a mai nap az időszakban van, a legújabb pontok letöltése (max. 1×/perc)
    let liveErr = null;
    if (to >= today && from <= today && map.object_id) {
      const lk = cid + '|' + plate;
      if (!_liveRefresh.has(lk) || now - _liveRefresh.get(lk) > 60000) {
        _liveRefresh.set(lk, now);
        try {
          if (await featureEnabled(cid, 'gps-integracio')) {
            const k = await pool.query(`SELECT credentials_enc FROM company_integrations WHERE company_id=$1 AND provider='cargotrack' AND enabled=true`, [cid]);
            if (k.rows.length && k.rows[0].credentials_enc) {
              const apiKey = decrypt(k.rows[0].credentials_enc);
              const f = await pool.query(`SELECT fetched_until FROM gps_track_days WHERE company_id=$1 AND rendszam=$2 AND day=$3`, [cid, plate, today]);
              const ds = gt.dayStartMs(today);
              const since = f.rows.length && f.rows[0].fetched_until ? Math.max(ds, new Date(f.rows[0].fetched_until).getTime() - 15 * 60000) : ds;
              const pts = await gt.fetchRange(apiKey, map.object_id, since, now, { pauseMs: 0 });
              await gt.mergeDay(cid, plate, map.object_id, today, pts, now, false);
            }
          }
        } catch (e) { liveErr = e.message; console.warn('[GpsTrack] élő frissítés hiba', plate, e.message); }
      }
    }

    let rows = [];
    try {
      ({ rows } = await pool.query(
        `SELECT company_id, rendszam, day::text AS day, points_json, point_count, complete, segments, km_road, km_raw,
                match_source, matched_count, matched_at
           FROM gps_track_days WHERE company_id=$1 AND rendszam=$2 AND day BETWEEN $3::date AND $4::date
          ORDER BY day`, [cid, plate, from, to]));
    } catch (e) {
      if (e && e.code === '42P01') return res.json({ result: { ok: true, days: [], totals: null, migration_pending: true } });
      throw e;
    }

    // még nem (vagy elavultan) illesztett napok: a legfrissebbek azonnal
    let budget = ONDEMAND_MATCH_DAYS;
    const needMatch = rows.filter((r) => r.point_count > 1 && (r.matched_count !== r.point_count) &&
      !(r.day === today && r.matched_at && now - new Date(r.matched_at).getTime() < 10 * 60000)).reverse();
    for (const r of needMatch) {
      if (budget-- <= 0) break;
      try {
        const m = await gt.matchAndSaveDay(r);
        if (m) { r.segments = m.segments; r.km_road = m.km_road; r.km_raw = m.km_raw; r.match_source = m.source; r.matched_count = r.point_count; }
      } catch (e) { console.warn('[GpsTrack] azonnali illesztés hiba', plate, r.day, e.message); }
    }

    const days = [];
    let all = [];
    const T = { km_road: 0, km_gps: 0, drive_sec: 0, stop_sec: 0, pending_days: 0 };
    for (const r of rows) {
      let pts = [];
      try { pts = JSON.parse(r.points_json || '[]'); } catch (_) {}
      if (!pts.length) continue;
      const endSec = Math.min(gt.dayStartMs(gt.addDays(r.day, 1)), now) / 1000;
      const tl = gt.buildTimeline(pts, endSec);
      const matched = r.matched_count === r.point_count && Array.isArray(r.segments);
      const segments = matched ? r.segments
        : [{ p: gt.encodePolyline(pts.map((p) => [p[1], p[2]])), k: 'r' }];
      const kmGps = Math.round(gt.sumKm(pts) * 100) / 100;
      const kmRoad = matched ? parseFloat(r.km_road) : null;
      if (!matched) T.pending_days++;
      T.km_road += kmRoad != null ? kmRoad : kmGps;
      T.km_gps += kmGps;
      const lf = gt.levelFuel(pts);
      const drive = tl.trips.reduce((s, x) => s + (x.to - x.from), 0);
      const stopS = tl.stops.reduce((s, x) => s + (x.to - x.from), 0);
      T.drive_sec += drive; T.stop_sec += stopS;
      days.push({
        day: r.day, matched, source: matched ? r.match_source : 'raw', point_count: pts.length,
        km_road: kmRoad, km_gps: kmGps, km_odo: gt.odoDelta(pts, 0, pts.length - 1), fuel: gt.fuelDelta(pts, 0, pts.length - 1),
        fuel_level_used: lf ? lf.used : null, refuels: lf ? lf.refuels : [],
        drive_sec: drive, stop_sec: stopS, trips: tl.trips, stops: tl.stops, segments,
        first_at: pts[0][0], last_at: pts[pts.length - 1][0],
      });
      all = all.concat(pts);
    }
    let totals = null;
    if (all.length) {
      const kmOdo = gt.odoDelta(all, 0, all.length - 1, 50000);
      const fuelCnt = gt.fuelDelta(all, 0, all.length - 1, 20000);
      const lfAll = gt.levelFuel(all);
      // a fogyasztás-számláló elsőbbséget élvez; ha az eszköz nem adja, a tartály-szintből
      const fuel = fuelCnt != null ? fuelCnt : (lfAll ? lfAll.used : null);
      const fuelSrc = fuelCnt != null ? 'counter' : (lfAll ? 'level' : null);
      const first = all[0], last = all[all.length - 1];
      const [startLoc, endLoc] = await Promise.all([reverseName(first[1], first[2]), reverseName(last[1], last[2])]);
      totals = {
        km_road: Math.round(T.km_road * 100) / 100, km_gps: Math.round(T.km_gps * 100) / 100, km_odo: kmOdo,
        fuel, fuel_src: fuelSrc, fuel_level_used: lfAll ? lfAll.used : null,
        refuel_l: lfAll ? Math.round(lfAll.refuels.reduce((a, x) => a + x.liters, 0) * 10) / 10 : null,
        refuel_count: lfAll ? lfAll.refuels.length : 0, avg_l100: (fuel != null && kmOdo) ? Math.round(fuel / kmOdo * 10000) / 100 : null,
        l_per_h: (fuel != null && T.drive_sec > 0) ? Math.round(fuel / (T.drive_sec / 3600) * 100) / 100 : null,
        drive_sec: T.drive_sec, stop_sec: T.stop_sec, pending_days: T.pending_days,
        start: { lat: first[1], lng: first[2], t: first[0], name: startLoc },
        end: { lat: last[1], lng: last[2], t: last[0], name: endLoc },
      };
    }
    return res.json({ result: { ok: true, rendszam: plate, from, to, days, totals, live_error: liveErr } });
  } catch (err) {
    console.error('gpsTrackRange hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

handlers.gpsTrackPoint = async function (req, res, args) {
  try {
    const u = req.session.user;
    if (!_am(u)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = u.company_id;
    const a = (args && args[0]) || {};
    const day = String(a.day || '').trim();
    const lat = parseFloat(a.lat), lng = parseFloat(a.lng);
    if (!gt.isDay(day) || !isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return res.json({ result: { ok: false, err: 'Date invalide.' } });
    }
    const mp = await pool.query(`SELECT rendszam FROM vehicle_gps_map WHERE company_id=$1 AND provider='cargotrack'`, [cid]);
    const map = mp.rows.find((r) => normPlate(r.rendszam) === normPlate(a.rendszam));
    if (!map) return res.json({ result: { ok: false, err: 'Vehiculul nu este asociat cu GPS.' } });
    const { rows } = await pool.query(
      `SELECT points_json FROM gps_track_days WHERE company_id=$1 AND rendszam=$2 AND day=$3::date`, [cid, map.rendszam, day]);
    let pts = [];
    try { pts = JSON.parse((rows[0] && rows[0].points_json) || '[]'); } catch (_) {}
    const near = gt.nearestPoint(pts, lat, lng);
    if (!near || near.dist_m > 3000) return res.json({ result: { ok: false, err: 'Nu există punct GPS în apropiere.' } });
    const p = pts[near.i];
    // tartály-szint korrekció a jármű adatlapjáról (mint a menetlevél GPS-gombjánál)
    let corr = 0;
    try {
      const v = await pool.query(
        `SELECT fuel_correction_l FROM vehicles WHERE company_id=$1
            AND UPPER(REGEXP_REPLACE(COALESCE(rendszam,''),'[^A-Za-z0-9]','','g')) = $2 LIMIT 1`, [cid, normPlate(map.rendszam)]);
      corr = parseFloat(v.rows[0] && v.rows[0].fuel_correction_l) || 0;
    } catch (_) { corr = 0; }
    const level = p[7] != null ? Math.max(0, Math.round((p[7] + corr) * 10) / 10) : null;
    const kmDay = gt.odoDelta(pts, 0, near.i);
    const fuelDay = gt.fuelDelta(pts, 0, near.i);
    const lf = gt.levelFuel(pts, 0, near.i);
    return res.json({ result: { ok: true, point: {
      t: p[0], lat: p[1], lng: p[2], speed: p[3], ignition: p[4], mileage: p[5], fuel_counter: p[6],
      fuel_level: level, direction: p[8] != null ? p[8] : null, dist_m: near.dist_m,
      km_day: kmDay, fuel_day: fuelDay != null ? fuelDay : (lf ? lf.used : null),
      avg_day: (kmDay >= 20 && (fuelDay != null || lf)) ? Math.round((fuelDay != null ? fuelDay : lf.used) / kmDay * 10000) / 100 : null,
      name: await reverseName(p[1], p[2]),
    } } });
  } catch (err) {
    console.error('gpsTrackPoint hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

module.exports = handlers;
