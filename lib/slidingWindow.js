// ============================================================
//  VallorSoft — lib/slidingWindow.js
//  Általános csúszóablakos rate-limiter (memóriában, egy szerver-process).
//  Pl. a sofőr-oldali áru-leadás-kérés korlátozásához (push-spam ellen).
// ============================================================

// { windowMs, max } → limiter objektum .check(key)-jel.
function createSlidingWindowLimiter(opts) {
  const windowMs = (opts && opts.windowMs) || 60000;
  const max = (opts && opts.max) || 5;
  const log = new Map(); // key -> [timestamp, ...]

  // → { ok:true } ha mehet, vagy { ok:false, retryAfterSec } ha túllépte
  function check(key, now) {
    const t0 = typeof now === 'number' ? now : Date.now();
    const k = String(key || '');
    const arr = (log.get(k) || []).filter((t) => t0 - t < windowMs);
    if (arr.length >= max) {
      log.set(k, arr);
      return { ok: false, retryAfterSec: Math.ceil((windowMs - (t0 - arr[0])) / 1000) };
    }
    arr.push(t0);
    log.set(k, arr);
    return { ok: true };
  }

  return { check, _reset: () => log.clear() };
}

module.exports = { createSlidingWindowLimiter };
