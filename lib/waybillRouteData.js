// ============================================================
//  VallorSoft — lib/waybillRouteData.js
//  Egy menetlevél útvonal-táblájának adatai (pontok + határátlépések,
//  pontos idővel és a GPS km-óra állásával). A nyomtatvány
//  (/api/pdf-download/:id) és a háttér-feltöltés (route_odo) ugyanezt
//  használja, hogy a kettő ne térjen el.
// ============================================================
const { buildRouteRows, fillTrackTimes, fillRowOdometer, applyDriverKm } = require('./waybillRows');
const { fetchTripCrossings, PLATE_SQL } = require('./tripCrossings');

/**
 * @param {object} pool  pg pool
 * @param {number} cid   cég
 * @param {object} f     fuvarlevelek sor
 * @returns {{routeRows:Array, crossings:Array, stopTimes:object, track:Array}}
 */
async function buildWaybillRoute(pool, cid, f) {
  // másolat: a koordináta-segédmezők (_lat/_lng) ne kerüljenek vissza a tárolt sorba
  const puncte = (Array.isArray(f.puncte) ? f.puncte : []).map((p) => (p && typeof p === 'object' ? { ...p } : p));
  // ── HATÁRÁTLÉPÉSEK a menetlevél időszakára ──
  // Élőben kérjük le (a GPS-ből utólag felismert / az iroda által javított
  // átlépés is rákerül); ha ez nem megy, a menetlevélen tárolt napló marad.
  let crossings = Array.isArray(f.hataratok) ? f.hataratok : [];
  if (f.email_sofer && f.indulas_dt && f.erkezes_dt) {
    try {
      const tc = await fetchTripCrossings(pool, f.email_sofer,
        new Date(f.indulas_dt).toISOString(), new Date(f.erkezes_dt).toISOString(),
        { companyId: cid, plate: f.numar_camion || null });
      crossings = tc.inWindow;
    } catch (_e) { /* marad a tárolt napló */ }
  }

  // Útvonal-sorok: a pontok + a határátlépések időrendben közéjük fésülve,
  // mindegyik dátummal ÉS pontos idővel.
  // A pontok valós ideje: a GPS-ből felismert érkezés / távozás (ha a hely el van fogadva vagy
  // javasolt), különben a sofőr gombnyomása. A biztos / jóváhagyott GPS-idő a beírt órát is felülírja.
  const stopTimes = {};
  const _ptList = puncte.filter((p) => p && typeof p === 'object');
  try {
    const ids = [...new Set(_ptList.map((p) => (p.stopId != null ? String(p.stopId) : '')).filter((x) => /^\d+$/.test(x)))];
    // régi pont: nincs állomás-id, csak fuvar + szerep
    const oids = [...new Set(_ptList.filter((p) => (p.stopId == null || p.stopId === '') && p.orderId && p.role).map((p) => String(p.orderId)))];
    if (ids.length || oids.length) {
      const sR = await pool.query(
        `SELECT id, order_id, kind, gps_arrived_at, gps_left_at, arrived_at, done_at, match_status,
                (to_jsonb(order_stops) ->> 'auto_filled') AS auto_filled,
                (to_jsonb(order_stops) ->> 'auto_ack_at') AS auto_ack_at,
                actual_lat, actual_lng
           FROM order_stops WHERE company_id = $1 AND (id = ANY($2::bigint[]) OR order_id::text = ANY($3::text[]))`, [cid, ids, oids]);
      const timeOf = (s) => {
        // a rendszer által (GPS-ből) beírt gomb: a sofőr ezt az időt látta / hagyta jóvá / javította —
        // a menetlevélre is ez kerül (nem egy esetleg később átszámolt GPS-állás)
        if (s.auto_filled && s.done_at) {
          return { from: s.arrived_at || s.done_at, to: s.arrived_at ? s.done_at : null, sure: !!s.auto_ack_at || s.match_status === 'auto' || s.match_status === 'confirmed' };
        }
        const gpsOk = s.gps_arrived_at && ['auto', 'confirmed', 'suggested'].includes(s.match_status);
        const from = gpsOk ? s.gps_arrived_at : (s.arrived_at || s.done_at);
        const to = gpsOk ? s.gps_left_at : (s.arrived_at ? s.done_at : null);
        return from ? { from, to: to || null, sure: !!(gpsOk && (s.match_status === 'auto' || s.match_status === 'confirmed')) } : null;
      };
      for (const s of sR.rows) { const t = timeOf(s); if (t) stopTimes[String(s.id)] = t; }
      // a GPS-ből felismert tényleges hely koordinátája: ha a pont címében nincs koordináta,
      // ebből keressük ki a GPS-útvonalon, mikor állt ott a kamion (régi menetlevelekre is)
      const byId = new Map(sR.rows.map((s) => [String(s.id), s]));
      _ptList.forEach((p) => {
        const s = p.stopId != null ? byId.get(String(p.stopId)) : null;
        if (s && s.actual_lat != null && s.actual_lng != null && Number.isFinite(+s.actual_lat) && Number.isFinite(+s.actual_lng)) {
          p._lat = +s.actual_lat; p._lng = +s.actual_lng;
        }
      });
      const KIND = { loading: 'pickup', unloading: 'delivery' };
      _ptList.forEach((p, i) => {
        if ((p.stopId != null && p.stopId !== '') || !p.orderId || !KIND[p.role]) return;
        const m = sR.rows.filter((s) => String(s.order_id) === String(p.orderId) && s.kind === KIND[p.role]);
        const t = m.length === 1 ? timeOf(m[0]) : null;       // csak egyértelmű esetben
        if (t) stopTimes['#' + i] = t;
      });
    }
  } catch (_e) { /* régi séma — marad a beírt idő */ }
  // A vontató GPS-pontsora az út idejére: (1) ami még idő nélkül maradt, de a címében ott a
  // koordináta, ebből keressük ki, mikor állt ott a kamion; (2) minden pont km-óra állása.
  let track = [];
  try {
    const days = _ptList.map((p) => String(p.data || '').slice(0, 10))
      .concat([f.indulas_dt, f.erkezes_dt].filter(Boolean).map((v) => { const d = new Date(v); return isNaN(d) ? '' : d.toISOString().slice(0, 10); }))
      .concat((crossings || []).map((c) => { const d = new Date(c && c.datetime); return isNaN(d) ? '' : d.toISOString().slice(0, 10); }))
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    if (f.numar_camion && days.length) {
      track = await loadTrack(pool, cid, f.numar_camion, days);
      if (track.length) fillTrackTimes(puncte, stopTimes, track);
    }
  } catch (_e) { /* nincs GPS-napló — marad idő / km-óra nélkül */ }
  const routeRows = buildRouteRows(puncte, crossings, stopTimes);
  if (track.length) fillRowOdometer(routeRows, track);
  // indulás / érkezés: a sofőr által beírt km-óra állás (felülírja a GPS-t)
  applyDriverKm(routeRows, f.km_inceput, f.km_sfarsit);
  return { routeRows, crossings, stopTimes, track };

}

/**
 * A vontató GPS-pontsora a megadott napok köré (−1 … +3 nap, max. 45 nap), időrendben.
 * @param {string[]} days 'YYYY-MM-DD' napok
 */
async function loadTrack(pool, cid, plate, days) {
  const ds = (days || []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  if (!plate || !ds.length) return [];
  const d0 = new Date(Date.parse(ds[0] + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
  let d1 = new Date(Date.parse(ds[ds.length - 1] + 'T00:00:00Z') + 3 * 86400000).toISOString().slice(0, 10);
  const cap = new Date(Date.parse(d0 + 'T00:00:00Z') + 45 * 86400000).toISOString().slice(0, 10);
  if (d1 > cap) d1 = cap;
  const tR = await pool.query(
    `SELECT points_json FROM gps_track_days
      WHERE company_id = $1 AND ${PLATE_SQL('rendszam')} = $2 AND day BETWEEN $3::date AND $4::date AND point_count > 0
      ORDER BY day`, [cid, String(plate).toUpperCase().replace(/[^A-Z0-9]/g, ''), d0, d1]);
  let track = [];
  for (const r of tR.rows) { try { const a = JSON.parse(r.points_json || '[]'); if (Array.isArray(a)) track = track.concat(a); } catch (_) {} }
  track.sort((a, b) => (Array.isArray(a) && Array.isArray(b) ? a[0] - b[0] : 0));
  return track;
}

/** Tárolásra: soronkénti km-óra ({key,km}) — pont: 'p<sorszám a pontok között>', határ: 'b<ISO>'. */
function odoSnapshot(routeRows) {
  let pi = 0;
  const rows = [];
  (routeRows || []).forEach((r) => {
    if (r.kind === 'border') rows.push({ key: 'b' + (r.ts || ''), km: r.km != null ? r.km : null });
    else rows.push({ key: 'p' + (pi++), km: r.km != null ? r.km : null });
  });
  return { v: 1, rows, found: rows.filter((x) => x.km != null).length };
}

module.exports = { buildWaybillRoute, odoSnapshot, loadTrack };

// ── Háttér-feltöltés (visszamenőleg is) ──────────────────────────────
// Sorba: minden vontatós menetlevél, amelyre még nem készült pillanatkép; illetve
// a friss (30 napon belüli) menetlevél, ha naponta újraszámolva még javulhat
// (a GPS-napok utólag is töltődnek) — a legújabbak elöl.
async function pickQueue(pool, limit) {
  const r = await pool.query(
    `SELECT id, company_id FROM fuvarlevelek
      WHERE company_id IS NOT NULL AND COALESCE(numar_camion,'') <> ''
        AND jsonb_typeof(COALESCE(puncte,'[]'::jsonb)) = 'array'
        AND ( route_odo_at IS NULL
              OR ( route_odo_at < NOW() - INTERVAL '1 day'
                   AND COALESCE(erkezes_dt, indulas_dt, data_completare) > NOW() - INTERVAL '30 days'
                   AND COALESCE((route_odo->>'found')::int, 0) < COALESCE(jsonb_array_length(route_odo->'rows'), 1) ) )
      ORDER BY (route_odo_at IS NULL) DESC, id DESC
      LIMIT $1`, [limit]);
  return r.rows;
}

async function computeAndStore(pool, cid, id) {
  const r = await pool.query('SELECT * FROM fuvarlevelek WHERE id = $1 AND company_id = $2', [id, cid]);
  if (!r.rows.length) return null;
  const { routeRows } = await buildWaybillRoute(pool, cid, r.rows[0]);
  const snap = odoSnapshot(routeRows);
  await pool.query('UPDATE fuvarlevelek SET route_odo = $3::jsonb, route_odo_at = NOW() WHERE id = $1 AND company_id = $2',
    [id, cid, JSON.stringify(snap)]);
  return snap;
}

async function markDone(pool, id) {
  try { await pool.query('UPDATE fuvarlevelek SET route_odo_at = NOW() WHERE id = $1', [id]); } catch (_) {}
}

module.exports.pickQueue = pickQueue;
module.exports.computeAndStore = computeAndStore;
module.exports.markDone = markDone;
