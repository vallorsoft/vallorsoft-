// ============================================================
//  VallorSoft — lib/siteDwell.js
//  Cégenként tanult rakodási / ürítési idő: a GPS-ből felismert (auto /
//  elfogadott) állomások tényleges állás-ideje (gps_arrived_at → gps_left_at),
//  partner-cégenként és fajtánként (felrakás / lerakás), medián, utolsó 180 nap.
//  A pihenő (≥ 8 óra) és a pillanatnyi megállás (< 3 perc) nem számít.
//  Felhasználás: tervezőtábla (a fuvar-sáv buborékja). company_id-szűrt,
//  paraméteres; 30 perces memória-cache cégenként.
// ============================================================
const pool = require('../db');
const sm = require('./stopMatch');

const TTL_MS = 30 * 60 * 1000;
const MIN_SAMPLES = 2;
const _cache = new Map();

const firmaKey = (f) => sm.firmaTokens(f).join(' ');

// A nyers sorokból (firma, kind, perc) → { 'pickup|kulcs': {min, n} } — tiszta, tesztelhető
function aggregate(rows) {
  const groups = new Map();
  for (const r of rows || []) {
    const k = firmaKey(r.firma);
    const m = Number(r.minutes);
    if (!k || !isFinite(m) || m < 3 || m > 8 * 60) continue;
    const key = (r.kind === 'pickup' ? 'pickup' : 'delivery') + '|' + k;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  const out = {};
  for (const [key, arr] of groups) {
    if (arr.length < MIN_SAMPLES) continue;
    arr.sort((a, b) => a - b);
    const mid = Math.floor(arr.length / 2);
    const med = arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
    out[key] = { min: Math.round(med), n: arr.length };
  }
  return out;
}

async function stats(cid) {
  const c = _cache.get(cid);
  if (c && Date.now() - c.t < TTL_MS) return c.v;
  let v = {};
  try {
    const { rows } = await pool.query(
      `SELECT firma, kind, EXTRACT(EPOCH FROM (gps_left_at - gps_arrived_at)) / 60 AS minutes
         FROM order_stops
        WHERE company_id = $1 AND match_status IN ('auto','confirmed')
          AND gps_arrived_at IS NOT NULL AND gps_left_at IS NOT NULL
          AND COALESCE(firma,'') <> '' AND gps_arrived_at > NOW() - INTERVAL '180 days'
        LIMIT 20000`, [cid]);
    v = aggregate(rows);
  } catch (e) { if (!(e && (e.code === '42703' || e.code === '42P01'))) console.warn('[SiteDwell] hiba', e.message); }
  _cache.set(cid, { t: Date.now(), v });
  return v;
}

function lookup(map, kind, firma) {
  const k = firmaKey(firma);
  return (k && map && map[kind + '|' + k]) || null;
}

module.exports = { stats, aggregate, lookup, firmaKey };
