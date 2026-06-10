// lib/herePool.js
// A HERE térkép-szolgáltatások KÖZÖS logikája (egyetlen igazságforrás).
// 4 alap szolgáltatás, közös 1000-es ingyenes pool/hó (IDŐREND szerint fogy),
// az árak a here_feature_flags táblából jönnek (EUR / 1000 tranzakció), így a
// developer szerkesztheti őket. Használja: route planner panel, developer fül, számlázás.
const pool = require('../db');

const FREE_POOL = 1000;
const SERVICE_ORDER = ['autocomplete', 'geocode', 'raster_tile', 'routing_truck'];
const DEFAULTS = {
  autocomplete:  { display_name: 'Autocomplete', description: 'Cím kereső javaslatok gépeléskor', price_eur: 3.00 },
  geocode:       { display_name: 'Geokódolás', description: 'Cím → koordináta feloldás', price_eur: 1.30 },
  raster_tile:   { display_name: 'Térkép csempék', description: 'Térkép megjelenítés (csempék)', price_eur: 0.10 },
  routing_truck: { display_name: 'Teherjármű útvonaltervezés', description: 'Truck routing számítás', price_eur: 3.00 },
};
const HU_MONTHS = ['január', 'február', 'március', 'április', 'május', 'június', 'július', 'augusztus', 'szeptember', 'október', 'november', 'december'];

function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function currentMonth() { return new Date().toISOString().slice(0, 7); }
function monthLabelHu(monthYear) {
  const m = /^(\d{4})-(\d{2})$/.exec(monthYear || '');
  return m ? (m[1] + '. ' + (HU_MONTHS[parseInt(m[2], 10) - 1] || m[2])) : (monthYear || '');
}

// A 4 szolgáltatás metaadata (ár a DB-ből, fallback a DEFAULTS-ból).
async function getServiceMeta() {
  let byKey = {};
  try {
    const rows = (await pool.query(
      'SELECT feature_key, display_name, description, price_per_1000, vat_percent FROM here_feature_flags WHERE feature_key = ANY($1)',
      [SERVICE_ORDER])).rows;
    rows.forEach((r) => { byKey[r.feature_key] = r; });
  } catch (e) { /* tábla hiánya esetén defaults */ }
  const meta = {};
  SERVICE_ORDER.forEach((k) => {
    const d = DEFAULTS[k]; const r = byKey[k] || {};
    meta[k] = {
      feature_key: k,
      display_name: r.display_name || d.display_name,
      description: r.description || d.description,
      price_eur: r.price_per_1000 != null ? parseFloat(r.price_per_1000) : d.price_eur,
      vat_percent: r.vat_percent != null ? parseFloat(r.vat_percent) : 21,
    };
  });
  return meta;
}

// Egy cég havi pool-elszámolása: szolgáltatásonkénti billable + költség (EUR) + per-user bontás.
async function computePool(companyId, monthYear) {
  const month = monthYear || currentMonth();
  const meta = await getServiceMeta();

  const rows = (await pool.query(
    'SELECT feature_key, transaction_count, logged_at FROM here_usage_log WHERE company_id = $1 AND month_year = $2 ORDER BY logged_at ASC',
    [companyId, month])).rows;

  let remaining = FREE_POOL;
  let totalUsed = 0;
  const totalBy = {}; const billableBy = {};
  SERVICE_ORDER.forEach((k) => { totalBy[k] = 0; billableBy[k] = 0; });
  rows.forEach((row) => {
    const k = row.feature_key; const c = row.transaction_count || 0;
    totalUsed += c;
    if (totalBy[k] == null) { totalBy[k] = 0; billableBy[k] = 0; }
    totalBy[k] += c;
    if (remaining >= c) { remaining -= c; }
    else { billableBy[k] += (c - remaining); remaining = 0; }
  });

  // per-user bontás szolgáltatásonként
  const ur = (await pool.query(
    `SELECT l.feature_key, COALESCE(u.nume, 'Ismeretlen felhasználó') AS user_name,
            COALESCE(u.pozicio, '—') AS user_role, SUM(l.transaction_count)::int AS used
     FROM here_usage_log l LEFT JOIN users u ON u.id = l.user_id
     WHERE l.company_id = $1 AND l.month_year = $2
     GROUP BY l.feature_key, l.user_id, u.nume, u.pozicio ORDER BY used DESC`,
    [companyId, month])).rows;
  const usersBy = {};
  ur.forEach((r) => { (usersBy[r.feature_key] = usersBy[r.feature_key] || []).push({ user_name: r.user_name, user_role: r.user_role, used: r.used }); });

  let tNet = 0, tVat = 0;
  const services = SERVICE_ORDER.map((k) => {
    const m = meta[k];
    const billable = billableBy[k] || 0;
    const units = Math.ceil(billable / 1000) || 0;
    const net = units * m.price_eur;
    const vat = net * (m.vat_percent / 100);
    tNet += net; tVat += vat;
    return {
      feature_key: k, display_name: m.display_name, description: m.description,
      price_eur: m.price_eur, vat_percent: m.vat_percent,
      total_used: totalBy[k] || 0, billable_trx: billable, units: units,
      net_eur: net.toFixed(2), vat_eur: vat.toFixed(2), gross_eur: (net + vat).toFixed(2),
      users: usersBy[k] || [],
    };
  });

  return {
    month: month, month_label: monthLabelHu(month),
    free_pool_total: FREE_POOL, free_pool_used: totalUsed, free_pool_remaining: Math.max(0, FREE_POOL - totalUsed),
    services,
    total_net_eur: tNet.toFixed(2), total_vat_eur: tVat.toFixed(2), total_gross_eur: (tNet + tVat).toFixed(2),
  };
}

module.exports = { FREE_POOL, SERVICE_ORDER, DEFAULTS, getServiceMeta, computePool, r2, monthLabelHu, currentMonth };
