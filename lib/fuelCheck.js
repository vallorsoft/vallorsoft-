// ============================================================
//  lib/fuelCheck.js — üzemanyag-ellenőrzés a GPS-útvonalon (3 független mód)
//
//  1) stopCheck     — álló helyzetben eltűnt üzemanyag. NEM a parkolás eleje
//                     és vége közti szintet vetjük össze (a légrugós tengely és
//                     a külön emelhető szint álló helyzetben is elmozdítja a
//                     szondát), hanem a megállás ELŐTTI és UTÁNI menet szintjét
//                     (normál menetmagasság, ~2–15 km a megállótól), a közben
//                     elfogyó üzemanyaggal korrigálva. A parkolás alatti szint
//                     csak megerősítés.
//  2) receiptCheck  — a menetlevélre felvitt (lefotózott) tankolási bon litere
//                     vs. a tartály-szint tényleges emelkedése azon a napon.
//  3) consumptionCheck — az időszak átlagfogyasztása a jármű saját korábbi
//                     átlagához / névleges értékéhez; a bon-literekből számolt
//                     fogyasztás és a fogyasztás-számláló is összevetve.
//
//  Mind tiszta függvény (DB nélkül tesztelhető); a hívó mindegyiket külön
//  try/catch-ben futtatja, így bármelyik elbukása mellett a többi számol.
// ============================================================
const gt = require('./gpsTrack');

const STOP_MIN_S = 20 * 60;          // ennél rövidebb állást nem vizsgálunk
const NEAR_FROM_KM = 2;              // a megállótól ennyi km-re kezdődik a menet-ablak
const NEAR_TO_KM = 15;               // … és eddig tart
const MIN_READINGS = 5;
const STOP_MIN_L = 6;                // ekkora hiánytól jelzünk
const IDLE_L_PER_H = 2.5;            // járó motoros álláskor ennyi fogyhat
const DEF_L_PER_KM = 0.32;
const RECEIPT_TOL_L = 5;             // bon ↔ mért emelkedés tűrés
const RECEIPT_TOL_PCT = 0.03;
const CONS_WARN_L100 = 2.5;          // ekkora átlag-eltérés felett jelzünk
const CONS_MIN_KM = 300;

const med = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const r1 = (n) => Math.round(n * 10) / 10;

// 1) Álló helyzetű hiány — pts: [t,lat,lng,speed,ign,mileage,fuelUsed,level,…]
function stopCheck(pts, opts) {
  opts = opts || {};
  const rate = opts.lPerKm > 0 && opts.lPerKm < 1 ? opts.lPerKm : DEF_L_PER_KM;
  const refuels = opts.refuels || [];
  if (!Array.isArray(pts) || pts.length < 10) return { items: [], checked: 0 };
  const n = pts.length;
  const cum = new Array(n).fill(0);
  for (let k = 1; k < n; k++) cum[k] = cum[k - 1] + gt.distM(pts[k - 1], pts[k]) / 1000;
  const lvl = (p) => (p && p[7] != null && p[7] >= 0 ? p[7] : null);
  const stops = gt.detectStops(pts).filter((s) => s.to - s.from >= STOP_MIN_S);
  const items = [];
  let checked = 0;
  for (const s of stops) {
    // tankolás az állás alatt → itt nem vizsgáljuk (a bon-ellenőrzés fedi)
    if (refuels.some((r) => r.t >= s.from - 600 && r.t <= s.to + 600)) continue;
    const before = [], after = [];
    for (let j = s.i0; j >= 0; j--) {
      const d = cum[s.i0] - cum[j];
      if (d > NEAR_TO_KM) break;
      const l = lvl(pts[j]);
      if (d >= NEAR_FROM_KM && l != null) before.push(l - d * rate);
    }
    for (let j = s.i1; j < n; j++) {
      const d = cum[j] - cum[s.i1];
      if (d > NEAR_TO_KM) break;
      const l = lvl(pts[j]);
      if (d >= NEAR_FROM_KM && l != null) after.push(l + d * rate);
    }
    if (before.length < MIN_READINGS || after.length < MIN_READINGS) continue;
    checked++;
    // járó motoros állás alatti fogyasztás
    let idleS = 0;
    for (let j = s.i0 + 1; j <= s.i1; j++) if (pts[j - 1][4] === 1) idleS += pts[j][0] - pts[j - 1][0];
    const idle = idleS / 3600 * IDLE_L_PER_H;
    const drop = med(before) - med(after) - idle;
    if (drop < STOP_MIN_L) continue;
    // megerősítés: a parkolás eleje vs. vége (csak tájékoztató — a légrugó miatt nem döntő)
    const head = [], tail = [];
    for (let j = s.i0; j <= s.i1; j++) {
      const l = lvl(pts[j]); if (l == null) continue;
      if (pts[j][0] - s.from >= 180 && pts[j][0] - s.from <= 900) head.push(l);
      if (pts[s.i1][0] - pts[j][0] <= 600) tail.push(l);
    }
    const parkDrop = head.length >= 2 && tail.length >= 2 ? med(head) - med(tail) : null;
    items.push({
      from: s.from, to: s.to, lat: s.lat, lng: s.lng, liters: r1(drop),
      park_drop: parkDrop == null ? null : r1(parkDrop),
      confirmed: parkDrop != null && parkDrop >= drop * 0.5,
    });
  }
  return { items, checked };
}

// 2) Bon ↔ mért tankolás. receipts: [{day:'YYYY-MM-DD', liters, loc, km, waybill}]
//    refuels: levelFuel().refuels ({t, liters}); dayOf: epoch mp → 'YYYY-MM-DD'
function receiptCheck(receipts, refuels, dayOf) {
  const byDay = new Map();
  for (const r of receipts || []) {
    if (!(r.liters > 0) || !r.day) continue;
    const e = byDay.get(r.day) || { day: r.day, receipt_l: 0, receipts: [], measured_l: 0 };
    e.receipt_l += r.liters; e.receipts.push(r);
    byDay.set(r.day, e);
  }
  const unmatched = [];
  for (const f of refuels || []) {
    const d = dayOf(f.t);
    if (byDay.has(d)) byDay.get(d).measured_l += f.liters;
    else unmatched.push({ day: d, t: f.t, liters: f.liters, lat: f.lat, lng: f.lng });
  }
  // éjfél körüli tankolás: a bon napjához ±1 napon belüli, gazdátlan mérés
  for (const e of byDay.values()) {
    if (e.measured_l > 0) continue;
    for (let i = 0; i < unmatched.length; i++) {
      const u = unmatched[i];
      if (Math.abs(gt.dayStartMs(u.day) - gt.dayStartMs(e.day)) <= 86400000 && !byDay.has(u.day)) {
        e.measured_l += u.liters; unmatched.splice(i, 1); break;
      }
    }
  }
  const items = [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1)).map((e) => {
    const diff = e.receipt_l - e.measured_l;
    const tol = Math.max(RECEIPT_TOL_L, e.receipt_l * RECEIPT_TOL_PCT);
    let status = 'ok';
    if (e.measured_l <= 0) status = 'not_measured';
    else if (diff > tol) status = 'missing';
    else if (-diff > tol) status = 'extra';
    return { day: e.day, receipt_l: r1(e.receipt_l), measured_l: r1(e.measured_l), diff_l: r1(diff), status,
      places: e.receipts.map((r) => r.loc).filter(Boolean).slice(0, 3), waybills: [...new Set(e.receipts.map((r) => r.waybill).filter(Boolean))] };
  });
  const missing = items.filter((i) => i.status === 'missing').reduce((a, i) => a + i.diff_l, 0);
  return { items, no_receipt: unmatched.map((u) => ({ day: u.day, t: u.t, liters: r1(u.liters) })), missing_l: r1(missing) };
}

// 3) Fogyasztás-összevetés
//  { km, used_level, used_counter, start_level, end_level, receipt_l, hist_l100, nominal_l100 }
function consumptionCheck(a) {
  const km = Number(a.km) || 0;
  const out = { km: r1(km), sources: [], baseline: null, baseline_src: null, flags: [] };
  if (km < CONS_MIN_KM) { out.too_short = true; return out; }
  const l100 = (l) => Math.round(l / km * 10000) / 100;
  if (a.used_level != null) out.sources.push({ key: 'level', l100: l100(a.used_level), liters: r1(a.used_level) });
  if (a.used_counter != null) out.sources.push({ key: 'counter', l100: l100(a.used_counter), liters: r1(a.used_counter) });
  if (a.receipt_l > 0 && a.start_level != null && a.end_level != null) {
    const u = Math.max(0, a.start_level - a.end_level + a.receipt_l);
    out.sources.push({ key: 'receipts', l100: l100(u), liters: r1(u) });
  }
  if (a.hist_l100 > 0) { out.baseline = r1(a.hist_l100); out.baseline_src = 'history'; }
  else if (a.nominal_l100 > 0) { out.baseline = r1(a.nominal_l100); out.baseline_src = 'nominal'; }
  if (out.baseline) {
    for (const s of out.sources) {
      const d = s.l100 - out.baseline;
      if (d >= CONS_WARN_L100) out.flags.push({ key: s.key, over_l100: r1(d), excess_l: r1(d * km / 100) });
    }
  }
  const lv = out.sources.find((s) => s.key === 'level'), ct = out.sources.find((s) => s.key === 'counter');
  if (lv && ct && lv.liters - ct.liters >= Math.max(15, ct.liters * 0.03)) {
    out.flags.push({ key: 'level_vs_counter', excess_l: r1(lv.liters - ct.liters) });
  }
  return out;
}

module.exports = { stopCheck, receiptCheck, consumptionCheck, STOP_MIN_L };
