// ============================================================
//  VallorSoft — lib/stopMatchAccuracy.js
//  A cím-felismerés pontosságának mérése VALÓS adaton (csak olvas).
//  Az iroda által elfogadott (confirmed) állomások helyét „helyes válasznak"
//  veszi, a motort írás nélkül újrafuttatja (matchOrder dryRun), és megszámolja,
//  hányszor találta el (≤ 300 m), és hányszor lett volna „biztos" egy ROSSZ helyre
//  (ebből fut a sofőr-gomb pótlása — ennek 0 közelében kell maradnia).
//  Használja: scripts/stop-match-backtest.js (kézi) és az ütemező (havi, tárolt).
//  Minden lekérdezés company_id-szűrt, paraméteres.
// ============================================================
const pool = require('../db');
const gt = require('./gpsTrack');

const OK_M = 300;

async function measureCompany(cid, opts) {
  opts = opts || {};
  const runner = require('./stopMatchRunner');
  const days = Math.max(7, Math.min(365, parseInt(opts.days, 10) || 90));
  const limit = Math.max(1, Math.min(500, parseInt(opts.limit, 10) || 100));
  const { rows: orders } = await pool.query(
    `SELECT DISTINCT s.order_id FROM order_stops s
      WHERE s.company_id = $1 AND s.match_status = 'confirmed' AND s.actual_lat IS NOT NULL
        AND COALESCE(s.matched_at, s.updated_at) > NOW() - ($2 || ' days')::interval
      LIMIT $3`, [cid, String(days), limit]);
  const tot = { orders: orders.length, stops: 0, hit: 0, miss: 0, none: 0, auto_right: 0, auto_wrong: 0, rest: 0, hop: 0 };
  const misses = [];
  for (const o of orders) {
    const truth = (await pool.query(
      `SELECT id, kind, loc, actual_lat, actual_lng FROM order_stops
        WHERE order_id=$1 AND company_id=$2 AND match_status='confirmed' AND actual_lat IS NOT NULL`,
      [o.order_id, cid])).rows;
    let r;
    try { r = await runner.matchOrder(cid, o.order_id, { dryRun: true, noMemory: opts.noMemory !== false, cacheOnly: opts.online !== true }); }
    catch (e) { continue; }
    if (!r || r.status !== 'dry') continue;
    for (const t of truth) {
      const g = r.stops.find((x) => String(x.stop_id) === String(t.id));
      if (!g) continue;
      tot.stops++;
      if (g.lat == null) { tot.none++; continue; }
      const d = gt.distM([0, g.lat, g.lng], [0, t.actual_lat, t.actual_lng]);
      if (g.rest) tot.rest++;
      if (g.hop) tot.hop++;
      if (d <= OK_M) { tot.hit++; if (g.status === 'auto') tot.auto_right++; }
      else {
        tot.miss++; if (g.status === 'auto') tot.auto_wrong++;
        if (misses.length < 50) misses.push({ order: o.order_id, stop: String(t.id), kind: t.kind, loc: t.loc || null,
          km: Math.round(d / 100) / 10, status: g.status, score: g.score, rest: g.rest || null, hop: !!g.hop });
      }
    }
  }
  tot.hit_pct = tot.stops ? Math.round(tot.hit / tot.stops * 1000) / 10 : null;
  return { totals: tot, misses, days, no_memory: opts.noMemory !== false };
}

// Mérés + tárolás (heti ütemező / kézi indítás). Egy cég, egy ISO-hét (pl. 2026-W45) = egy sor (felülírható).
async function measureAndStore(cid, opts) {
  const r = await measureCompany(cid, opts);
  await pool.query(
    `INSERT INTO stop_match_accuracy (company_id, period, totals, misses, measured_at)
     VALUES ($1, to_char(NOW() AT TIME ZONE 'Europe/Bucharest', 'IYYY-"W"IW'), $2::jsonb, $3::jsonb, NOW())
     ON CONFLICT (company_id, period) DO UPDATE SET totals=EXCLUDED.totals, misses=EXCLUDED.misses, measured_at=NOW()`,
    [cid, JSON.stringify(r.totals), JSON.stringify(r.misses)]);
  return r;
}

module.exports = { measureCompany, measureAndStore, OK_M };
