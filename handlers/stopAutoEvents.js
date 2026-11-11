// ============================================================
//  handlers/stopAutoEvents.js — A rendszer által (GPS-ből) pótolt
//  állomás-gombok átnézése a SOFŐR felületén.
//    getMyAutoStopEvents  — a még át nem nézett automatikus rögzítések (sorrendben)
//    ackAutoStopEvents    — „Rendben" (egy vagy több)
//    correctAutoStopTime  — idő-alapú javítás (érkezés / kész)
//    getAutoStopMap       — térkép az átnézéshez: a felismert pont + a többi állás + a nap útvonala
//    correctAutoStopMap   — térképes javítás: a kijelölt helyen talált GPS-állás ideje lesz az új idő
//  A sofőr jóváhagyása / javítása a helyet is MEGERŐSÍTI (confirmed) — az irodának külön nem kell.
//  CSAK Sofőr, csak a SAJÁT fuvarja (LOWER(email_sofer)), company_id-szűrt,
//  paraméteres SQL, audit minden íráson. A tényleges (reverse-geokódolt) cím
//  szövege a sofőrhöz NEM kerül — a térképen csak a pont látszik.
// ============================================================
const pool = require('../db');
const audit = require('../lib/audit');
const gt = require('../lib/gpsTrack');
const autoEv = require('../lib/stopAutoEvents');

const handlers = {};
const MAX_BACK_MS = 45 * 24 * 3600 * 1000;
const MAX_FUTURE_MS = 2 * 60 * 1000;
const MAX_TRACK_PTS = 1500;

const MOVED_M = 250;   // ennyinél messzebbi térképes javítás = a felismert hely rossz volt

const _isSofer = (u) => u && u.pozicio === 'Sofer';

// A sofőr döntéséből tanulunk (best-effort, a választ nem rontja el)
async function _learn(cid, items) {
  const runner = require('../lib/stopMatchRunner');
  for (const it of items || []) {
    try {
      if (Array.isArray(it.signals) && it.signals.length) await runner.recordFeedback(cid, it.signals, it.ok === true);
      if (it.bad) await runner.recordBadPlace(cid, it.bad.lat, it.bad.lng, it.bad.firma);
    } catch (e) { console.warn('[StopAuto] tanulás hiba', e.message); }
  }
}
const _err = (res, err) => res.json({ result: { ok: false, err } });

function _parseTs(v) {
  if (v == null || v === '') return null;
  const t = Date.parse(String(v));
  if (!isFinite(t)) return undefined;
  const now = Date.now();
  if (t > now + MAX_FUTURE_MS || t < now - MAX_BACK_MS) return undefined;
  return new Date(t).toISOString();
}

// A sofőr saját, még át nem nézett automatikus állomása
async function _ownStop(u, id) {
  const n = parseInt(id, 10);
  if (!isFinite(n) || n <= 0) return null;
  const { rows } = await pool.query(
    `SELECT s.id, s.order_id, s.kind, s.stop_index, s.arrived_at, s.done_at, s.auto_filled, s.auto_ack_at,
            s.actual_lat, s.actual_lng, s.gps_arrived_at, s.gps_left_at, s.match_detail, s.waybill_apply, s.loc, s.firma,
            o.rendszam_camion, o.client, o.fuvar_no
       FROM order_stops s
       JOIN orders o ON o.id = s.order_id AND o.company_id = s.company_id
      WHERE s.id = $1 AND s.company_id = $2 AND LOWER(o.email_sofer) = LOWER($3)
        AND s.auto_filled IS NOT NULL AND s.auto_ack_at IS NULL`, [n, u.company_id, u.email]);
  return rows[0] || null;
}

// A sofőr jóváhagyása / javítása = megerősített hely (az irodának külön nem kell):
// match_status='confirmed', helymemória, menetlevél-cím. Best-effort.
async function _confirmByDriver(u, stopId) {
  try {
    const r = await pool.query(
      `UPDATE order_stops SET match_status='confirmed', match_decided_by=$3, needs_manual=false
        WHERE id=$1 AND company_id=$2 AND actual_lat IS NOT NULL AND COALESCE(match_status,'') <> 'rejected'
        RETURNING id, order_id, kind, loc, firma, actual_lat, actual_lng, actual_address, actual_city`,
      [stopId, u.company_id, String(u.email || '').slice(0, 255)]);
    const st = r.rows[0];
    if (!st) return;
    const runner = require('../lib/stopMatchRunner');
    try { await runner.learnPlace(u.company_id, st); } catch (_) {}
    try { await require('../lib/stopWaybill').applyStop(u.company_id, st.id); } catch (e) { console.warn('[StopAuto] menetlevél-rátétel hiba', st.id, e.message); }
  } catch (e) { console.warn('[StopAuto] sofőr-megerősítés hiba', stopId, e.message); }
}

function _notifyOffice(u, stop, what) {
  try {
    const { sendPushToRole } = require('../services/push');
    sendPushToRole(u.company_id, ['Manager', 'Admin'], {
      title: '✏️ Marcaj automat corectat de șofer (' + what + ')',
      body: (u.nume || u.email) + ' — ' + (stop.fuvar_no || stop.client || ('#' + stop.order_id)),
      icon: '/icon192.png', badge: '/icon192.png', tag: 'order-auto-fix-' + stop.id, url: '/manager',
    }).catch(() => {});
  } catch (_) {}
}

handlers.getMyAutoStopEvents = async function (req, res) {
  try {
    const u = req.session && req.session.user;
    if (!_isSofer(u)) return _err(res, 'Acces interzis');
    let rows = [];
    try {
      rows = (await pool.query(
        `SELECT s.id, s.order_id, s.kind, s.stop_index, s.seq_index, s.loc, s.firma, s.data::text AS data,
                s.arrived_at, s.done_at, s.auto_filled, s.auto_filled_at,
                (s.actual_lat IS NOT NULL) AS has_gps, o.fuvar_no, o.rendszam_camion
           FROM order_stops s
           JOIN orders o ON o.id = s.order_id AND o.company_id = s.company_id
          WHERE s.company_id = $1 AND LOWER(o.email_sofer) = LOWER($2)
            AND s.auto_filled IS NOT NULL AND s.auto_ack_at IS NULL AND o.status <> 'Anulat'
          ORDER BY COALESCE(s.arrived_at, s.done_at), s.order_id, COALESCE(s.seq_index, 999999), s.stop_index
          LIMIT 50`, [u.company_id, u.email])).rows;
    } catch (e) {
      if (e && (e.code === '42703' || e.code === '42P01')) rows = [];   // migráció még nem futott
      else throw e;
    }
    return res.json({ result: { ok: true, items: rows } });
  } catch (err) {
    console.error('getMyAutoStopEvents hiba:', err.message);
    return _err(res, 'Eroare de server');
  }
};

handlers.ackAutoStopEvents = async function (req, res, args) {
  try {
    const u = req.session && req.session.user;
    if (!_isSofer(u)) return _err(res, 'Acces interzis');
    const a = (args && args[0]) || {};
    const ids = (Array.isArray(a.ids) ? a.ids : [a.id]).map((x) => parseInt(x, 10)).filter((x) => isFinite(x) && x > 0).slice(0, 100);
    if (!ids.length) return _err(res, 'Parametri invalizi');
    const r = await pool.query(
      `UPDATE order_stops s SET auto_ack_at = NOW(), auto_ack_action = 'ok'
         FROM orders o
        WHERE s.id = ANY($1::bigint[]) AND s.company_id = $2 AND o.id = s.order_id AND o.company_id = s.company_id
          AND LOWER(o.email_sofer) = LOWER($3) AND s.auto_filled IS NOT NULL AND s.auto_ack_at IS NULL
        RETURNING s.id, s.match_detail`, [ids, u.company_id, u.email]);
    audit.fromReq(req, 'order.stop_auto.ack', 'order_stop', ids.join(',').slice(0, 200), { count: r.rowCount });
    // tanulás: a sofőr megerősítette a felismert helyet → a győztes jelek erősödnek
    await _learn(u.company_id, (r.rows || []).map((x) => ({ signals: x.match_detail && x.match_detail.signals, ok: true })));
    // a sofőr jóváhagyása a hely megerősítése is — az irodának külön nem kell
    for (const x of r.rows || []) await _confirmByDriver(u, x.id);
    return res.json({ result: { ok: true, acked: r.rowCount } });
  } catch (err) {
    console.error('ackAutoStopEvents hiba:', err.message);
    return _err(res, 'Eroare de server');
  }
};

handlers.correctAutoStopTime = async function (req, res, args) {
  try {
    const u = req.session && req.session.user;
    if (!_isSofer(u)) return _err(res, 'Acces interzis');
    const a = (args && args[0]) || {};
    const s = await _ownStop(u, a.id);
    if (!s) return _err(res, 'Etapa nu a fost găsită');
    const arr = s.auto_filled === 'both' ? _parseTs(a.arrived_at) : null;   // a sofőr saját érkezését nem írjuk át
    const done = _parseTs(a.done_at);
    if (arr === undefined || done === undefined || !done) return _err(res, 'Timp invalid');
    const arrEff = arr || (s.arrived_at ? new Date(s.arrived_at).toISOString() : null);
    if (arrEff && Date.parse(done) < Date.parse(arrEff)) return _err(res, 'Ora de terminare nu poate fi înainte de sosire');
    const orig = { arrived_at: s.arrived_at, done_at: s.done_at };
    await pool.query(
      `UPDATE order_stops SET arrived_at = COALESCE($3::timestamptz, arrived_at), done_at = $4::timestamptz,
              auto_ack_at = NOW(), auto_ack_action = 'time', auto_orig = $5::jsonb, updated_at = NOW()
        WHERE id = $1 AND company_id = $2 AND auto_ack_at IS NULL`,
      [s.id, u.company_id, arr, done, JSON.stringify(orig)]);
    audit.fromReq(req, 'order.stop_auto.correct_time', 'order_stop', String(s.id), { order: s.order_id, orig, arrived_at: arr, done_at: done });
    await _confirmByDriver(u, s.id);   // a hely ugyanaz, csak az idő változott
    _notifyOffice(u, s, 'oră');
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('correctAutoStopTime hiba:', err.message);
    return _err(res, 'Eroare de server');
  }
};

function _dayWindow(s) {
  const base = s.done_at || s.gps_left_at || s.arrived_at || new Date();
  const d = gt.localDay(new Date(base).getTime());
  return { from: gt.addDays(d, -1), to: gt.addDays(d, 1) };
}

handlers.getAutoStopMap = async function (req, res, args) {
  try {
    const u = req.session && req.session.user;
    if (!_isSofer(u)) return _err(res, 'Acces interzis');
    const a = (args && args[0]) || {};
    const s = await _ownStop(u, a.id);
    if (!s) return _err(res, 'Etapa nu a fost găsită');
    const w = _dayWindow(s);
    const pts = await autoEv.loadPoints(u.company_id, s.rendszam_camion, w.from, w.to);
    const step = Math.max(1, Math.ceil(pts.length / MAX_TRACK_PTS));
    const track = [];
    for (let i = 0; i < pts.length; i += step) track.push([pts[i][1], pts[i][2]]);
    // csak koordináta + idő — a cím szövege nem megy ki
    const cands = ((s.match_detail && s.match_detail.candidates) || [])
      .filter((c) => c && isFinite(c.lat) && isFinite(c.lng))
      .slice(0, 8).map((c) => ({ lat: c.lat, lng: c.lng, from: c.from || null, to: c.to || null }));
    return res.json({ result: { ok: true,
      point: s.actual_lat != null ? { lat: s.actual_lat, lng: s.actual_lng, from: s.gps_arrived_at, to: s.gps_left_at } : null,
      candidates: cands, track, kind: s.kind, auto_filled: s.auto_filled } });
  } catch (err) {
    console.error('getAutoStopMap hiba:', err.message);
    return _err(res, 'Eroare de server');
  }
};

handlers.correctAutoStopMap = async function (req, res, args) {
  try {
    const u = req.session && req.session.user;
    if (!_isSofer(u)) return _err(res, 'Acces interzis');
    const a = (args && args[0]) || {};
    const lat = Number(a.lat), lng = Number(a.lng);
    if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return _err(res, 'Parametri invalizi');
    const s = await _ownStop(u, a.id);
    if (!s) return _err(res, 'Etapa nu a fost găsită');
    const w = _dayWindow(s);
    const pts = await autoEv.loadPoints(u.company_id, s.rendszam_camion, w.from, w.to);
    const d = autoEv.dwellNear(pts, lat, lng, 400);
    if (!d) return _err(res, 'Nu am găsit o oprire a camionului în acel loc. Alege un punct mai aproape de traseu sau corectează ora.');
    const fromIso = new Date(d.from * 1000).toISOString(), toIso = new Date(d.to * 1000).toISOString();
    const arr = s.auto_filled === 'both' ? fromIso : null;
    if (!arr && s.arrived_at && Date.parse(toIso) < new Date(s.arrived_at).getTime()) {
      return _err(res, 'Oprirea aleasă este înainte de sosirea marcată de tine');
    }
    const orig = { arrived_at: s.arrived_at, done_at: s.done_at, lat: s.actual_lat, lng: s.actual_lng };
    const runner = require('../lib/stopMatchRunner');
    await pool.query(
      `UPDATE order_stops SET arrived_at = COALESCE($3::timestamptz, arrived_at), done_at = $4::timestamptz,
              actual_lat = $5, actual_lng = $6, actual_address = $7, gps_arrived_at = $8::timestamptz, gps_left_at = $4::timestamptz,
              match_status = 'confirmed', match_source = 'driver', match_decided_by = $10, needs_manual = false, matched_at = NOW(),
              auto_ack_at = NOW(), auto_ack_action = 'map', auto_orig = $9::jsonb, updated_at = NOW()
        WHERE id = $1 AND company_id = $2 AND auto_ack_at IS NULL`,
      [s.id, u.company_id, arr, toIso, d.lat, d.lng, runner.coordText(d.lat, d.lng), fromIso, JSON.stringify(orig), String(u.email || '').slice(0, 255)]);
    audit.fromReq(req, 'order.stop_auto.correct_map', 'order_stop', String(s.id), { order: s.order_id, orig, lat: d.lat, lng: d.lng, from: fromIso, to: toIso });
    // tanulás: ha a sofőr MÁSHOL jelölte meg (≥ 250 m), a felismert hely rossz volt → jel-súly le + elvetett hely
    if (s.actual_lat != null && gt.distM([0, s.actual_lat, s.actual_lng], [0, d.lat, d.lng]) >= MOVED_M) {
      await _learn(u.company_id, [{ signals: s.match_detail && s.match_detail.signals, ok: false,
        bad: { lat: s.actual_lat, lng: s.actual_lng, firma: s.firma } }]);
    }
    _notifyOffice(u, s, 'hartă');
    // háttérben: cím a kijelölt pontra (cache-elt, fojtott) + menetlevél frissítése, ha kérték — nem várjuk meg
    const cid = u.company_id;
    (async () => {
      const place = await runner.reversePlace(d.lat, d.lng);
      await pool.query(
        `UPDATE order_stops SET actual_address=$3, actual_city=$4, actual_country=$5
          WHERE id=$1 AND company_id=$2 AND match_source='driver'`,
        [s.id, cid, String(runner.formatAddress(place, d.lat, d.lng) || '').slice(0, 500),
          place ? (place.city || place.municipality || null) : null, place ? place.country : null]);
      try { await runner.learnPlace(cid, { ...s, actual_lat: d.lat, actual_lng: d.lng, actual_address: runner.formatAddress(place, d.lat, d.lng) }); } catch (_) {}
      await require('../lib/stopWaybill').applyStop(cid, s.id);
    })().catch((e) => console.warn('[StopAuto] térképes javítás utómunka hiba', s.id, e.message));
    return res.json({ result: { ok: true, arrived_at: arr, done_at: toIso } });
  } catch (err) {
    console.error('correctAutoStopMap hiba:', err.message);
    return _err(res, 'Eroare de server');
  }
};

module.exports = handlers;
