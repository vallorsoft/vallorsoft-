// ============================================================
//  VallorSoft — lib/sortedSearch.js
//  Bináris (felezéses) keresés időrendbe rendezett GPS-pontsoron.
//  A pontok formátuma [t(sec), lat, lng, …], t szerint növekvő.
//  N pontból log2(N) lépésben találja meg az első pontot, aminek
//  t >= sec (pl. 50 000 pontnál ~16 lépés a végigpörgetés helyett).
// ============================================================

// Az első index, ahol pts[i][0] >= sec (ha nincs ilyen: pts.length).
// A nem tömb / hibás elemeket a hívó kezeli (a ciklusban továbbra is szűr).
function lowerBoundT(pts, sec) {
  if (!Array.isArray(pts) || sec == null || !Number.isFinite(sec)) return 0;
  let lo = 0, hi = pts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const p = pts[mid];
    const t = Array.isArray(p) ? p[0] : NaN;
    if (t < sec) lo = mid + 1; else hi = mid;   // NaN → balra keres (biztonságos: nem ugrik át pontot)
  }
  return lo;
}

module.exports = { lowerBoundT };
