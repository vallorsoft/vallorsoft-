// ============================================================
//  VallorSoft — lib/routeChain.js
//  Közös útvonal-lánc számítás: tetszőleges számú pont SORRENDBEN (a bevitt /
//  menetlevélen rögzített sorrend), szakaszonként km + rakott / üres jelzés.
//  - classifyLegs: melyik szakasz üres (tiszta, tesztelhető)
//  - routeChain:   HERE kamion km (routeEstimate) 20 pontos darabokban (HERE nélkül NO_HERE hiba)
//  Fuvarnál: első felrakó → … → utolsó lerakó (benne a lerakó → következő
//  felrakó üres km). Menetlevélnél: Plecare → … → Sosire.
// ============================================================
const { estimateRoute } = require('./routeEstimate');

const CHUNK = 20;   // a routeEstimate egyszerre legfeljebb ennyi pontot tervez

// Pont-fajta egységesítése: 'pickup' | 'delivery' | 'other'
function kindOf(t) {
  const s = String(t || '').toLowerCase();
  if (s === 'pickup' || s === 'loading' || s === 'incarcare' || s === 'încărcare') return 'pickup';
  if (s === 'delivery' || s === 'unloading' || s === 'descarcare' || s === 'descărcare') return 'delivery';
  return 'other';
}

// Szakasz i (pont i → pont i+1) üres-e?
// Üres, ha a pont után már nincs hátra lerakó, VAGY a becsült rakomány 0 és a
// következő fel-/lerakó pont felrakó (pl. lerakó → következő felrakó, Plecare → első felrakó).
// Több lerakós fuvarnál (felrakó → lerakó → lerakó) a köztes szakasz rakott marad.
function classifyLegs(types) {
  const k = (types || []).map(kindOf);
  const out = [];
  let pick = 0, del = 0;
  for (let i = 0; i < k.length - 1; i++) {
    if (k[i] === 'pickup') pick++;
    if (k[i] === 'delivery') del++;
    let next = null, deliveryAhead = false;
    for (let j = i + 1; j < k.length; j++) {
      if (k[j] === 'delivery') deliveryAhead = true;
      if (!next && k[j] !== 'other') next = k[j];
    }
    const onboard = Math.max(0, pick - del);
    out.push(!deliveryAhead || (onboard === 0 && next === 'pickup'));
  }
  return out;
}

// Szakasz-km-ek összegzése rakott / üres bontásban
function splitKm(legs) {
  let loaded = 0, empty = 0;
  for (const l of legs || []) { const km = Number(l.km) || 0; if (l.empty) empty += km; else loaded += km; }
  return { loaded_km: Math.round(loaded * 10) / 10, empty_km: Math.round(empty * 10) / 10 };
}

// Pontok → km + polyline + szakaszok (rakott/üres). wps: [{type, address?, lat?, lng?}]
async function routeChain(cid, wps, opts) {
  const pts = (wps || []).filter((w) => w && (w.address || (w.lat != null && w.lng != null)));
  if (pts.length < 2) throw new Error('Cel puțin două puncte sunt necesare pentru traseu.');
  const est = (opts && opts.estimate) || estimateRoute;
  let km = 0, dur = 0, poly = [], legs = [], resolved = [], here = true, freeReason = null;
  for (let s = 0; s < pts.length - 1; s += CHUNK - 1) {
    const part = pts.slice(s, s + CHUNK);
    if (part.length < 2) break;
    const r = await est(part, cid);
    if (r.source !== 'here-truck') { here = false; if (!freeReason) freeReason = r.free_reason || null; }
    dur += Number(r.durationSeconds) || 0;
    const rp = r.polyline || [];
    poly = poly.concat(poly.length && rp.length ? rp.slice(1) : rp);
    legs = legs.concat((r.legs || []).map((l) => ({ from: l.fromLabel, to: l.toLabel, km: Number(l.km) || 0, sec: l.durationSeconds || 0 })));
    const rw = r.waypoints || [];
    resolved = resolved.concat(resolved.length ? rw.slice(1) : rw);
  }
  const flags = classifyLegs(pts.map((p) => p.type));
  legs.forEach((l, i) => { l.empty = !!flags[i]; km += l.km; });
  const sp = splitKm(legs);
  return { km: Math.round(km), durationSeconds: Math.round(dur), polyline: poly, legs,
    waypoints: resolved.map((w, i) => ({ type: (pts[i] && pts[i].type) || w.type, address: (pts[i] && pts[i].address) || w.label, lat: w.lat, lng: w.lng })),
    loaded_km: sp.loaded_km, empty_km: sp.empty_km, source: here ? 'here-truck' : 'osrm', free_reason: here ? null : freeReason };
}

module.exports = { kindOf, classifyLegs, splitKm, routeChain, CHUNK };
