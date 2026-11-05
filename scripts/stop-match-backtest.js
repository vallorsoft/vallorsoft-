#!/usr/bin/env node
// ============================================================
//  VallorSoft — cím-felismerés visszamérése VALÓS adaton (csak olvas, semmit nem ír)
//
//  Az iroda által elfogadott (confirmed) állomások tényleges helyét „helyes válasznak"
//  veszi, a motort írás nélkül újrafuttatja rájuk (matchOrder dryRun), és kiírja,
//  hány százalékban találja el (≤ 300 m), illetve hányszor lett volna „biztos" (auto)
//  egy ROSSZ helyre — ez a legfontosabb szám: az automatikus gomb-pótlás ebből fut.
//
//  Használat:
//    node scripts/stop-match-backtest.js [--company 7] [--days 90] [--limit 200] [--no-memory] [--online]
//  --no-memory : a tanult adatok nélkül (különben a már elfogadott hely a helymemóriából
//                „visszaköszön", ami túl szép eredményt ad)
//  --online    : a hiányzó címeket a Nominatimtól is lekéri (alapból csak cache — lassú, fojtott)
// ============================================================
require('dotenv').config();
const pool = require('../db');
const runner = require('../lib/stopMatchRunner');
const gt = require('../lib/gpsTrack');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);
const OK_M = 300;

(async () => {
  const cid = arg('--company') ? parseInt(arg('--company'), 10) : null;
  const days = parseInt(arg('--days', '90'), 10);
  const limit = parseInt(arg('--limit', '200'), 10);
  const params = [days, limit];
  let where = '';
  if (cid) { params.push(cid); where = ' AND s.company_id = $3'; }
  const { rows: orders } = await pool.query(
    `SELECT DISTINCT s.order_id, s.company_id FROM order_stops s
      WHERE s.match_status = 'confirmed' AND s.actual_lat IS NOT NULL
        AND COALESCE(s.matched_at, s.updated_at) > NOW() - ($1 || ' days')::interval ${where}
      LIMIT $2`, params);
  const tot = { stops: 0, hit: 0, miss: 0, none: 0, autoWrong: 0, autoRight: 0, rest: 0, hop: 0 };
  const misses = [];
  for (const o of orders) {
    const truth = (await pool.query(
      `SELECT id, kind, loc, actual_lat, actual_lng FROM order_stops
        WHERE order_id=$1 AND company_id=$2 AND match_status='confirmed' AND actual_lat IS NOT NULL`, [o.order_id, o.company_id])).rows;
    let r;
    try { r = await runner.matchOrder(o.company_id, o.order_id, { dryRun: true, noMemory: has('--no-memory'), cacheOnly: !has('--online') }); }
    catch (e) { console.warn('hiba', o.order_id, e.message); continue; }
    if (!r || r.status !== 'dry') continue;
    for (const t of truth) {
      const g = r.stops.find((x) => String(x.stop_id) === String(t.id));
      if (!g) continue;
      tot.stops++;
      if (g.lat == null) { tot.none++; continue; }
      const d = gt.distM([0, g.lat, g.lng], [0, t.actual_lat, t.actual_lng]);
      if (g.rest) tot.rest++;
      if (g.hop) tot.hop++;
      if (d <= OK_M) { tot.hit++; if (g.status === 'auto') tot.autoRight++; }
      else {
        tot.miss++; if (g.status === 'auto') tot.autoWrong++;
        misses.push({ order: o.order_id, stop: t.id, kind: t.kind, loc: t.loc, km: Math.round(d / 100) / 10, status: g.status, score: g.score, rest: g.rest, hop: g.hop });
      }
    }
  }
  const pct = (a) => tot.stops ? Math.round(a / tot.stops * 1000) / 10 + '%' : '—';
  console.log('\nVisszamérés — ' + orders.length + ' fuvar, ' + tot.stops + ' elfogadott állomás' + (has('--no-memory') ? ' (tanult adatok nélkül)' : ''));
  console.log('  eltalálta (≤ ' + OK_M + ' m):  ' + tot.hit + '  (' + pct(tot.hit) + ')');
  console.log('  máshol:                ' + tot.miss + '  (' + pct(tot.miss) + ')');
  console.log('  nem talált helyet:     ' + tot.none + '  (' + pct(tot.none) + ')');
  console.log('  „biztos" és JÓ:        ' + tot.autoRight);
  console.log('  „biztos" de ROSSZ:     ' + tot.autoWrong + '   ← ennek 0 közelében kell lennie (ebből fut a gomb-pótlás)');
  console.log('  pihenő-hely választva: ' + tot.rest + ' · pihenő utáni állás: ' + tot.hop);
  if (misses.length) {
    console.log('\nTévesztések (max. 30):');
    for (const m of misses.slice(0, 30)) console.log('  ' + m.order + ' #' + m.stop + ' ' + m.kind + ' ' + (m.loc || '') + ' — ' + m.km + ' km, ' + m.status + ' ' + m.score + ' pt' + (m.rest ? ' [' + m.rest + ']' : '') + (m.hop ? ' [pihenő után]' : ''));
  }
  await pool.end();
  process.exit(tot.autoWrong > 0 ? 2 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
