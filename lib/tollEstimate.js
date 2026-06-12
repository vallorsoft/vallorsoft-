// ============================================================
//  VallorSoft — lib/tollEstimate.js
//  Útdíj-becslés a fuvar útvonalából: a polyline-t országonkénti km-re
//  bontja (rács-cache-elt reverse-geokódolás, Photon), és a cég útdíj-
//  rátáival kiszámolja a díjat. Ingyenes, kulcs nélkül; a becslés mindig
//  kézzel felülírható. NEM hatósági pontosságú.
// ============================================================
const pool = require('../db');

const UA = 'VallorSoft/1.0 (flottakezelo)';
const TIMEOUT_MS = 12000;

// EU teherautó (>12 t) útdíj-alapértékek — a cég felülírhatja (toll_rates).
// mode: 'perkm' (€/km) | 'vignette' (fix €/fuvar, ha bármennyi km esik rá).
const DEFAULT_RATES = {
  DE: { mode: 'perkm', eur_per_km: 0.35 },   // LKW-Maut
  AT: { mode: 'perkm', eur_per_km: 0.42 },   // GO-Maut
  HU: { mode: 'perkm', eur_per_km: 0.28 },   // HU-GO
  FR: { mode: 'perkm', eur_per_km: 0.22 },
  IT: { mode: 'perkm', eur_per_km: 0.20 },
  PL: { mode: 'perkm', eur_per_km: 0.12 },   // e-TOLL
  CZ: { mode: 'perkm', eur_per_km: 0.20 },
  SK: { mode: 'perkm', eur_per_km: 0.22 },
  SI: { mode: 'perkm', eur_per_km: 0.30 },   // DARS
  BE: { mode: 'perkm', eur_per_km: 0.18 },   // Viapass
  NL: { mode: 'perkm', eur_per_km: 0.00 },   // (nincs általános km-díj)
  RO: { mode: 'vignette', vignette_eur: 8 }, // rovinietă (idő-alapú, ~heti)
  BG: { mode: 'vignette', vignette_eur: 10 },
  HR: { mode: 'perkm', eur_per_km: 0.25 },
  ES: { mode: 'perkm', eur_per_km: 0.15 },
  CH: { mode: 'perkm', eur_per_km: 0.65 },   // LSVA (drága)
};

const COUNTRY_NAME = {
  DE: 'Németország', AT: 'Ausztria', HU: 'Magyarország', FR: 'Franciaország', IT: 'Olaszország',
  PL: 'Lengyelország', CZ: 'Csehország', SK: 'Szlovákia', SI: 'Szlovénia', BE: 'Belgium',
  NL: 'Hollandia', RO: 'Románia', BG: 'Bulgária', HR: 'Horvátország', ES: 'Spanyolország', CH: 'Svájc',
};

function haversineKm(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad, dLng = (b[1] - a[1]) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

async function jsonGet(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA } });
    return await res.json().catch(() => ({}));
  } finally { clearTimeout(t); }
}

// lat/lng → ISO2 ország-kód, 0.5°-os rács-cache-sel (geo_country_cache).
async function countryForPoint(lat, lng, budget) {
  const cell = (Math.round(lat * 2) / 2).toFixed(1) + ',' + (Math.round(lng * 2) / 2).toFixed(1);
  const c = await pool.query('SELECT country_code FROM geo_country_cache WHERE cell = $1', [cell]);
  if (c.rows.length) return c.rows[0].country_code || null;
  if (budget.left <= 0) { budget.skipped++; return null; }
  budget.left--;
  let cc = null;
  try {
    const d = await jsonGet('https://photon.komoot.io/reverse?lat=' + lat + '&lon=' + lng);
    const p = ((d.features || [])[0] || {}).properties || {};
    cc = (p.countrycode || '').toUpperCase().slice(0, 2) || null;
  } catch (_) { cc = null; }
  await pool.query('INSERT INTO geo_country_cache (cell, country_code) VALUES ($1,$2) ON CONFLICT (cell) DO NOTHING',
    [cell, cc]).catch(() => {});
  return cc;
}

// A cég rátái (DEFAULT_RATES + a toll_rates felülírások) → { CC: {mode, eur_per_km, vignette_eur} }
async function getRates(companyId) {
  const rates = {};
  Object.keys(DEFAULT_RATES).forEach((cc) => { rates[cc] = Object.assign({}, DEFAULT_RATES[cc]); });
  try {
    const r = await pool.query(
      'SELECT country_code, mode, eur_per_km, vignette_eur FROM toll_rates WHERE company_id = $1', [companyId]);
    r.rows.forEach((row) => {
      const cc = String(row.country_code || '').toUpperCase();
      rates[cc] = {
        mode: row.mode === 'vignette' ? 'vignette' : 'perkm',
        eur_per_km: row.eur_per_km != null ? parseFloat(row.eur_per_km) : 0,
        vignette_eur: row.vignette_eur != null ? parseFloat(row.vignette_eur) : 0,
      };
    });
  } catch (_) { /* a default rátákkal megyünk tovább */ }
  return rates;
}

// polyline [[lat,lng],...] → { total, byCountry:[{cc, name, km, mode, cost}], pending }
// A km-et ~SAMPLE_KM-enként mintavételezett ország-kódhoz rendeljük.
async function estimateFromPolyline(companyId, polyline) {
  const rates = await getRates(companyId);
  const out = { total: 0, byCountry: [], pending: 0 };
  if (!Array.isArray(polyline) || polyline.length < 2) return out;

  const SAMPLE_KM = 25;
  const budget = { left: 80, skipped: 0 };
  const kmByCc = {};
  let acc = 0, lastCc = null;
  // az első pont országa
  lastCc = await countryForPoint(polyline[0][0], polyline[0][1], budget);
  for (let i = 1; i < polyline.length; i++) {
    const seg = haversineKm(polyline[i - 1], polyline[i]);
    acc += seg;
    if (acc >= SAMPLE_KM || i === polyline.length - 1) {
      const cc = await countryForPoint(polyline[i][0], polyline[i][1], budget) || lastCc;
      if (cc) { kmByCc[cc] = (kmByCc[cc] || 0) + acc; lastCc = cc; }
      acc = 0;
    }
  }
  out.pending = budget.skipped;

  Object.keys(kmByCc).forEach((cc) => {
    const km = Math.round(kmByCc[cc]);
    const r = rates[cc] || { mode: 'perkm', eur_per_km: 0 };
    let cost = 0;
    if (r.mode === 'vignette') cost = parseFloat(r.vignette_eur) || 0;
    else cost = km * (parseFloat(r.eur_per_km) || 0);
    cost = Math.round(cost);
    out.byCountry.push({ cc, name: COUNTRY_NAME[cc] || cc, km, mode: r.mode, cost });
    out.total += cost;
  });
  out.byCountry.sort((a, b) => b.km - a.km);
  out.total = Math.round(out.total);
  return out;
}

module.exports = { estimateFromPolyline, getRates, DEFAULT_RATES, COUNTRY_NAME };
