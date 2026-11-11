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
//   - csak sorrendben tölt: egy állomás csak akkor, ha az összes előtte lévő
//     már kész (vagy most kész lesz) — kihagyni nem lehet, mint a gombnál;
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

// Tiszta döntés (tesztelhető): mely állomásokat töltsük ki és mivel.
// stops: sorrend szerint ({id, kind, arrived_at, done_at, match_status, gps_arrived_at, gps_left_at})
// Visszatér: [{ id, kind, arrive: ISO|null, done: ISO, filled: 'both'|'done' }]
function planAutoFill(stops, lastPtSec, nowMs) {
  const out = [];
  if (!Array.isArray(stops) || !stops.length || lastPtSec == null) return out;
  const nowSec = Math.floor((nowMs || Date.now()) / 1000);
  let prevDone = null;
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i];
    const done = _sec(s.done_at);
    if (done != null) { prevDone = done; continue; }
    const arr = _sec(s.arrived_at);
    const ga = _sec(s.gps_arrived_at), gl = _sec(s.gps_left_at);
    if (!fillable(s) || ga == null || gl == null || gl <= ga) break;
    if (gl + LEFT_AFTER_LAST_PT_SEC > lastPtSec) break;          // még ott áll / nincs utána adat
    if (gl * 1000 > nowSec * 1000 - LEFT_MIN_AGE_MS) break;
    if (prevDone != null && ga < prevDone - ORDER_SLACK_SEC) break; // nem követi az előző állomást
    // egy KÉSŐBBI állomás sofőr-gombnyomása felső korlát
    let nextPress = null;
    for (let k = i + 1; k < stops.length; k++) {
      for (const v of [_sec(stops[k].arrived_at), _sec(stops[k].done_at)]) {
        if (v != null && (nextPress == null || v < nextPress)) nextPress = v;
      }
    }
    if (nextPress != null && gl > nextPress + ORDER_SLACK_SEC) break;
    if (arr != null) {
      // a sofőr az érkezést megnyomta, a végét nem → csak a végét pótoljuk
      if (arr > gl) break;
      out.push({ id: s.id, kind: s.kind, arrive: null, done: _iso(gl), filled: 'done' });
    } else {
      out.push({ id: s.id, kind: s.kind, arrive: _iso(ga), done: _iso(gl), filled: 'both' });
    }
    prevDone = gl;
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

// ── Egy fuvar állomásainak pótlása (a stopMatchRunner hívja a mentés után) ──
async function applyAutoEvents(cid, orderId, opts) {
  opts = opts || {};
  const o = (await pool.query(
    `SELECT id, status, client, fuvar_no, email_sofer, nume_sofer FROM orders WHERE id=$1 AND company_id=$2`,
    [orderId, cid])).rows[0];
  if (!o || !String(o.email_sofer || '').trim() || !ALLOWED_ORDER_STATUS.includes(o.status)) return { filled: 0 };
  let enabled = true;
  try {
    const r = await pool.query('SELECT auto_events FROM stop_match_settings WHERE company_id=$1', [cid]);
    if (r.rows.length && r.rows[0].auto_events === false) enabled = false;
  } catch (_) {}
  if (!enabled) return { filled: 0 };
  const stops = (await pool.query(
    `SELECT id, kind, stop_index, arrived_at, done_at, match_status, match_score, match_detail, gps_arrived_at, gps_left_at
       FROM order_stops WHERE order_id=$1 AND company_id=$2
      ORDER BY COALESCE(seq_index, 999999), (kind='pickup') DESC, stop_index`, [orderId, cid])).rows;
  const plan = planAutoFill(stops, opts.lastPtSec, opts.now);
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

  // Státusz-léptetés, mint a gombnyomásnál (routes/ordersRest.js _applyStopEvent)
  let newStatus = null;
  const open = await pool.query(
    `SELECT 1 FROM order_stops WHERE order_id=$1 AND company_id=$2 AND kind='delivery' AND done_at IS NULL LIMIT 1`, [orderId, cid]);
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

module.exports = { planAutoFill, fillable, FILL_MIN_SUGGEST, dwellNear, applyAutoEvents, loadPoints,
  LEFT_AFTER_LAST_PT_SEC, LEFT_MIN_AGE_MS, ORDER_SLACK_SEC };
