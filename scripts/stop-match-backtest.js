#!/usr/bin/env node
// ============================================================
//  VallorSoft — cím-felismerés visszamérése VALÓS adaton (csak olvas, semmit nem ír)
//  A mérés logikája: lib/stopMatchAccuracy.js (ugyanazt használja a havi ütemező is).
//
//  Használat:
//    node scripts/stop-match-backtest.js [--company 7] [--days 90] [--limit 200] [--no-memory] [--online]
//  --no-memory : a tanult adatok nélkül (különben a már elfogadott hely a helymemóriából
//                „visszaköszön", ami túl szép eredményt ad)
//  --online    : a hiányzó címeket a Nominatimtól is lekéri (alapból csak cache — lassú, fojtott)
//  Kilépési kód 2, ha volt „biztos de ROSSZ" eset.
// ============================================================
require('dotenv').config();
const pool = require('../db');
const acc = require('../lib/stopMatchAccuracy');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);

(async () => {
  let cids;
  if (arg('--company')) cids = [parseInt(arg('--company'), 10)];
  else cids = (await pool.query(`SELECT DISTINCT company_id FROM order_stops WHERE match_status='confirmed'`)).rows.map((r) => r.company_id);
  let autoWrong = 0;
  for (const cid of cids) {
    const r = await acc.measureCompany(cid, { days: arg('--days', '90'), limit: arg('--limit', '200'),
      noMemory: has('--no-memory'), online: has('--online') });
    const t = r.totals;
    const pct = (a) => t.stops ? Math.round(a / t.stops * 1000) / 10 + '%' : '—';
    autoWrong += t.auto_wrong;
    console.log('\nCég #' + cid + ' — ' + t.orders + ' fuvar, ' + t.stops + ' elfogadott állomás' + (has('--no-memory') ? ' (tanult adatok nélkül)' : ''));
    console.log('  eltalálta (≤ ' + acc.OK_M + ' m):  ' + t.hit + '  (' + pct(t.hit) + ')');
    console.log('  máshol:                ' + t.miss + '  (' + pct(t.miss) + ')');
    console.log('  nem talált helyet:     ' + t.none + '  (' + pct(t.none) + ')');
    console.log('  „biztos" és JÓ:        ' + t.auto_right);
    console.log('  „biztos" de ROSSZ:     ' + t.auto_wrong + '   ← ennek 0 közelében kell lennie (ebből fut a gomb-pótlás)');
    console.log('  pihenő-hely választva: ' + t.rest + ' · pihenő utáni állás: ' + t.hop);
    if (r.misses.length) {
      console.log('  Tévesztések (max. 30):');
      for (const m of r.misses.slice(0, 30)) console.log('    ' + m.order + ' #' + m.stop + ' ' + m.kind + ' ' + (m.loc || '') + ' — ' + m.km + ' km, ' + m.status + ' ' + m.score + ' pt' + (m.rest ? ' [' + m.rest + ']' : '') + (m.hop ? ' [pihenő után]' : ''));
    }
  }
  await pool.end();
  process.exit(autoWrong > 0 ? 2 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
