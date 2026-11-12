// ============================================================
//  VallorSoft — lib/stopAutoEvents.js
//  Elfelejtett állomás-gomb pótlása a GPS-ből.
//
//  Ha a cím-felismerés (lib/stopMatchRunner) egy állomásnál BIZTOS
//  (match_status='auto'), megerősített, vagy JAVASOLT, de ott valódi megállás volt, a kamion már elhagyta a helyet, de a sofőr nem
//  nyomta meg az „odaértem / felraktam / leürítettem" gombot, a rendszer
//  a GPS-állás elejét (arrived_at) és végét (done_at) beírja helyette.
//  A sofőr következő belépéskor sorban látja ezeket (handlers/stopAutoEvents),
//  és leokézza vagy javítja (idő / térkép).
//
//  Szabályok:
//   - időrendben tölt: egy állomás GPS-állása nem lehet az előző kész állomás
//     előtt; a fel nem ismert állomás nyitva marad (a sofőr nyomja meg), de
//     a többi felismert állomást nem akasztja meg;
//   - a sofőr gombnyomása sosem íródik felül (COALESCE), és a későbbi
//     állomáson megnyomott gomb felső korlát az előző állomás idejére;
//   - csak ha a GPS-ben a távozás UTÁN is van mozgás (a kamion tényleg
//     elment), és legalább 15 perce történt;
//   - csak belső sofőrös fuvaron (email_sofer), Alocat / In Curs / Finalizat
//     státuszban; a cég kikapcsolhatja (stop_match_settings.auto_events).
//  Minden lekérdezés company_id-szűrt, paraméteres.
// ============================================================
const pool = require('../db');
const gt = require('./gpsTrack');

const LEFT_AFTER_LAST_PT_SEC = 10 * 60;   // a távozás után még ennyi GPS-mozgás kell
const LEFT_MIN_AGE_MS = 15 * 60 * 1000;   // a távozás legalább ennyi ideje történt
const ORDER_SLACK_SEC = 5 * 60;           // sorrend-tűrés (GPS / gombnyomás óraeltérés)
const ALLOWED_ORDER_STATUS = ['Alocat', 'In Curs', 'Finalizat'];

const _sec = (v) => {
  if (v == null || v === '') return null;
  const t = v instanceof Date ? v.getTime() : Date.parse(v);
  return isFinite(t) ? Math.floor(t / 1000) : null;
};
const _iso = (sec) => new Date(sec * 1000).toISOString();
// tervezett nap (DATE / szöveg) → 'YYYY-MM-DD'
const _day = (v) => {
  if (v == null || v === '') return null;
  if (v instanceof Date) return isFinite(v.getTime()) ? gt.localDay(v.getTime()) : null;
  const m = String(v).match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
};
const _n = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
// azonos hely (cím + cég); hely-adat nélkül nem tekintjük azonosnak
const sameSite = (a, b) => (a.loc != null || a.firma != null) && _n(a.loc) === _n(b.loc) && _n(a.firma) === _n(b.firma) && !!(_n(a.loc) || _n(a.firma));

// Mely felismert állomás tölthető ki a sofőr helyett: a biztos (auto) és az iroda által
// megerősített, valamint a JAVASOLT is, ha a kamion ott valóban megállt (nem puszta
// áthaladás) — ezt a sofőr a következő belépéskor jóváhagyja, az irodának külön nem kell.
const FILL_MIN_SUGGEST = 30;
function fillable(s) {
  if (s.match_status === 'auto' || s.match_status === 'confirmed') return true;
  if (s.match_status !== 'suggested') return false;
  if (s.match_score != null && Number(s.match_score) < FILL_MIN_SUGGEST) return false;
  const sig = s.match_detail && Array.isArray(s.match_detail.signals) ? s.match_detail.signals : [];
  return !sig.some((x) => Array.isArray(x) && x[0] === 'pass_city');
}

// A cím-felismerés 3 független ellenőrzéséből hány adta ugyanazt az állást (match_detail.votes).
// Régi / szavazat nélküli sor: nem akasztjuk meg (a következő körben megkapja).
const MIN_VOTES = 2;
function checksAgree(s) {
  const v = s && s.match_detail ? s.match_detail.votes : undefined;
  return typeof v !== 'number' || v >= MIN_VOTES;
}

// ── Végellenőrzés: a fuvar összes állomása együtt ──
// A rendszer által beírt (még nem jóváhagyott, nem megerősített) állomásokat jelöli meg, ha
//  - a fuvar sorrendjében egy korábbi állomás később lett kész (időrend),
//  - egy korábbi azonos helyű állomás még nyitva van,
//  - ismétlődő helyen a kész-idő a tervezett nap előtti,
//  - a beírt idő eltér attól a GPS-állástól, amiből beírtuk.
// A sofőr saját gombnyomását és a jóváhagyott / megerősített állomást sosem jelöli.
const VERIFY_SLACK_SEC = 10 * 60;
function verifyChain(stops, opts) {
  opts = opts || {};
  const bad = [];
  if (!Array.isArray(stops)) return bad;
  const isAuto = (s) => !!s.auto_filled && (opts.includeAcked || !s.auto_ack_at) && s.match_status !== 'confirmed';
  const flag = (s, reason) => { if (isAuto(s) && !bad.some((b) => b.id === s.id)) bad.push({ id: s.id, reason }); };
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i];
    const d = _sec(s.done_at);
    if (d == null) continue;
    for (let j = 0; j < i; j++) {
      const p = stops[j];
      const pd = _sec(p.done_at);
      if (pd == null) { if (sameSite(p, s)) flag(s, 'same_site_open'); continue; }
      if (pd > d + VERIFY_SLACK_SEC) { if (isAuto(s)) flag(s, 'order_time'); else flag(p, 'order_time'); }
    }
    const planDay = _day(s.data);
    if (planDay && stops.slice(0, i).some((p) => sameSite(p, s)) && gt.localDay(d * 1000) < planDay) flag(s, 'before_plan_day');
    if (s.auto_filled && !s.auto_ack_action) {
      const gl = _sec(s.gps_left_at), ga = _sec(s.gps_arrived_at), a = _sec(s.arrived_at);
      if (gl != null && Math.abs(d - gl) > VERIFY_SLACK_SEC && !(a != null && s.auto_filled === 'done' && d >= gl)) flag(s, 'gps_mismatch');
      if (s.auto_filled === 'both' && ga != null && a != null && Math.abs(a - ga) > VERIFY_SLACK_SEC) flag(s, 'gps_mismatch');
    }
  }
  return bad;
}

// A hibás beírás visszavonása: az állomás újra nyitott, az ok az irodának megmarad, a fuvar újra sorba kerül.
async function revertFills(cid, orderId, bad) {
  if (!bad || !bad.length) return 0;
  let n = 0;
  for (const b of bad) {
    const r = await pool.query(
      `UPDATE order_stops SET done_at = NULL,
              arrived_at = CASE WHEN auto_filled = 'both' THEN NULL ELSE arrived_at END,
              auto_filled = NULL, auto_filled_at = NULL, auto_ack_at = NULL, auto_ack_action = NULL,
              match_detail = COALESCE(match_detail,'{}'::jsonb)
                || jsonb_build_object('auto_skip', jsonb_build_object('reason', $3::text, 'at', NOW()))
                || jsonb_build_object('verify_fail', jsonb_build_object('from', gps_arrived_at, 'to', gps_left_at, 'reason', $3::text)),
              updated_at = NOW()
        WHERE id=$1 AND company_id=$2 AND auto_filled IS NOT NULL AND COALESCE(match_status,'') <> 'confirmed'`,
      [b.id, cid, 'verify_' + String(b.reason).slice(0, 30)]);
    n += r.rowCount;
  }
  if (n) {
    try {
      await pool.query(
        `UPDATE orders SET status='In Curs', updated_at=NOW()
          WHERE id=$1 AND company_id=$2 AND status='Finalizat'
            AND EXISTS (SELECT 1 FROM order_stops WHERE order_id=$1 AND company_id=$2 AND done_at IS NULL)`, [orderId, cid]);
    } catch (_) {}
    try { await pool.query('UPDATE stop_match_state SET requeued=true, attempts=0 WHERE order_id=$1', [orderId]); } catch (_) {}
  }
  return n;
}

const STOPS_SQL = `SELECT id, kind, stop_index, loc, firma, data::text AS data, arrived_at, done_at, match_status, match_score, match_detail,
         gps_arrived_at, gps_left_at, auto_filled, auto_ack_at, auto_ack_action
    FROM order_stops WHERE order_id=$1 AND company_id=$2
   ORDER BY COALESCE(seq_index, 999999), (kind='pickup') DESC, stop_index`;

// Tiszta döntés (tesztelhető): mely állomásokat töltsük ki és mivel.
// stops: sorrend szerint ({id, kind, arrived_at, done_at, match_status, gps_arrived_at, gps_left_at})
// Visszatér: [{ id, kind, arrive: ISO|null, done: ISO, filled: 'both'|'done' }]
//   + nem felsorolható `skips`: [{ id, reason }] — miért NEM töltöttük ki (az irodának kiírva).
// Egy nem tölthető (pl. fel nem ismert) állomás NEM akasztja meg a későbbieket: az nyitva
// marad (a sofőr megnyomhatja), a többi felismert állomást beírjuk, a sofőr jóváhagyja.
function planAutoFill(stops, lastPtSec, nowMs) {
  const out = [], skips = [];
  Object.defineProperty(out, 'skips', { value: skips, enumerable: false });
  if (!Array.isArray(stops) || !stops.length || lastPtSec == null) return out;
  const nowSec = Math.floor((nowMs || Date.now()) / 1000);
  // az előző (kész) állomás ideje: a sofőr gombja, de ha későn nyomta meg, a GPS szerinti távozás
  let prevDone = null;
  const ref = (done, gl) => (gl != null && gl < done ? gl : done);
  let stopRest = null;
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i];
    const done = _sec(s.done_at);
    const ga = _sec(s.gps_arrived_at), gl = _sec(s.gps_left_at);
    if (done != null) { prevDone = ref(done, gl); continue; }
    if (stopRest) { skips.push({ id: s.id, reason: stopRest }); continue; }
    const arr = _sec(s.arrived_at);
    if (!fillable(s)) { skips.push({ id: s.id, reason: 'not_sure' }); continue; }
    // 3 független ellenőrzésből legalább 2-nek ugyanazt kell adnia (különben a következő körben újra ellenőrizzük)
    if (s.match_status !== 'confirmed' && !checksAgree(s)) { skips.push({ id: s.id, reason: 'checks_disagree' }); continue; }
    // egy korábbi, még nyitott állomás ugyanezen a helyen van → az állás azé lehet, ezt nem töltjük
    if (stops.slice(0, i).some((p) => !_sec(p.done_at) && !out.some((o) => o.id === p.id) && sameSite(p, s))) {
      skips.push({ id: s.id, reason: 'same_site_open' }); continue;
    }
    if (ga == null || gl == null || gl <= ga) { skips.push({ id: s.id, reason: 'no_gps_time' }); continue; }
    // ugyanezt az állást a végellenőrzés már elvetette → ne írjuk be újra (új GPS-állással igen)
    const vf = s.match_detail && s.match_detail.verify_fail;
    if (vf && _sec(vf.from) != null && _sec(vf.to) != null && ga < _sec(vf.to) + ORDER_SLACK_SEC && gl > _sec(vf.from) - ORDER_SLACK_SEC) {
      skips.push({ id: s.id, reason: vf.reason || 'verify_failed' }); continue;
    }
    // ismétlődő hely (pl. az 5. = a 7. állomás, csak holnap): a tervezett napja ELŐTTI állás nem lehet az övé —
    // az a korábbi azonos helyű állomás látogatása (vagy ottalvás), nem a holnapi rakodás
    const planDay = _day(s.data);
    if (planDay && stops.slice(0, i).some((p) => sameSite(p, s)) && gt.localDay(gl * 1000) < planDay) {
      skips.push({ id: s.id, reason: 'before_plan_day' }); continue;
    }
    // még ott áll / túl friss → a későbbi állomások sem lehetnek készen
    if (gl + LEFT_AFTER_LAST_PT_SEC > lastPtSec) { skips.push({ id: s.id, reason: 'still_there' }); stopRest = 'wait_prev'; continue; }
    if (gl * 1000 > nowSec * 1000 - LEFT_MIN_AGE_MS) { skips.push({ id: s.id, reason: 'too_recent' }); stopRest = 'wait_prev'; continue; }
    if (prevDone != null && ga < prevDone - ORDER_SLACK_SEC) { skips.push({ id: s.id, reason: 'before_prev' }); continue; }
    // egy KÉSŐBBI állomás sofőr-gombnyomása felső korlát
    let nextPress = null;
    for (let k = i + 1; k < stops.length; k++) {
      for (const v of [_sec(stops[k].arrived_at), _sec(stops[k].done_at)]) {
        if (v != null && (nextPress == null || v < nextPress)) nextPress = v;
      }
    }
    if (nextPress != null && gl > nextPress + ORDER_SLACK_SEC) { skips.push({ id: s.id, reason: 'after_next_press' }); continue; }
    if (arr != null) {
      // a sofőr az érkezést megnyomta, a végét nem → csak a végét pótoljuk
      // (ha az érkezést a GPS szerinti távozás után nyomta, a kész legalább az érkezés ideje)
      const d = Math.max(gl, arr + 60);
      out.push({ id: s.id, kind: s.kind, arrive: null, done: _iso(d), filled: 'done' });
      prevDone = d;
    } else {
      out.push({ id: s.id, kind: s.kind, arrive: _iso(ga), done: _iso(gl), filled: 'both' });
      prevDone = gl;
    }
  }
  return out;
}

// Pont-sorból a megadott hely körüli leghosszabb összefüggő állás (térképes javítás).
// pts: [[t(sec), lat, lng, ...]], időrendben. Rövid kilengést (≤ 3 pont) eltűr.
function dwellNear(pts, lat, lng, radiusM) {
  const R = radiusM || 400;
  if (!Array.isArray(pts) || !pts.length || !isFinite(lat) || !isFinite(lng)) return null;
  const c = [0, Number(lat), Number(lng)];
  let best = null, cur = null, miss = 0;
  const close = () => {
    if (cur && (!best || (cur.to - cur.from) > (best.to - best.from))) best = cur;
    cur = null; miss = 0;
  };
  for (const p of pts) {
    if (!Array.isArray(p) || p.length < 3) continue;
    const inside = gt.distM(c, p) <= R;
    if (inside) {
      if (!cur) cur = { from: p[0], to: p[0], la: [], ln: [] };
      cur.to = p[0]; cur.la.push(p[1]); cur.ln.push(p[2]); miss = 0;
    } else if (cur) {
      if (++miss > 3) close();
    }
  }
  close();
  if (!best || best.to - best.from < 60) return null;
  const med = (a) => { const b = a.slice().sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
  return { from: best.from, to: best.to, lat: med(best.la), lng: med(best.ln) };
}

// match_detail.auto_skip = { reason, at } a ki nem töltött nyitott állomásokon; a kitöltöttekről törli.
async function _markSkips(cid, skips, filledIds) {
  try {
    for (const k of skips) {
      await pool.query(
        `UPDATE order_stops SET match_detail = COALESCE(match_detail,'{}'::jsonb) || jsonb_build_object('auto_skip', jsonb_build_object('reason', $3::text, 'at', NOW()))
          WHERE id=$1 AND company_id=$2 AND done_at IS NULL`, [k.id, cid, String(k.reason).slice(0, 40)]);
    }
    if (filledIds.length) {
      await pool.query(`UPDATE order_stops SET match_detail = match_detail - 'auto_skip'
                         WHERE id = ANY($1::bigint[]) AND company_id=$2 AND match_detail ? 'auto_skip'`, [filledIds, cid]);
    }
  } catch (_) { /* best-effort */ }
}
// fuvar-szintű ok (nincs belső sofőr / státusz / kikapcsolva) a nyitott állomásokra
async function _markOrderSkip(cid, orderId, reason) {
  try {
    await pool.query(
      `UPDATE order_stops SET match_detail = COALESCE(match_detail,'{}'::jsonb) || jsonb_build_object('auto_skip', jsonb_build_object('reason', $3::text, 'at', NOW()))
        WHERE order_id=$1 AND company_id=$2 AND done_at IS NULL AND actual_lat IS NOT NULL`, [orderId, cid, reason]);
  } catch (_) {}
}

// ── Egy fuvar állomásainak pótlása (a stopMatchRunner hívja a mentés után) ──
async function applyAutoEvents(cid, orderId, opts) {
  opts = opts || {};
  const o = (await pool.query(
    `SELECT id, status, client, fuvar_no, email_sofer, nume_sofer FROM orders WHERE id=$1 AND company_id=$2`,
    [orderId, cid])).rows[0];
  if (!o) return { filled: 0 };
  if (!String(o.email_sofer || '').trim()) { await _markOrderSkip(cid, orderId, 'no_driver'); return { filled: 0 }; }
  if (!ALLOWED_ORDER_STATUS.includes(o.status)) { await _markOrderSkip(cid, orderId, 'order_status'); return { filled: 0 }; }
  let enabled = true;
  try {
    const r = await pool.query('SELECT auto_events FROM stop_match_settings WHERE company_id=$1', [cid]);
    if (r.rows.length && r.rows[0].auto_events === false) enabled = false;
  } catch (_) {}
  if (!enabled) { await _markOrderSkip(cid, orderId, 'disabled'); return { filled: 0 }; }
  const stops = (await pool.query(STOPS_SQL, [orderId, cid])).rows;
  const plan = planAutoFill(stops, opts.lastPtSec, opts.now);
  // az irodának: miért nem írtuk be (a Fel- és lerakóhelyek GPS-ből oldalon látszik)
  await _markSkips(cid, plan.skips || [], plan.map((p) => p.id));
  let filled = 0, anyPickupArrive = false;
  for (const p of plan) {
    const r = await pool.query(
      `UPDATE order_stops SET arrived_at = COALESCE(arrived_at, $3::timestamptz), done_at = $4::timestamptz,
              auto_filled = $5, auto_filled_at = NOW(), auto_ack_at = NULL, auto_ack_action = NULL, auto_orig = NULL,
              updated_at = NOW()
        WHERE id=$1 AND company_id=$2 AND done_at IS NULL`,
      [p.id, cid, p.arrive, p.done, p.filled]);
    if (r.rowCount) { filled++; if (p.kind === 'pickup' && p.arrive) anyPickupArrive = true; }
  }
  if (!filled) return { filled: 0 };
  // végellenőrzés: az egész fuvar újra, a beírás után — ami nem áll össze, visszavonjuk
  let reverted = 0;
  try {
    const after = (await pool.query(STOPS_SQL, [orderId, cid])).rows;
    const bad = verifyChain(after);
    if (bad.length) {
      reverted = await revertFills(cid, orderId, bad);
      filled = Math.max(0, filled - bad.filter((b) => plan.some((p) => p.id === b.id)).length);
    }
  } catch (e) { console.warn('[StopAuto] végellenőrzés hiba', orderId, e.message); }
  if (!filled) return { filled: 0, reverted };

  // Státusz-léptetés, mint a gombnyomásnál (routes/ordersRest.js _applyStopEvent)
  let newStatus = null;
  // a rendszer csak akkor zárja le a fuvart, ha MINDEN állomás kész (egy nyitott felrakó mellett — pl. a holnapi
  // ismétlődő felrakás — a lerakók beírása nem fejezi be a fuvart; azt a sofőr zárja le a gombbal)
  const open = await pool.query(
    `SELECT 1 FROM order_stops WHERE order_id=$1 AND company_id=$2 AND done_at IS NULL LIMIT 1`, [orderId, cid]);
  const hasDelivery = stops.some((s) => s.kind === 'delivery');
  if (hasDelivery && open.rowCount === 0 && ['Alocat', 'In Curs'].includes(o.status)) newStatus = 'Finalizat';
  else if (anyPickupArrive && o.status === 'Alocat') newStatus = 'In Curs';
  if (newStatus) {
    await pool.query(`UPDATE orders SET status=$3, updated_at=NOW() WHERE id=$1 AND company_id=$2 AND status=$4`,
      [orderId, cid, newStatus, o.status]);
  }
  try {
    const { sendPushToRole } = require('../services/push');
    await sendPushToRole(cid, ['Manager', 'Admin'], {
      title: '🤖 Marcaj automat din GPS',
      body: (o.nume_sofer || o.email_sofer) + ' — ' + (o.fuvar_no || o.client || ('#' + orderId)) + ' · ' + filled + ' etapă(e)',
      icon: '/icon192.png', badge: '/icon192.png', tag: 'order-auto-stop-' + orderId, url: '/manager',
    });
  } catch (_) { /* best-effort */ }
  return { filled, status: newStatus };
}

// GPS pontok egy rendszámra egy napi ablakban (térképes javításhoz)
async function loadPoints(cid, plate, fromDay, toDay) {
  const norm = String(plate || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!norm) return [];
  const { rows } = await pool.query(
    `SELECT points_json FROM gps_track_days
      WHERE company_id=$1 AND UPPER(REGEXP_REPLACE(COALESCE(rendszam,''),'[^A-Za-z0-9]','','g'))=$2
        AND day BETWEEN $3::date AND $4::date ORDER BY day`, [cid, norm, fromDay, toDay]);
  let pts = [];
  for (const r of rows) {
    try { const p = JSON.parse(r.points_json || '[]'); if (Array.isArray(p)) pts = pts.concat(p); } catch (_) {}
  }
  pts.sort((a, b) => a[0] - b[0]);
  return pts;
}

module.exports = { verifyChain, revertFills, checksAgree, MIN_VOTES, STOPS_SQL, planAutoFill, fillable, FILL_MIN_SUGGEST, dwellNear, applyAutoEvents, loadPoints,
  LEFT_AFTER_LAST_PT_SEC, LEFT_MIN_AGE_MS, ORDER_SLACK_SEC };
