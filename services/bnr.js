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

// ============================================================
//  MINDEN VALUTA — napi mentés a `bnr_rates` táblába + dátum szerinti lekérés
// ============================================================
// A BNR XML-ben több <Cube date="YYYY-MM-DD"> blokk lehet (10 napos / éves
// fájl); minden <Rate currency="X" [multiplier="N"]>érték</Rate> → RON/1 egység.
const RE_CUBE = /<Cube\s+date\s*=\s*"(\d{4}-\d{2}-\d{2})"\s*>([\s\S]*?)<\/Cube>/gi;
const RE_RATE = /<Rate([^>]*)>\s*([\d.]+)\s*<\/Rate>/gi;

function parseBnrXml(xml) {
  const out = [];
  if (!xml || typeof xml !== 'string') return out;
  let c;
  RE_CUBE.lastIndex = 0;
  while ((c = RE_CUBE.exec(xml))) {
    const rates = {};
    let r;
    const re = new RegExp(RE_RATE.source, 'gi');
    while ((r = re.exec(c[2]))) {
      const cur = (r[1].match(/currency\s*=\s*"([A-Z]{3})"/i) || [])[1];
      if (!cur) continue;
      const mult = parseFloat((r[1].match(/multiplier\s*=\s*"(\d+)"/i) || [])[1] || '1') || 1;
      const v = parseFloat(r[2]);
      if (Number.isFinite(v) && v > 0) rates[cur.toUpperCase()] = v / mult;
    }
    if (Object.keys(rates).length) out.push({ date: c[1], rates });
  }
  return out;
}

// Mai nap Europe/Bucharest szerint (YYYY-MM-DD).
function todayRo() {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest' }).format(new Date()); }
  catch (_) { return new Date().toISOString().slice(0, 10); }
}

function _pool() { return require('../db'); }

async function _fetchXml(url, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || 15000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'VallorSoft/1.0 (+https://vallorsoft.fly.dev)' } });
    if (!r.ok) { console.warn('[BNR] HTTP', r.status, url); return null; }
    return await r.text();
  } catch (e) {
    console.warn('[BNR] Lekérés hiba (' + url + '):', (e && e.message) || e);
    return null;
  } finally { clearTimeout(timer); }
}

// A feldolgozott napokat a DB-be menti (upsert). Visszaadja a mentett sorok számát.
async function storeRates(days) {
  let n = 0;
  if (!Array.isArray(days) || !days.length) return 0;
  const pool = _pool();
  for (const d of days) {
    for (const [cur, rate] of Object.entries(d.rates)) {
      try {
        await pool.query(
          `INSERT INTO bnr_rates (rate_date, currency, rate) VALUES ($1, $2, $3)
           ON CONFLICT (rate_date, currency) DO UPDATE SET rate = EXCLUDED.rate, fetched_at = NOW()`,
          [d.date, cur, rate]);
        n++;
      } catch (e) { console.warn('[BNR] Mentés hiba:', e.message); return n; }
    }
    if (d.rates.EUR && d.date === todayRo()) _cache = { rate: d.rates.EUR, date: todayRo(), ts: Date.now() };
  }
  return n;
}

// Napi szinkron: a mai (+ az utolsó 10 nap) árfolyamait menti. Az ütemező hívja.
async function syncDailyRates() {
  const xml = await _fetchXml('https://www.bnr.ro/nbrfxrates10days.xml')
    || await _fetchXml('https://www.bnr.ro/nbrfxrates.xml');
  const days = parseBnrXml(xml);
  const n = await storeRates(days);
  if (n) console.log('[BNR] Árfolyamok mentve:', n, 'sor,', days.length, 'nap');
  return n;
}

// Egy évnyi múltbeli árfolyam letöltése (régi bon dátumához). Óránként max 1×/év.
const _yearTried = new Map();
async function _backfillYear(year) {
  const k = String(year);
  const last = _yearTried.get(k) || 0;
  if (Date.now() - last < 60 * 60 * 1000) return 0;
  _yearTried.set(k, Date.now());
  const xml = await _fetchXml('https://www.bnr.ro/files/xml/years/nbrfxrates' + k + '.xml', 30000);
  return storeRates(parseBnrXml(xml));
}

async function _dbLookup(cur, date) {
  try {
    const r = await _pool().query(
      `SELECT rate, to_char(rate_date, 'YYYY-MM-DD') AS d FROM bnr_rates
        WHERE currency = $1 AND rate_date <= $2::date
        ORDER BY rate_date DESC LIMIT 1`, [cur, date]);
    if (!r.rows.length) return null;
    return { rate: Number(r.rows[0].rate), date: r.rows[0].d };
  } catch (e) { console.warn('[BNR] DB-lekérés hiba:', e.message); return null; }
}

function _daysBetween(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 86400000); }

// A `date` napra érvényes BNR árfolyam (RON / 1 egység): az aznapi, vagy ha
// aznap nem volt közzététel (hétvége/ünnep), az utolsó előtte közzétett.
// Visszaad: { currency, rate, date } vagy null (ismeretlen valuta / nincs adat).
async function getRateFor(currency, date) {
  const cur = String(currency || '').toUpperCase().trim();
  if (!/^[A-Z]{3}$/.test(cur)) return null;
  const today = todayRo();
  let d = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? String(date) : today;
  if (d > today) d = today;
  if (cur === 'RON') return { currency: 'RON', rate: 1, date: d };

  let hit = await _dbLookup(cur, d);
  if (hit && _daysBetween(hit.date, d) <= 4) return { currency: cur, ...hit };

  // Nincs friss adat → letöltés: közeli dátumnál a 10 napos, régebbinél az éves fájl.
  if (_daysBetween(d, today) <= 9) await syncDailyRates();
  else await _backfillYear(d.slice(0, 4));
  hit = await _dbLookup(cur, d);
  if (hit && _daysBetween(hit.date, d) <= 7) return { currency: cur, ...hit };
  return null;
}

module.exports = { fetchBnrEurRon, _extractEurRate, parseBnrXml, storeRates, syncDailyRates, getRateFor, todayRo };
