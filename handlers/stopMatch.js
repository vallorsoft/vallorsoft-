// ============================================================
//  handlers/stopMatch.js — Tényleges fel-/lerakási címek a GPS-ből
//    stopMatchList     — állomások tervezett vs. GPS szerinti tényleges helye
//    stopMatchDecide   — elfogadás / elvetés / másik jelölt / kézi cím
//    stopMatchRerun    — egy fuvar újrafuttatása (háttérben, nem várjuk meg)
//    stopMatchBackfill — visszamenőleges futtatás egy időszakra (sorba állítás)
//    stopMatchApplyBulk — az időszak elfogadott címei a menetlevelekre
//    stopMatchSettingsGet / stopMatchSettingsSave — automatikus rátétel + küszöb
//    stopMatchTrack    — a jármű útvonala + megállói egy napra (térképes kiválasztáshoz)
//    stopMatchNearby   — a kijelölt pont körüli cégek + utcák neve (OSM)
//    stopMatchProbe    — CargoTrack-eszköz nyers mezőinek felmérése
//                        (tahográf / tengelysúly / ajtó jel van-e)
//  CSAK Admin/Manager (a sofőr sehol nem kapja meg), company_id-szűrt,
//  paraméteres SQL, audit minden íráson. Funkció-kapcsoló: stop-address.
// ============================================================
const pool = require('../db');
const audit = require('../lib/audit');
const { featureEnabled } = require('../lib/featureEnabled');
const { decrypt } = require('../lib/crypto');
const runner = require('../lib/stopMatchRunner');
const wb = require('../lib/stopWaybill');
const gt = require('../lib/gpsTrack');
const nearbyPlaces = require('../lib/nearbyPlaces');

const handlers = {};
const _am = (u) => u && ['Admin', 'Manager'].includes(u.pozicio);
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const STATUSES = ['auto', 'suggested', 'unmatched', 'confirmed', 'rejected'];
const _running = new Map();   // orderId -> Promise (háttér-újrafuttatás)

async function _gate(req, res) {
  const u = req.session && req.session.user;
  if (!_am(u)) { res.json({ result: { ok: false, err: 'Acces interzis' } }); return null; }
  const cid = u.company_id;
  if (!(await featureEnabled(cid, 'gps-integracio')) || !(await featureEnabled(cid, 'stop-address'))) {
    res.json({ result: { ok: false, err: 'Funcția nu este disponibilă în abonamentul firmei.' } }); return null;
  }
  return u;
}

handlers.stopMatchList = async function (req, res, args) {
  try {
    const u = await _gate(req, res); if (!u) return;
    const a = (args && args[0]) || {};
    const cid = u.company_id;
    const to = isDay(a.to) ? a.to : new Date().toISOString().slice(0, 10);
    const from = isDay(a.from) ? a.from : new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const params = [cid, from, to];
    let where = '';
    if (STATUSES.includes(a.status)) { params.push(a.status); where += ` AND s.match_status = $${params.length}`; }
    else if (a.status === 'pending') where += ` AND s.match_status IN ('auto','suggested')`;
    else if (a.status === 'none') where += ` AND s.match_status IS NULL`;
    const q = String(a.q || '').trim().slice(0, 80);
    if (q) {
      params.push('%' + q + '%');
      where += ` AND (o.fuvar_no ILIKE $${params.length} OR o.id ILIKE $${params.length} OR o.client ILIKE $${params.length}
                 OR s.loc ILIKE $${params.length} OR s.firma ILIKE $${params.length} OR o.rendszam_camion ILIKE $${params.length}
                 OR s.actual_address ILIKE $${params.length})`;
    }
    const { rows } = await pool.query(
      `SELECT s.id, s.order_id, s.kind, s.seq_index, s.stop_index, s.loc, s.firma, s.data::text AS data,
              s.arrived_at, s.done_at, s.actual_lat, s.actual_lng, s.actual_address, s.actual_city, s.actual_country,
              s.gps_arrived_at, s.gps_left_at, s.match_score, s.match_source, s.match_status, s.match_detail,
              s.matched_at, s.match_decided_by, s.waybill_apply, s.waybill_applied_at,
              (SELECT COUNT(*)::int FROM fuvarlevelek f WHERE f.company_id = s.company_id
                  AND f.order_ids @> jsonb_build_array(s.order_id)) AS wb_count,
              o.fuvar_no, o.client, o.rendszam_camion, o.status AS order_status, o.nume_sofer
         FROM order_stops s
         JOIN orders o ON o.id = s.order_id AND o.company_id = s.company_id
        WHERE s.company_id = $1
          AND COALESCE(s.data, o.data_incarcare, o.created_at::date) BETWEEN $2::date AND $3::date
          ${where}
        ORDER BY COALESCE(s.data, o.data_incarcare, o.created_at::date) DESC, s.order_id, COALESCE(s.seq_index, 999999), s.stop_index
        LIMIT 400`, params);
    const cnt = await pool.query(
      `SELECT COALESCE(s.match_status,'none') AS st, COUNT(*)::int AS n
         FROM order_stops s JOIN orders o ON o.id = s.order_id AND o.company_id = s.company_id
        WHERE s.company_id = $1 AND COALESCE(s.data, o.data_incarcare, o.created_at::date) BETWEEN $2::date AND $3::date
        GROUP BY 1`, [cid, from, to]);
    let queue = 0;
    try { queue = (await pool.query('SELECT COUNT(*)::int AS n FROM stop_match_state WHERE company_id=$1 AND requeued=true', [cid])).rows[0].n; } catch (_) {}
    const counts = {};
    for (const r of cnt.rows) counts[r.st] = r.n;
    const settings = await wb.getSettings(cid);
    return res.json({ result: { ok: true, from, to, rows, counts, queue, settings } });
  } catch (err) {
    console.error('stopMatchList hiba:', err.message);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// Tanulás egy döntésből (best-effort): jel-súlyok + elvetett hely + a többi nyitott fuvar
// újraszámolása. Az elfogadott hely a helymemóriába a learnPlace-szel kerül (külön).
async function _learn(cid, cur, kind, picked) {
  try {
    const det = cur.match_detail || {};
    const curSig = Array.isArray(det.signals) ? det.signals : [];
    const near = (a, b) => a && b && a.lat != null && b.lat != null
      && Math.abs(a.lat - b.lat) < 0.002 && Math.abs(a.lng - b.lng) < 0.003;
    const curPos = cur.actual_lat != null ? { lat: cur.actual_lat, lng: cur.actual_lng } : null;
    if (kind === 'accept') {
      await runner.recordFeedback(cid, curSig, true);
    } else if (kind === 'reject') {
      await runner.recordFeedback(cid, curSig, false);
      if (curPos) await runner.recordBadPlace(cid, curPos.lat, curPos.lng, cur.firma);
    } else if (kind === 'pick' && picked) {
      if (curPos && !near(curPos, picked)) {
        await runner.recordFeedback(cid, curSig, false);
        await runner.recordBadPlace(cid, curPos.lat, curPos.lng, cur.firma);
      }
      await runner.recordFeedback(cid, picked.signals || [], true);
    }
    await runner.requeueOpen(cid, cur.order_id);
  } catch (e) { console.warn('[StopMatch] tanulás hiba', e.message); }
}

function _bgRerun(cid, oid) {
  if (_running.has(oid)) return;
  const p = Promise.resolve().then(() => runner.matchOrder(cid, oid))
    .catch((e) => console.warn('[StopMatch] újrafuttatás hiba', oid, e.message))
    .finally(() => _running.delete(oid));
  _running.set(oid, p);
}

handlers.stopMatchDecide = async function (req, res, args) {
  try {
    const u = await _gate(req, res); if (!u) return;
    const a = (args && args[0]) || {};
    const cid = u.company_id;
    const id = parseInt(a.stop_id, 10);
    if (!id) return res.json({ result: { ok: false, err: 'Punct invalid' } });
    const cur = (await pool.query(
      `SELECT id, order_id, kind, loc, firma, actual_lat, actual_lng, actual_address, actual_city, match_status, match_detail, waybill_apply
         FROM order_stops WHERE id=$1 AND company_id=$2`, [id, cid])).rows[0];
    if (!cur) return res.json({ result: { ok: false, err: 'Punctul nu a fost găsit' } });
    const by = String(u.email || '').slice(0, 255);
    const action = a.action;
    if (action === 'reject') {
      await pool.query(`UPDATE order_stops SET match_status='rejected', match_decided_by=$3 WHERE id=$1 AND company_id=$2`, [id, cid, by]);
      await _learn(cid, cur, 'reject');
      _bgRerun(cid, cur.order_id);   // további jelöltek az elvetett hely nélkül (háttérben)
    } else if (action === 'confirm') {
      if (cur.actual_lat == null && !cur.actual_address) return res.json({ result: { ok: false, err: 'Nu există adresă de confirmat' } });
      await pool.query(`UPDATE order_stops SET match_status='confirmed', match_decided_by=$3 WHERE id=$1 AND company_id=$2`, [id, cid, by]);
      try { await runner.learnPlace(cid, cur); } catch (e) { console.warn('[StopMatch] tanulás hiba', e.message); }
      if (cur.match_status !== 'confirmed') await _learn(cid, cur, 'accept');
    } else if (action === 'pick') {
      const cands = (cur.match_detail && Array.isArray(cur.match_detail.candidates)) ? cur.match_detail.candidates : [];
      const c = cands[parseInt(a.cand_idx, 10)];
      if (!c || !isFinite(c.lat) || !isFinite(c.lng)) return res.json({ result: { ok: false, err: 'Candidat invalid' } });
      let place = null;
      try { place = c.address ? null : await runner.reversePlace(c.lat, c.lng); } catch (_) {}
      const addr = c.address || (place && place.address) || null;
      const city = c.city || (place && place.city) || null;
      await pool.query(
        `UPDATE order_stops SET actual_lat=$3, actual_lng=$4, actual_address=$5, actual_city=$6, gps_arrived_at=$7, gps_left_at=$8,
                match_score=$9, match_source='manual', match_status='confirmed', match_decided_by=$10
          WHERE id=$1 AND company_id=$2`,
        [id, cid, c.lat, c.lng, addr, city, c.from || null, c.to || null, c.score != null ? Math.round(c.score) : null, by]);
      try { await runner.learnPlace(cid, { ...cur, actual_lat: c.lat, actual_lng: c.lng, actual_address: addr, actual_city: city }); } catch (_) {}
      await _learn(cid, cur, 'pick', c);
    } else if (action === 'map') {
      // térképen kiválasztott pont (a jármű útvonaláról vagy bárhonnan)
      const lat = Number(a.lat), lng = Number(a.lng);
      if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 85 || Math.abs(lng) > 180) return res.json({ result: { ok: false, err: 'Coordonate invalide' } });
      const ts = (v) => { const t = Date.parse(v); return isFinite(t) ? new Date(t).toISOString() : null; };
      let place = null;
      try { place = await runner.reversePlace(lat, lng); } catch (_) {}
      let addr = (place && place.address) || (lat.toFixed(5) + ', ' + lng.toFixed(5));
      // ha a reverse-geokód nem ad cégnevet: a térképen már lekért közeli cégek közül a legközelebbi (csak cache-ből)
      if (!(place && place.name)) {
        try {
          const nm = nearbyPlaces.closestName(await nearbyPlaces.nearby(lat, lng, { cacheOnly: true }), 50);
          if (nm && addr.indexOf(nm) < 0) addr = nm + ', ' + addr;
        } catch (_) {}
      }
      await pool.query(
        `UPDATE order_stops SET actual_lat=$3, actual_lng=$4, actual_address=$5, actual_city=$6, actual_country=$7,
                gps_arrived_at=$8, gps_left_at=$9, match_score=NULL, match_source='map', match_status='confirmed', match_decided_by=$10
          WHERE id=$1 AND company_id=$2`,
        [id, cid, lat, lng, addr.slice(0, 500), place ? (place.city || place.municipality || null) : null, place ? place.country : null,
          a.from ? ts(a.from) : null, a.to ? ts(a.to) : null, by]);
      try { await runner.learnPlace(cid, { ...cur, actual_lat: lat, actual_lng: lng, actual_address: addr }); } catch (_) {}
      if (cur.match_status !== 'rejected') await _learn(cid, cur, 'pick', { lat, lng, signals: [] });
      else { try { await runner.requeueOpen(cid, cur.order_id); } catch (_) {} }
    } else if (action === 'edit') {
      const addr = String(a.address || '').trim().slice(0, 500);
      if (addr.length < 3) return res.json({ result: { ok: false, err: 'Adresa este prea scurtă' } });
      await pool.query(
        `UPDATE order_stops SET actual_address=$3, match_source='manual', match_status='confirmed', match_decided_by=$4
          WHERE id=$1 AND company_id=$2`, [id, cid, addr, by]);
      if (cur.actual_lat != null) { try { await runner.learnPlace(cid, { ...cur, actual_address: addr }); } catch (_) {} }
    } else if (action === 'apply') {
      if (!cur.actual_address) return res.json({ result: { ok: false, err: 'Nu există adresă de aplicat' } });
      // a rátétel egyben elfogadás is
      if (cur.match_status !== 'confirmed') {
        await pool.query(`UPDATE order_stops SET match_status='confirmed', match_decided_by=$3 WHERE id=$1 AND company_id=$2`, [id, cid, by]);
        try { await runner.learnPlace(cid, cur); } catch (_) {}
        await _learn(cid, cur, 'accept');
      }
      const x = await wb.applyStop(cid, id);
      audit.fromReq(req, 'order.stop_address.apply', 'order', cur.order_id, { stop_id: id, points: x.points });
      return res.json({ result: { ok: true, waybills: x.waybills || 0, points: x.points || 0, total_waybills: x.total_waybills || 0 } });
    } else if (action === 'unapply') {
      const x = await wb.applyStop(cid, id, { revert: true });
      audit.fromReq(req, 'order.stop_address.unapply', 'order', cur.order_id, { stop_id: id, points: x.points });
      return res.json({ result: { ok: true, points: x.points || 0 } });
    } else {
      return res.json({ result: { ok: false, err: 'Acțiune invalidă' } });
    }
    // ha a cím már rá volt téve a menetlevélre, a javított cím is oda kerül (elvetésnél vissza)
    if (cur.waybill_apply) {
      try { await wb.applyStop(cid, id, { revert: action === 'reject' }); } catch (e) { console.warn('[StopMatch] újra-rátétel hiba', e.message); }
    }
    audit.fromReq(req, 'order.stop_address.' + action, 'order', cur.order_id, { stop_id: id });
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('stopMatchDecide hiba:', err.message);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

handlers.stopMatchRerun = async function (req, res, args) {
  try {
    const u = await _gate(req, res); if (!u) return;
    const a = (args && args[0]) || {};
    const cid = u.company_id;
    const oid = String(a.order_id || '').slice(0, 20);
    const o = (await pool.query('SELECT id FROM orders WHERE id=$1 AND company_id=$2', [oid, cid])).rows[0];
    if (!o) return res.json({ result: { ok: false, err: 'Transportul nu a fost găsit' } });
    if (!_running.has(oid)) {
      // háttérben — a válasz azonnal megy (felhasználói kérésben nem várunk külső hívásokra)
      const p = runner.matchOrder(cid, oid)
        .catch((e) => console.warn('[StopMatch] újrafuttatás hiba', oid, e.message))
        .finally(() => _running.delete(oid));
      _running.set(oid, p);
    }
    audit.fromReq(req, 'order.stop_address.rerun', 'order', oid, null);
    return res.json({ result: { ok: true, running: true } });
  } catch (err) {
    console.error('stopMatchRerun hiba:', err.message);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

handlers.stopMatchBackfill = async function (req, res, args) {
  try {
    const u = await _gate(req, res); if (!u) return;
    const a = (args && args[0]) || {};
    const cid = u.company_id;
    if (!isDay(a.from) || !isDay(a.to) || a.from > a.to) return res.json({ result: { ok: false, err: 'Perioadă invalidă' } });
    const span = (Date.parse(a.to) - Date.parse(a.from)) / 86400000;
    if (span > 400) return res.json({ result: { ok: false, err: 'Perioada maximă este de 400 de zile' } });
    const r = await pool.query(
      `INSERT INTO stop_match_state (order_id, company_id, status, attempts, requeued)
       SELECT o.id, o.company_id, 'queued', 0, true FROM orders o
        WHERE o.company_id=$1 AND o.status IN ('In Curs','Finalizat','Parkolt','Raktarban')
          AND COALESCE(o.rendszam_camion,'') <> ''
          AND COALESCE(o.data_incarcare, o.finalized_at::date, o.created_at::date) BETWEEN $2::date AND $3::date
       ON CONFLICT (order_id) DO UPDATE SET requeued=true, attempts=0`, [cid, a.from, a.to]);
    audit.fromReq(req, 'order.stop_address.backfill', 'company', String(cid), { from: a.from, to: a.to, n: r.rowCount });
    return res.json({ result: { ok: true, queued: r.rowCount } });
  } catch (err) {
    console.error('stopMatchBackfill hiba:', err.message);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

handlers.stopMatchApplyBulk = async function (req, res, args) {
  try {
    const u = await _gate(req, res); if (!u) return;
    const a = (args && args[0]) || {};
    const cid = u.company_id;
    if (!isDay(a.from) || !isDay(a.to) || a.from > a.to) return res.json({ result: { ok: false, err: 'Perioadă invalidă' } });
    const { rows } = await pool.query(
      `SELECT s.id FROM order_stops s JOIN orders o ON o.id = s.order_id AND o.company_id = s.company_id
        WHERE s.company_id=$1 AND s.match_status='confirmed' AND s.actual_address IS NOT NULL
          AND COALESCE(s.data, o.data_incarcare, o.created_at::date) BETWEEN $2::date AND $3::date
        LIMIT 500`, [cid, a.from, a.to]);
    let points = 0, waybills = 0;
    for (const r of rows) {
      const x = await wb.applyStop(cid, r.id);
      if (x.ok) { points += x.points; waybills += x.waybills; }
    }
    audit.fromReq(req, 'order.stop_address.apply_bulk', 'company', String(cid), { from: a.from, to: a.to, stops: rows.length, points });
    return res.json({ result: { ok: true, stops: rows.length, points, waybills } });
  } catch (err) {
    console.error('stopMatchApplyBulk hiba:', err.message);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

handlers.stopMatchSettingsGet = async function (req, res) {
  try {
    const u = await _gate(req, res); if (!u) return;
    return res.json({ result: { ok: true, settings: await wb.getSettings(u.company_id) } });
  } catch (err) {
    console.error('stopMatchSettingsGet hiba:', err.message);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

handlers.stopMatchSettingsSave = async function (req, res, args) {
  try {
    const u = await _gate(req, res); if (!u) return;
    if (u.pozicio !== 'Admin') return res.json({ result: { ok: false, err: 'Doar administratorul poate modifica această setare' } });
    const a = (args && args[0]) || {};
    const st = await wb.saveSettings(u.company_id, { auto_apply: a.auto_apply === true, min_score: a.min_score }, u.email);
    audit.fromReq(req, 'order.stop_address.settings', 'company', String(u.company_id), st);
    // bekapcsoláskor a már felismert, küszöb feletti címek is rákerülnek (háttérben)
    if (st.auto_apply) {
      pool.query(
        `UPDATE order_stops SET waybill_apply = true
          WHERE company_id=$1 AND waybill_apply = false AND actual_address IS NOT NULL
            AND match_status IN ('auto','suggested','confirmed') AND match_score >= $2`, [u.company_id, st.min_score])
        .catch((e) => console.warn('[StopMatch] auto-rátétel jelölés hiba', e.message));
    }
    return res.json({ result: { ok: true, settings: st } });
  } catch (err) {
    console.error('stopMatchSettingsSave hiba:', err.message);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

const _isoDay = (v) => {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : gt.localDay(v.getTime());
  const s = String(v); return /^\d{4}-\d{2}-\d{2}$/.test(s.slice(0, 10)) ? s.slice(0, 10) : null;
};
const _pgDate = (v) => (v instanceof Date && !isNaN(v.getTime()))
  ? v.getFullYear() + '-' + String(v.getMonth() + 1).padStart(2, '0') + '-' + String(v.getDate()).padStart(2, '0')
  : _isoDay(v);

// A térképen kijelölt pont körüli cégek + utcák neve (OSM / Overpass, szerveren cache-elve)
handlers.stopMatchNearby = async function (req, res, args) {
  try {
    const u = await _gate(req, res); if (!u) return;
    const a = (args && args[0]) || {};
    const lat = Number(a.lat), lng = Number(a.lng);
    if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return res.json({ result: { ok: false, err: 'Coordonate invalide' } });
    }
    const r = await nearbyPlaces.nearby(lat, lng, { radius: a.radius });
    return res.json({ result: { ok: true, available: r.ok !== false, places: r.places || [], streets: r.streets || [] } });
  } catch (err) {
    console.error('stopMatchNearby hiba:', err.message);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

handlers.stopMatchTrack = async function (req, res, args) {
  try {
    const u = await _gate(req, res); if (!u) return;
    const a = (args && args[0]) || {};
    const cid = u.company_id;
    const id = parseInt(a.stop_id, 10);
    const st = (await pool.query(
      `SELECT s.id, s.kind, s.loc, s.firma, s.data, s.done_at, s.arrived_at, s.actual_lat, s.actual_lng, s.match_status, s.match_detail,
              s.actual_address, s.gps_arrived_at, s.gps_left_at,
              o.rendszam_camion, o.data_incarcare, o.data_descarcare, o.fuvar_no, o.id AS order_id
         FROM order_stops s JOIN orders o ON o.id = s.order_id AND o.company_id = s.company_id
        WHERE s.id=$1 AND s.company_id=$2`, [id, cid])).rows[0];
    if (!st) return res.json({ result: { ok: false, err: 'Punctul nu a fost găsit' } });
    const plate = String(st.rendszam_camion || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!plate) return res.json({ result: { ok: false, err: 'Cursa nu are camion asociat' } });
    const today = gt.localDay(Date.now());
    const center = _pgDate(st.data) || _isoDay(st.done_at) || _isoDay(st.arrived_at)
      || _pgDate(st.kind === 'pickup' ? st.data_incarcare : st.data_descarcare) || today;
    const lo = gt.addDays(center, -3), hi = gt.addDays(center, 4) > today ? today : gt.addDays(center, 4);
    const { rows: dayRows } = await pool.query(
      `SELECT day::text AS day, point_count FROM gps_track_days
        WHERE company_id=$1 AND UPPER(REGEXP_REPLACE(rendszam,'[^A-Za-z0-9]','','g'))=$2 AND day BETWEEN $3::date AND $4::date AND point_count > 0
        ORDER BY day`, [cid, plate, lo, hi]);
    const days = dayRows.map((r) => r.day);
    let day = /^\d{4}-\d{2}-\d{2}$/.test(String(a.day || '')) && a.day >= lo && a.day <= hi ? a.day : null;
    // a kiválasztott pont / jelölt napja (ha kérték), különben a tervezett nap
    if (!day) {
      const atDay = _isoDay(a.at) || (a.focus_actual ? _isoDay(st.gps_arrived_at) : null);
      if (atDay && atDay >= lo && atDay <= hi) day = atDay;
    }
    if (!day) day = days.includes(center) ? center : (days.find((d) => d >= center) || days[days.length - 1] || center);
    const row = (await pool.query(
      `SELECT points_json, segments FROM gps_track_days
        WHERE company_id=$1 AND UPPER(REGEXP_REPLACE(rendszam,'[^A-Za-z0-9]','','g'))=$2 AND day=$3::date`, [cid, plate, day])).rows[0];
    let pts = [];
    try { pts = row ? JSON.parse(row.points_json || '[]') : []; } catch (_) { pts = []; }
    let lines = (row && Array.isArray(row.segments)) ? row.segments.filter((x) => x && x.p).map((x) => ({ p: x.p, k: x.k || 'm' })) : [];
    if (!lines.length && pts.length > 1) {
      // még nincs útra illesztve: a nyers pontsor ritkítva
      const thin = [pts[0]];
      for (let i = 1; i < pts.length; i++) if (gt.distM(thin[thin.length - 1], pts[i]) >= 40) thin.push(pts[i]);
      lines = [{ p: gt.encodePolyline(thin.map((x) => [x[1], x[2]])), k: 'r' }];
    }
    const stops = pts.length > 1 ? gt.detectStops(pts, pts[pts.length - 1][0]).map((x) => ({
      lat: x.lat, lng: x.lng, from: new Date(x.from * 1000).toISOString(), to: new Date(x.to * 1000).toISOString(),
      min: Math.round((x.to - x.from) / 60),
    })) : [];
    const det = st.match_detail || {};
    return res.json({ result: {
      ok: true, plate: st.rendszam_camion, fuvar_no: st.fuvar_no || st.order_id, day, days, center,
      planned: { kind: st.kind, loc: st.loc, firma: st.firma, data: _pgDate(st.data) },
      actual: st.actual_lat != null ? { lat: st.actual_lat, lng: st.actual_lng, rejected: st.match_status === 'rejected',
        address: st.actual_address || null, status: st.match_status || null,
        from: st.gps_arrived_at ? new Date(st.gps_arrived_at).toISOString() : null,
        to: st.gps_left_at ? new Date(st.gps_left_at).toISOString() : null } : null,
      candidates: Array.isArray(det.candidates) ? det.candidates.map((c) => ({ lat: c.lat, lng: c.lng, from: c.from, to: c.to, score: c.score, address: c.address })) : [],
      lines, stops } });
  } catch (err) {
    console.error('stopMatchTrack hiba:', err.message);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// A CargoTrack-eszközök milyen extra mezőt küldenek (tahográf, tengelysúly, ajtó…)
const INTERESTING = /(tacho|driver|work|activity|axle|weight|load|cargo|door|trailer|pto|temp|reefer|ebs|card)/i;
handlers.stopMatchProbe = async function (req, res) {
  try {
    const u = await _gate(req, res); if (!u) return;
    const cid = u.company_id;
    const integ = (await pool.query(
      `SELECT credentials_enc FROM company_integrations WHERE company_id=$1 AND provider='cargotrack' AND enabled=true`, [cid])).rows[0];
    if (!integ || !integ.credentials_enc) return res.json({ result: { ok: false, err: 'Integrarea CargoTrack nu este configurată' } });
    const apiKey = decrypt(integ.credentials_enc);
    const ct = require('../services/cargotrack');
    const { rows: maps } = await pool.query(
      `SELECT rendszam, object_id FROM vehicle_gps_map WHERE company_id=$1 AND provider='cargotrack' AND object_id IS NOT NULL LIMIT 5`, [cid]);
    const out = [];
    const now = Date.now();
    for (const m of maps) {
      try {
        const r = await ct.getCoordinates(apiKey, m.object_id, new Date(now - 12 * 3600000).toISOString(), new Date(now).toISOString());
        const it = (r.items || [])[r.items.length - 1];
        if (!it) { out.push({ rendszam: m.rendszam, found: false }); continue; }
        const calc = (it.inputs && it.inputs.calculated_inputs) || it.calculated_inputs || {};
        const raw = (it.inputs && it.inputs.raw_inputs) || it.raw_inputs || {};
        const keys = [...Object.keys(calc).map((k) => 'calc.' + k), ...Object.keys(raw).map((k) => 'raw.' + k)];
        const sample = {};
        for (const k of keys) {
          if (!INTERESTING.test(k)) continue;
          const src = k.startsWith('calc.') ? calc : raw;
          const v = src[k.slice(5)];
          sample[k] = v && typeof v === 'object' ? (v.value != null ? v.value : JSON.stringify(v).slice(0, 60)) : v;
        }
        out.push({ rendszam: m.rendszam, found: true, keys: keys.slice(0, 200), interesting: sample });
      } catch (e) { out.push({ rendszam: m.rendszam, found: false, err: String(e.message || '').slice(0, 120) }); }
    }
    return res.json({ result: { ok: true, vehicles: out } });
  } catch (err) {
    console.error('stopMatchProbe hiba:', err.message);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

module.exports = handlers;
