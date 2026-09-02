// VallorSoft — BNR EUR/RON árfolyam lekérdező
// Forrás: https://www.bnr.ro/nbrfxrates.xml (nyilvános, kulcs nélkül).
// Napi cache + 7 napos hosszú fallback (ha a BNR ideiglenesen nem elérhető,
// nem esik szét: a last-known-good rátát adjuk vissza, a naplóba figyelmeztetés).

let _cache = { rate: null, date: null, ts: 0 };
const DAY_MS = 24 * 60 * 60 * 1000;

// Attribútum-tudatos regex: a `<Rate currency="EUR" multiplier="1">4.9765</Rate>`
// és a `<Rate multiplier="1" currency="EUR">...` sorrendet is elviseli, plusz
// tetszőleges szóközöket. A statisticsHandlers.getBnrRate-ből átemelt minta.
const RE_EUR_A = /<Rate[^>]*currency\s*=\s*"EUR"[^>]*>([\d.]+)<\/Rate>/i;
const RE_EUR_B = /<Rate\s+multiplier\s*=\s*"[^"]*"\s+currency\s*=\s*"EUR"[^>]*>([\d.]+)<\/Rate>/i;

function _extractEurRate(xml) {
  if (!xml || typeof xml !== 'string') return null;
  let m = xml.match(RE_EUR_A);
  if (m) return parseFloat(m[1]);
  m = xml.match(RE_EUR_B);
  if (m) return parseFloat(m[1]);
  return null;
}

async function _tryFetch(url, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'VallorSoft/1.0 (+https://vallorsoft.fly.dev)' },
    });
    if (!r.ok) {
      console.warn('[BNR] HTTP status', r.status, 'a', url, '-ról');
      return null;
    }
    const xml = await r.text();
    const rate = _extractEurRate(xml);
    if (!rate) {
      console.warn('[BNR] EUR árfolyam nem található a válaszban (első 200 char):', String(xml).slice(0, 200));
      return null;
    }
    return rate;
  } catch (e) {
    console.warn('[BNR] Lekérés hiba (' + url + '):', (e && e.message) || e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// EUR/RON árfolyamot ad vissza (Number), vagy null-t ha semmi sem elérhető
// (a napi cache-t hozza vissza először; ha nincs, két külön BNR-endpointot
// próbál; ha az is elhal, a legutóbbi ismert értéket adja vissza max 7 napig).
async function fetchBnrEurRon() {
  const today = new Date().toISOString().slice(0, 10);
  // Ma már friss cache — használjuk
  if (_cache.date === today && _cache.rate) return _cache.rate;

  // Elsődleges endpoint (mai árfolyam)
  let rate = await _tryFetch('https://www.bnr.ro/nbrfxrates.xml', 10000);
  // Másodlagos endpoint (10 napos ablak — ha az elsődleges valamiért 404/500)
  if (!rate) rate = await _tryFetch('https://www.bnr.ro/nbrfxrates10days.xml', 10000);

  if (rate) {
    _cache = { rate, date: today, ts: Date.now() };
    console.log('[BNR] EUR/RON árfolyam frissítve:', rate);
    return rate;
  }

  // Fallback: last-known-good, max 7 napig — jobb egy pár napos árfolyam,
  // mint semmi. A hívó (kliens) így is látja, hogy ez a szerver-BNR, és a
  // Decont oficial modalban kézzel felül tudja írni.
  if (_cache.rate && _cache.ts && (Date.now() - _cache.ts) < 7 * DAY_MS) {
    console.warn('[BNR] Live-fetch elhalt — last-known-good értékkel folytatunk (' + _cache.date + '):', _cache.rate);
    return _cache.rate;
  }
  return null;
}

module.exports = { fetchBnrEurRon, _extractEurRate };
