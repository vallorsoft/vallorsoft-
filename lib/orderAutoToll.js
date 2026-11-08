// ============================================================
//  VallorSoft — lib/orderAutoToll.js
//  Automatikus útdíj minden fuvarra, amelynek már megvan a HERE kamion-
//  útvonala (orders.route_geo, src='here-truck') — a 🛣️ gombot nem kell
//  megnyomni. Ugyanaz a közös mag számol, mint a fuvar-szerkesztőben
//  (lib/orderToll.js computeOrderToll, HERE „Pontos" módban).
//
//  Szabályok:
//    • kézzel beírt útdíjat nem írunk felül: csak akkor számolunk, ha a
//      toll_cost üres, VAGY a korábbi értéket is az automatika írta
//      (toll_geo.auto = true) és azóta senki nem módosította a díjat;
//    • újraszámolás csak akkor, ha az útvonal megváltozott (route_geo.sig);
//    • csak a `toll-becsles` funkcióval rendelkező cégeknél.
//  company_id-szűrt, paraméteres. Háttérben fut, felhasználói kérés nem vár rá.
// ============================================================
const pool = require('../db');
const { computeOrderToll } = require('./orderToll');

const _failed = new Map();
const FAIL_BACKOFF_MS = 6 * 3600 * 1000;

// Felülírható-e a meglévő érték (tiszta függvény)
function canOverwrite(o) {
  if (o.toll_cost == null || o.toll_cost === '') return true;
  let tg = o.toll_geo;
  if (typeof tg === 'string') { try { tg = JSON.parse(tg); } catch (_) { tg = null; } }
  if (!tg || tg.auto !== true) return false;                 // kézi vagy gombbal számolt érték
  const total = Number(tg.total);
  return Number.isFinite(total) && Math.abs(Number(o.toll_cost) - total) < 0.01;   // azóta nem írták át
}

async function pickQueue(limit) {
  const { rows } = await pool.query(
    `SELECT o.id, o.company_id FROM orders o
      WHERE o.status <> 'Anulat'
        AND COALESCE(o.created_at, NOW()) > NOW() - INTERVAL '120 days'
        AND o.route_geo IS NOT NULL AND (o.route_geo->>'src') = 'here-truck'
        AND (o.route_geo->>'sig') IS NOT NULL
        AND (o.toll_cost IS NULL
             OR ((o.toll_geo->>'auto') = 'true' AND (o.toll_geo->>'sig') IS DISTINCT FROM (o.route_geo->>'sig')))
      ORDER BY o.created_at DESC NULLS LAST LIMIT $1`, [limit || 20]);
  const now = Date.now();
  return rows.filter((r) => !(_failed.has(r.id) && now - _failed.get(r.id) < FAIL_BACKOFF_MS));
}

function markFailed(id) {
  _failed.set(id, Date.now());
  if (_failed.size > 5000) _failed.delete(_failed.keys().next().value);
}

async function computeForOrder(cid, orderId) {
  const o = (await pool.query(
    `SELECT id, loc_incarcare, loc_descarcare, route_geo, toll_cost, toll_geo FROM orders WHERE id=$1 AND company_id=$2`,
    [orderId, cid])).rows[0];
  if (!o) return { skipped: 'missing' };
  if (!canOverwrite(o)) return { skipped: 'manual' };
  let rg = o.route_geo;
  if (typeof rg === 'string') { try { rg = JSON.parse(rg); } catch (_) { rg = null; } }
  const out = await computeOrderToll(cid, o, { precise: true });
  const geo = Object.assign({}, out.toll, { auto: true, sig: (rg && rg.sig) || null, source: out.source, at: new Date().toISOString() });
  // versenyhelyzet ellen: csak akkor írunk, ha közben senki nem módosította a díjat
  const r = await pool.query(
    `UPDATE orders SET toll_cost=$3, toll_geo=$4::jsonb
      WHERE id=$1 AND company_id=$2 AND toll_cost IS NOT DISTINCT FROM $5::numeric`,
    [orderId, cid, out.toll.total, JSON.stringify(geo), o.toll_cost == null ? null : Number(o.toll_cost)]);
  return { toll: out.toll.total, source: out.source, updated: r.rowCount > 0 };
}

module.exports = { pickQueue, computeForOrder, markFailed, canOverwrite };
