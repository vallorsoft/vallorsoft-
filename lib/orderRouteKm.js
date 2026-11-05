// ============================================================
//  VallorSoft — lib/orderRouteKm.js
//  Egy kiírt fuvar teljes km-je: az ÖSSZES állomás a fuvaron belüli sorrendben
//  (order_stops seq_index), az első felrakótól az utolsó lerakóig — benne a
//  lerakó → következő felrakó üres km is. Szakaszonként rakott / üres bontás.
//  Eredmény: orders.route_geo (waypoints, km, legs, loaded_km, empty_km, sig);
//  az orders.km-et csak akkor írja, ha üres vagy korábban is automata volt
//  (kézi érték nyer). Háttérben fut (ütemező), felhasználói kérés nem vár rá.
//  company_id-szűrt, paraméteres.
// ============================================================
const pool = require('../db');
const rc = require('./routeChain');
const maps = require('./mapsProvider');

// A cégnek van-e aktív HERE-kulcsa (SQL-feltétel; ilyenkor az OSRM-mel számolt régi eredményt újraszámoljuk)
const HERE_ON_SQL = `EXISTS (SELECT 1 FROM company_integrations ci WHERE ci.company_id = o.company_id AND ci.provider = 'maps'
    AND ci.enabled AND ci.meta->>'vendor' = 'here' AND ci.credentials_enc IS NOT NULL)`;

const STOP_ORDER = `COALESCE(s.seq_index, 999999), (s.kind='pickup') DESC, s.stop_index`;
const _failed = new Map();               // orderId -> időbélyeg (geokód-hiba után 6 óra szünet)
const FAIL_BACKOFF_MS = 6 * 3600 * 1000;

// Az állomás-lista aláírása (ugyanaz, mint az SQL-oldali sor-kiválasztásnál)
const sigOf = (stops) => stops.map((s) => s.kind + '|' + String(s.loc || '').trim()).join(' > ');

async function loadStops(cid, orderId) {
  return (await pool.query(
    `SELECT s.kind, s.loc FROM order_stops s WHERE s.order_id=$1 AND s.company_id=$2 ORDER BY ` + STOP_ORDER,
    [orderId, cid])).rows;
}

async function computeForOrder(cid, orderId, opts) {
  const force = !!(opts && opts.force);
  const stops = await loadStops(cid, orderId);
  if (stops.length < 2 || stops.some((s) => !String(s.loc || '').trim())) return { skipped: 'stops' };
  const o = (await pool.query('SELECT km, route_geo FROM orders WHERE id=$1 AND company_id=$2', [orderId, cid])).rows[0];
  if (!o) return { skipped: 'missing' };
  let rg = o.route_geo;
  if (typeof rg === 'string') { try { rg = JSON.parse(rg); } catch (_) { rg = null; } }
  const sig = sigOf(stops);
  if (!force && rg && rg.sig === sig) {
    // ugyanaz az állomás-lista: csak akkor számolunk újra, ha a régi eredmény nem HERE-rel készült, de már van HERE-kulcs
    let hereOn = false;
    if (rg.src !== 'here-truck') { try { const c = await maps.getConfig(cid); hereOn = c.vendor === 'here' && !!c.key; } catch (_) {} }
    if (!hereOn) return { skipped: 'same' };
  }
  // a már ismert koordinátákat (kliens / korábbi számítás) újrahasznosítjuk → nincs felesleges geokódolás
  const known = new Map();
  for (const w of (rg && Array.isArray(rg.waypoints) ? rg.waypoints : [])) {
    if (w && w.address && w.lat != null && w.lng != null) known.set(String(w.address).trim().toLowerCase(), w);
  }
  const wps = stops.map((s) => {
    const addr = String(s.loc).trim();
    const k = known.get(addr.toLowerCase());
    return k ? { type: s.kind === 'pickup' ? 'loading' : 'unloading', address: addr, lat: Number(k.lat), lng: Number(k.lng) }
      : { type: s.kind === 'pickup' ? 'loading' : 'unloading', address: addr };
  });
  const r = await rc.routeChain(cid, wps, opts);
  const geo = { waypoints: r.waypoints.slice(0, 25).map((w) => ({ type: w.type, address: w.address, lat: w.lat, lng: w.lng })),
    km: r.km, durationSeconds: r.durationSeconds,
    legs: r.legs.slice(0, 30).map((l) => ({ from: l.from, to: l.to, km: l.km, empty: l.empty })),
    loaded_km: r.loaded_km, empty_km: r.empty_km, sig, auto: true, src: r.source || null, free_reason: r.free_reason || null };
  const oldAuto = rg && rg.km != null ? Number(rg.km) : null;
  const cur = o.km != null ? Number(o.km) : 0;
  const setKm = !(cur > 0) || (oldAuto != null && Math.abs(cur - oldAuto) < 1);
  await pool.query(
    `UPDATE orders SET route_geo=$3::jsonb` + (setKm ? `, km=$4` : '') + ` WHERE id=$1 AND company_id=$2`,
    setKm ? [orderId, cid, JSON.stringify(geo), r.km] : [orderId, cid, JSON.stringify(geo)]);
  return { km: r.km, loaded_km: r.loaded_km, empty_km: r.empty_km, km_updated: setKm };
}

// Sor az ütemezőnek: aktív / friss fuvarok, ahol az állomás-lista megváltozott (vagy még nincs számolva)
async function pickQueue(limit) {
  const { rows } = await pool.query(
    `SELECT o.id, o.company_id FROM orders o
       JOIN LATERAL (
         SELECT COUNT(*) AS n, COUNT(*) FILTER (WHERE COALESCE(TRIM(s.loc),'') = '') AS empty_loc,
                string_agg(s.kind || '|' || TRIM(COALESCE(s.loc,'')), ' > ' ORDER BY ` + STOP_ORDER + `) AS sig
           FROM order_stops s WHERE s.order_id = o.id AND s.company_id = o.company_id
       ) st ON st.n >= 2 AND st.empty_loc = 0
      WHERE o.status <> 'Anulat' AND COALESCE(o.created_at, NOW()) > NOW() - INTERVAL '120 days'
        AND (o.route_geo IS NULL OR (o.route_geo->>'sig') IS DISTINCT FROM st.sig
             OR (COALESCE(o.route_geo->>'src','') <> 'here-truck' AND ` + HERE_ON_SQL + `))
      ORDER BY o.created_at DESC NULLS LAST LIMIT $1`, [limit || 20]);
  const now = Date.now();
  return rows.filter((r) => !(_failed.has(r.id) && now - _failed.get(r.id) < FAIL_BACKOFF_MS));
}

function markFailed(orderId) {
  _failed.set(orderId, Date.now());
  if (_failed.size > 5000) _failed.delete(_failed.keys().next().value);
}

module.exports = { computeForOrder, pickQueue, markFailed, sigOf, loadStops };
