// ============================================================
//  Tankolt liter ésszerűségi ellenőrzése (bon-scan + menetlevél).
//  Gyakori AI-hiba: kerek literes tankolásnál (pl. 300 L) a bonon a
//  literenkénti ár (pl. 10,93 lej/l) kerül a liter mezőbe.
//  Szabály: Motorină (dízel) 50–1500 L; AdBlue 0 < L ≤ 1500.
// ============================================================
const DIESEL_MIN_L = 50;
const DIESEL_MAX_L = 1500;
const ADBLUE_MAX_L = 1500;

function _isAdBlue(tip) { return String(tip || '').toLowerCase().replace(/\s+/g, '') === 'adblue'; }

function inRange(litru, tip) {
  const l = Number(litru);
  if (!Number.isFinite(l) || l <= 0) return false;
  if (_isAdBlue(tip)) return l <= ADBLUE_MAX_L;
  return l >= DIESEL_MIN_L && l <= DIESEL_MAX_L;
}

const _r2 = (n) => Math.round(n * 100) / 100;

// Javítás: { litru, fixed, warn }. `pretLitru` = a bonon szereplő literár (ha van).
function fixLiters(litru, suma, pretLitru, tip) {
  const l = Number(litru), s = Number(suma), p = Number(pretLitru);
  const ok = (v) => inRange(v, tip);
  // 1) A liter mező valójában a literár (egyezik a bon literárával)
  if (Number.isFinite(p) && p > 0 && Number.isFinite(l) && Math.abs(l - p) < 0.011
      && Number.isFinite(s) && s > 0 && ok(s / p)) {
    return { litru: _r2(s / p), fixed: true, warn: false };
  }
  if (ok(l)) return { litru: l, fixed: false, warn: false };
  // 2) Összeg / literár
  if (Number.isFinite(p) && p > 0 && Number.isFinite(s) && s > 0 && ok(s / p)) {
    return { litru: _r2(s / p), fixed: true, warn: false };
  }
  // 3) A liter mezőben literár volt → összeg / az
  if (Number.isFinite(l) && l > 0 && Number.isFinite(s) && s > 0 && ok(s / l)) {
    return { litru: _r2(s / l), fixed: true, warn: false };
  }
  // Nem javítható → a sofőr írja be (nem engedünk hamis értéket).
  if (l == null || !Number.isFinite(l)) return { litru: null, fixed: false, warn: false };
  return { litru: null, fixed: false, warn: true };
}

module.exports = { DIESEL_MIN_L, DIESEL_MAX_L, ADBLUE_MAX_L, inRange, fixLiters };
