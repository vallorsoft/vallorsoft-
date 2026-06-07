// ============================================================
//  VallorSoft — handlers/hereFeatureHandlers.js
//  HERE prémium funkciók: státusz + havi használat + becsült költség,
//  és (csak developer) be/ki kapcsolás.
// ============================================================
const pool = require('../db');

const handlers = {};

// Minden funkció + aktuális havi használat + becsült költség.
handlers.getHereFeatures = async function (req, res, args) {
  try {
    if (!req.session.user) return res.json({ result: { ok: false, err: 'Nincs bejelentkezve' } });
    const r = await pool.query(`
      SELECT f.feature_key, f.display_name, f.description, f.enabled, f.free_limit, f.price_per_1000,
             COALESCE(SUM(u.transaction_count), 0)::int AS used_this_month
      FROM here_feature_flags f
      LEFT JOIN here_usage_log u
        ON f.feature_key = u.feature_key AND u.month_year = TO_CHAR(NOW(), 'YYYY-MM')
      GROUP BY f.feature_key, f.display_name, f.description, f.enabled, f.free_limit, f.price_per_1000
      ORDER BY f.feature_key
    `);
    const features = r.rows.map(function (f) {
      const used = f.used_this_month || 0;
      const free = f.free_limit || 0;
      const price = parseFloat(f.price_per_1000) || 0;
      const remaining_free = Math.max(0, free - used);
      const billable = Math.max(0, used - free);
      const cost_usd = Math.round((billable / 1000) * price * 100) / 100;
      const usage_percent = free > 0 ? Math.min(100, Math.round((used / free) * 100)) : (used > 0 ? 100 : 0);
      return {
        feature_key: f.feature_key, display_name: f.display_name, description: f.description,
        enabled: f.enabled, free_limit: free, price_per_1000: price,
        used_this_month: used, remaining_free, billable, cost_usd, usage_percent,
      };
    });
    const total_cost = Math.round(features.reduce(function (s, f) { return s + f.cost_usd; }, 0) * 100) / 100;
    const is_dev = !!(req.session.user.is_dev || req.session.user.pozicio === 'Developer');
    return res.json({ result: { ok: true, features, total_cost, is_dev } });
  } catch (err) {
    console.error('getHereFeatures hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
  }
};

// Funkció be/ki — CSAK developer.
handlers.toggleHereFeature = async function (req, res, args) {
  try {
    if (!req.session.user || (req.session.user.pozicio !== 'Developer' && !req.session.user.is_dev)) {
      return res.json({ result: { ok: false, err: 'Csak developer módosíthatja' } });
    }
    const a = Array.isArray(args) ? (args[0] || {}) : (args || {});
    const key = String(a.feature_key || '').trim();
    const enabled = !!a.enabled;
    if (!key) return res.json({ result: { ok: false, err: 'Hiányzó feature_key' } });
    const r = await pool.query(
      'UPDATE here_feature_flags SET enabled = $1, updated_at = now() WHERE feature_key = $2',
      [enabled, key]
    );
    if (!r.rowCount) return res.json({ result: { ok: false, err: 'Ismeretlen funkció' } });
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('toggleHereFeature hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
  }
};

// A SAJÁT cég HERE-szolgáltatás használata és díja (a route planner paneljéhez).
// 4 alap szolgáltatás (autocomplete, geocode, raster_tile, routing_truck), KÖZÖS 1000-es
// ingyenes pool/hó, IDŐREND szerint fogy (logged_at). Árak EUR-ban. NINCS toggle.
const HERE_HU_MONTHS = ['január', 'február', 'március', 'április', 'május', 'június', 'július', 'augusztus', 'szeptember', 'október', 'november', 'december'];
const HERE_SERVICES = {
  autocomplete:  { display_name: 'Autocomplete', description: 'Cím kereső javaslatok gépeléskor', price_eur: 3.00 },
  geocode:       { display_name: 'Geokódolás', description: 'Cím → koordináta feloldás', price_eur: 1.30 },
  raster_tile:   { display_name: 'Térkép csempék', description: 'Térkép megjelenítés (csempék)', price_eur: 0.10 },
  routing_truck: { display_name: 'Teherjármű útvonaltervezés', description: 'Truck routing számítás', price_eur: 3.00 },
};
const HERE_SERVICE_ORDER = ['autocomplete', 'geocode', 'raster_tile', 'routing_truck'];
const HERE_FREE_POOL = 1000;

handlers.getMyHereUsage = async function (req, res, args) {
  try {
    if (!req.session.user) return res.json({ result: { ok: false, err: 'Nincs bejelentkezve' } });
    const cid = req.session.user.company_id;
    const month = new Date().toISOString().slice(0, 7);
    const rows = (await pool.query(
      `SELECT feature_key, transaction_count, logged_at FROM here_usage_log
       WHERE company_id = $1 AND month_year = $2 ORDER BY logged_at ASC`, [cid, month])).rows;

    let remaining = HERE_FREE_POOL;
    let totalUsed = 0;
    const totalBy = {}; const billableBy = {};
    HERE_SERVICE_ORDER.forEach((k) => { totalBy[k] = 0; billableBy[k] = 0; });
    rows.forEach((row) => {
      const k = row.feature_key;
      const count = row.transaction_count || 0;
      totalUsed += count;
      if (totalBy[k] == null) { totalBy[k] = 0; billableBy[k] = 0; }
      totalBy[k] += count;
      if (remaining >= count) { remaining -= count; }
      else { billableBy[k] += (count - remaining); remaining = 0; }
    });

    let tNet = 0, tVat = 0;
    const services = HERE_SERVICE_ORDER.map((k) => {
      const s = HERE_SERVICES[k];
      const billable = billableBy[k] || 0;
      const units = Math.ceil(billable / 1000) || 0;
      const net = units * s.price_eur;
      const vat = net * 0.21;
      tNet += net; tVat += vat;
      return {
        feature_key: k, display_name: s.display_name, description: s.description,
        total_used: totalBy[k] || 0, billable_trx: billable, units: units,
        price_eur: s.price_eur, net_eur: net.toFixed(2), vat_eur: vat.toFixed(2), gross_eur: (net + vat).toFixed(2),
      };
    });

    const m = /^(\d{4})-(\d{2})$/.exec(month);
    const monthLabel = m ? (m[1] + '. ' + (HERE_HU_MONTHS[parseInt(m[2], 10) - 1] || m[2])) : month;

    return res.json({ result: {
      ok: true, month: monthLabel,
      free_pool_total: HERE_FREE_POOL,
      free_pool_used: totalUsed,
      free_pool_remaining: Math.max(0, HERE_FREE_POOL - totalUsed),
      services,
      total_net_eur: tNet.toFixed(2), total_vat_eur: tVat.toFixed(2), total_gross_eur: (tNet + tVat).toFixed(2),
    } });
  } catch (err) {
    console.error('getMyHereUsage hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
  }
};

// Admin/Manager: SAJÁT cég HERE-funkció be/ki kapcsolása (herepref). Csak jogosult funkcióra.
handlers.setMyHerePref = async function (req, res, args) {
  try {
    if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
      return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
    }
    const cid = req.session.user.company_id;
    const a = Array.isArray(args) ? (args[0] || {}) : (args || {});
    const key = String(a.feature_key || '').trim();
    const enabled = !!a.enabled;
    if (!key) return res.json({ result: { ok: false, err: 'Hiányzó funkció' } });
    const f = await pool.query('SELECT 1 FROM here_feature_flags WHERE feature_key = $1', [key]);
    if (!f.rows.length) return res.json({ result: { ok: false, err: 'Ismeretlen funkció' } });
    // Jogosultság-ellenőrzés (a developer engedélyezte-e a cégnek)
    const ent = await pool.query("SELECT enabled FROM company_features WHERE company_id = $1 AND feature_key = $2", [cid, 'here:' + key]);
    const entitled = ent.rows.length ? ent.rows[0].enabled !== false : true;
    if (!entitled) return res.json({ result: { ok: false, err: 'Ezt a funkciót a szolgáltató nem engedélyezte a cégednek.' } });
    await pool.query(
      `INSERT INTO company_features (company_id, feature_key, enabled, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (company_id, feature_key) DO UPDATE SET enabled = $3, updated_at = now()`,
      [cid, 'herepref:' + key, enabled]
    );
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('setMyHerePref hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
  }
};

module.exports = handlers;
