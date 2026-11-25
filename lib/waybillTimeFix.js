// ============================================================
//  VallorSoft — lib/waybillTimeFix.js
//  A beküldött menetlevél fel-/lerakási pontjainak idő-ellenőrzése a
//  GPS-útvonalból. A sofőr gyakran utólag tölti ki a menetlevelet, és
//  rossz órát / napot ír. A rendszer a tárolt menetlevél-pont idejét a
//  GPS-időre írja át, ha a 3 FORDULÓS ellenőrzés szerint biztos benne.
//
//  Egy állomás ideje akkor írható át, ha a 3 független fordulóból legalább 2
//  rendben van, és az 1. közte van:
//    1. felismerés — a GPS-ből felismert állomás erőssége (pontszám + előny) ≥ 85%
//    2. független keresések — az állomás-felismerő 3 független keresése közül
//       legalább 2 ugyanazt az állást adta (match_detail.votes ≥ 2), egy
//       korábbi kör ugyanoda tette (vote_hist), vagy ember jóváhagyta
//    3. GPS-útvonal — a kamion nyers pontsora szerint tényleg ott állt a
//       felismert helyen, és ±15 percen belül ugyanakkor indult el
//
//  Egy menetlevelet a rendszer PONTOSAN KÉTSZER ellenőriz: amikor elkészül
//  (beküldés), és 24 órával később (addigra a GPS-nap letöltődik és az
//  állomás-felismerés lefut). Utána többet nem.
//
//  - Csak a fuvar-állomáshoz kötött pont (Încărcare / Descărcare) javul;
//    a Plecare / Sosire a sofőr saját adata — azt nem írjuk.
//  - A sofőr eredeti értéke megmarad: `time_driver` / `data_driver`;
//    `time_source='gps'`, `time_gps` (amit a rendszer írt), `time_conf` (%).
//  - Az iroda kézi átírása (`time_source='manual'`) végleges.
//  Minden lekérdezés company_id-szűrt, paraméteres.
// ============================================================
const { roDateTime, trackVisits, coordsOf } = require('./waybillRows');
const { loadTrack } = require('./waybillRouteData');
const audit = require('./audit');

const MIN_CONFIDENCE = 85;          // ennél kisebb megbízhatóságnál nem írunk felül
const TOLERANCE_MIN = 15;           // ennyi percen belüli eltérés nem hiba
const MAX_CHECKS = 2;               // ellenőrzés menetlevelenként: beküldéskor + 24 óra múlva
const RECHECK_HOURS = 24;
const AUTO_MARGIN = 12;             // = lib/stopMatch AUTO_MARGIN
const SCORE_FULL = 120;             // ennél a pontszámnál a pontszám-rész teljes
const VOTE_SLACK_SEC = 5 * 60;      // = lib/stopMatch VOTE_SLACK_SEC
const KIND = { loading: 'pickup', unloading: 'delivery' };

const _isoDate = (s) => { const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(s || '').trim()); return m ? m[1] : ''; };
const _hhmm = (s) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(s || '').trim()); return m ? (('0' + m[1]).slice(-2) + ':' + m[2]) : ''; };
const _tip = (p, re) => re.test(String((p && p.tip) || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase());
const _sec = (v) => { if (v == null || v === '') return null; const t = new Date(v).getTime(); return Number.isFinite(t) ? Math.floor(t / 1000) : null; };
const _truthy = (v) => v === true || v === 'true';
const _det = (s) => (s && s.match_detail && typeof s.match_detail === 'object' ? s.match_detail : {});
const _human = (s) => !!s && s.match_status !== 'rejected' && (s.match_status === 'confirmed' || !!(s.auto_filled && s.done_at && s.auto_ack_at));

/**
 * 1. forduló — a felismerés erőssége, 0–100 % (a szavazatoktól FÜGGETLENÜL, azok a 2. forduló).
 *  - jóváhagyott (iroda vagy a sofőr a „pótolt gomb" ablakban): 100
 *  - biztos (auto): pontszám (60%) + előny a 2. jelölthöz (40%)
 *  - javaslat / kézi ellenőrzésre váró: legfeljebb 80; bukott újraellenőrzés: 0
 */
function confidencePct(s) {
  if (!s) return 0;
  const st = s.match_status;
  const det = _det(s);
  if (s.auto_filled && s.done_at && s.auto_ack_at && st !== 'rejected') return 100;
  if (!s.gps_arrived_at && !s.gps_left_at) return 0;
  if (st === 'confirmed') return 100;
  if (st !== 'auto' && st !== 'suggested') return 0;
  if (det.verify_fail) return 0;
  const score = Math.max(0, Number(s.match_score) || 0);
  const margin = det.margin == null ? AUTO_MARGIN * 2 : Math.max(0, Number(det.margin) || 0);
  let pct = 60 * Math.min(1, score / SCORE_FULL) + 40 * Math.min(1, margin / (AUTO_MARGIN * 2));
  if (st === 'suggested' || _truthy(s.needs_manual)) pct = Math.min(pct, 80);
  return Math.round(pct);
}

/** Az állomás valós ideje (EGY időpont, mint a nyomtatványon: a fel-/lerakás vége, különben az érkezés). */
function stopTime(s) {
  if (!s) return null;
  if (s.auto_filled && s.done_at) return s.done_at;
  return s.gps_left_at || s.gps_arrived_at || null;
}

/** 2. forduló: a független keresések ugyanoda tették-e az állást. */
function votesAgree(s) {
  if (!s) return false;
  if (_human(s)) return true;                                   // ember jóváhagyta = független megerősítés
  const det = _det(s);
  if ((Number(det.votes) || 0) >= 2) return true;
  const f = _sec(s.gps_arrived_at), t = _sec(s.gps_left_at) || f;
  if (f == null) return false;
  // a korábbi körök ablakai (az utolsó a mostani kör — azt kihagyjuk)
  const hist = Array.isArray(det.vote_hist) ? det.vote_hist.slice(0, -1) : [];
  return hist.some((h) => {
    const hf = h && _sec(h.from), ht = h && _sec(h.to);
    return hf != null && ht != null && hf < t + VOTE_SLACK_SEC && ht > f - VOTE_SLACK_SEC;
  });
}

/** 3. forduló: a nyers GPS-pontsor szerint a kamion ott állt és ugyanakkor indult el. */
function trackAgrees(s, track, coord) {
  const ts = _sec(stopTime(s));
  if (ts == null || !Array.isArray(track) || !track.length) return false;
  const c = (s && s.actual_lat != null && s.actual_lng != null && Number.isFinite(+s.actual_lat) && Number.isFinite(+s.actual_lng))
    ? { lat: +s.actual_lat, lng: +s.actual_lng } : coord;
  if (!c) return false;
  const leave = !!(s.gps_left_at || (s.auto_filled && s.done_at));
  const tol = TOLERANCE_MIN * 60;
  return trackVisits(track, c.lat, c.lng, ts - 12 * 3600, ts + 12 * 3600)
    .some((v) => Math.abs((leave ? v.to : v.from) - ts) <= tol);
}

/** A 3 forduló eredménye egy állomásra. */
function rounds(s, track, coord) {
  const conf = confidencePct(s);
  const r = { conf, r1: conf >= MIN_CONFIDENCE, r2: votesAgree(s), r3: trackAgrees(s, track, coord) };
  r.passed = [r.r1, r.r2, r.r3].filter(Boolean).length;
  r.ok = r.r1 && r.passed >= 2;
  return r;
}

function _minutesApart(d1, t1, d2, t2) {
  const a = Date.parse(d1 + 'T' + t1 + ':00Z'), b = Date.parse(d2 + 'T' + t2 + ':00Z');
  return Number.isFinite(a) && Number.isFinite(b) ? Math.abs(a - b) / 60000 : Infinity;
}

/** A pont állomása (stopId, régi pontnál fuvar + szerep, csak egyértelmű esetben). */
function _stopOf(p, all, byId) {
  if (p.stopId != null && p.stopId !== '') return byId.get(String(p.stopId)) || null;
  if (p.orderId && KIND[p.role]) {
    const m = all.filter((x) => String(x.order_id) === String(p.orderId) && x.kind === KIND[p.role]);
    if (m.length === 1) return m[0];
  }
  return null;
}

/**
 * Tiszta függvény: a pontok átírása a 3 fordulós ellenőrzés szerint.
 * @param {Array} puncte  a menetlevél pontjai
 * @param {Array} stops   a menetlevél fuvarjainak állomásai (order_stops sorok)
 * @param {Array} [track] a vontató GPS-pontsora [[t, lat, lng, …], …] időrendben
 * @returns {{puncte:Array, changes:Array, skipped:Array}}
 */
function planTimeFix(puncte, stops, track) {
  const list = Array.isArray(puncte) ? puncte : [];
  const all = Array.isArray(stops) ? stops : [];
  const byId = new Map(all.map((s) => [String(s.id), s]));
  const changes = [], skipped = [];
  const out = list.map((p, i) => {
    if (!p || typeof p !== 'object') return p;
    if (_tip(p, /^(plecare|sosire)/)) return p;          // a sofőr saját indulása / érkezése
    const s = _stopOf(p, all, byId);
    if (!s) return p;
    if (p.time_source === 'manual') return p;            // az iroda kézi átírása végleges
    if (p.time_source === 'gps' && p.time_gps && _hhmm(p.time) + ' ' + _isoDate(p.data) !== p.time_gps) return p;
    const g = roDateTime(stopTime(s));
    if (!g) return p;
    const curD = _isoDate(p.data), curT = _hhmm(p.time);
    if (curD && curT && _minutesApart(curD, curT, g.date, g.time) <= TOLERANCE_MIN) return p;   // a sofőr ideje jó
    const r = rounds(s, track, coordsOf(p.loc));
    if (!r.ok) { skipped.push({ i, stopId: s.id, conf: r.conf, r1: r.r1, r2: r.r2, r3: r.r3 }); return p; }
    const q = { ...p };
    if (q.time_source !== 'gps') { q.time_driver = curT; q.data_driver = curD || String(p.data || ''); }
    q.data = g.date; q.time = g.time;
    q.time_source = 'gps'; q.time_gps = g.time + ' ' + g.date; q.time_conf = r.conf;
    changes.push({ i, stopId: s.id, from: (curD + ' ' + curT).trim(), to: g.date + ' ' + g.time, conf: r.conf, rounds: r.passed });
    return q;
  });
  return { puncte: out, changes, skipped };
}

// Egy ellenőrzés „lefoglalása": csak akkor fut, ha még nem volt 2, és a második
// csak 24 órával az első után. Egyetlen UPDATE → a beküldés utáni és az ütemező
// futása sem futhat kétszer ugyanarra.
const CLAIM_SQL = `
  UPDATE fuvarlevelek SET time_check_count = time_check_count + 1, time_check_at = NOW()
   WHERE id = $1 AND company_id = $2 AND time_check_count < ${MAX_CHECKS}
     AND (time_check_count = 0 OR time_check_at <= NOW() - INTERVAL '${RECHECK_HOURS} hours')
   RETURNING id, puncte, numar_camion, time_check_count, time_check`;

/** Egy menetlevél ellenőrzése + (ha kell) javítása. null, ha most nem esedékes. */
async function checkWaybill(pool, cid, id) {
  const c = await pool.query(CLAIM_SQL, [id, cid]);
  if (!c.rows.length) return null;
  const f = c.rows[0];
  const n = Number(f.time_check_count) || 1;
  const puncte = Array.isArray(f.puncte) ? f.puncte : [];
  const ids = [...new Set(puncte.map((p) => (p && p.stopId != null ? String(p.stopId) : '')).filter((x) => /^\d+$/.test(x)))];
  const oids = [...new Set(puncte.filter((p) => p && p.orderId).map((p) => String(p.orderId)))];
  let plan = { puncte, changes: [], skipped: [] };
  if (ids.length || oids.length) {
    const sR = await pool.query(
      `SELECT id, order_id, kind, gps_arrived_at, gps_left_at, done_at, match_status, match_score, match_detail,
              actual_lat, actual_lng,
              (to_jsonb(order_stops) ->> 'auto_filled') AS auto_filled,
              (to_jsonb(order_stops) ->> 'auto_ack_at') AS auto_ack_at,
              (to_jsonb(order_stops) ->> 'needs_manual') AS needs_manual
         FROM order_stops WHERE company_id = $1 AND (id = ANY($2::bigint[]) OR order_id::text = ANY($3::text[]))`, [cid, ids, oids]);
    // a 3. fordulóhoz: a vontató pontsora az állomások napjai köré
    let track = [];
    const days = [...new Set(sR.rows.map((s) => { const t = stopTime(s); const d = t && new Date(t); return d && !isNaN(d) ? d.toISOString().slice(0, 10) : ''; }).filter(Boolean))];
    if (f.numar_camion && days.length) {
      try { track = await loadTrack(pool, cid, f.numar_camion, days); } catch (_) { track = []; }
    }
    plan = planTimeFix(puncte, sR.rows, track);
  }
  const prev = f.time_check && typeof f.time_check === 'object' && Array.isArray(f.time_check.checks) ? f.time_check.checks : [];
  const log = { v: 2, checks: prev.concat([{ n, at: new Date().toISOString(), fixed: plan.changes.length, changes: plan.changes, skipped: plan.skipped }]).slice(-MAX_CHECKS) };
  if (plan.changes.length) {
    // az idő változott → a pontok GPS km-óra állását is újra kell számolni
    await pool.query(
      `UPDATE fuvarlevelek SET puncte = $3::jsonb, time_check = $4::jsonb, route_odo_at = NULL WHERE id = $1 AND company_id = $2`,
      [id, cid, JSON.stringify(plan.puncte), JSON.stringify(log)]);
    await audit.record({ company_id: cid, user_email: 'system', action: 'waybill.gps_time_fix', entity_type: 'fuvarlevel',
      entity_id: id, detail: { check: n, changes: plan.changes } });
  } else {
    await pool.query('UPDATE fuvarlevelek SET time_check = $3::jsonb WHERE id = $1 AND company_id = $2', [id, cid, JSON.stringify(log)]);
  }
  return { check: n, fixed: plan.changes.length, changes: plan.changes, skipped: plan.skipped };
}

// Sorba: a még egyszer sem ellenőrzött menetlevelek (visszamenőleg is), és a
// 24 órája egyszer ellenőrzöttek. Kétszeri ellenőrzés után soha többé.
async function pickQueue(pool, limit) {
  const r = await pool.query(
    `SELECT id, company_id FROM fuvarlevelek
      WHERE company_id IS NOT NULL AND jsonb_typeof(COALESCE(puncte,'[]'::jsonb)) = 'array'
        AND time_check_count < ${MAX_CHECKS}
        AND (time_check_count = 0 OR time_check_at <= NOW() - INTERVAL '${RECHECK_HOURS} hours')
      ORDER BY time_check_count ASC, id DESC
      LIMIT $1`, [limit]);
  return r.rows;
}

module.exports = { MIN_CONFIDENCE, TOLERANCE_MIN, MAX_CHECKS, RECHECK_HOURS, confidencePct, stopTime, votesAgree, trackAgrees, rounds, planTimeFix, checkWaybill, pickQueue };
