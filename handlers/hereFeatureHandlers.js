// ============================================================
//  VallorSoft — handlers/hereFeatureHandlers.js
//  HERE térkép-szolgáltatások: havi használat + díj (közös 1000-es pool),
//  és (csak developer) szolgáltatás-ár szerkesztés. A logika a lib/herePool.js-ben.
// ============================================================
const pool = require('../db');
const { computePool, getServiceMeta, SERVICE_ORDER, FREE_POOL } = require('../lib/herePool');

function isDev(u) { return !!(u && (u.is_dev || u.pozicio === 'Developer')); }

const handlers = {};

// A SAJÁT cég havi HERE-használata + díja (route planner panel).
handlers.getMyHereUsage = async function (req, res, args) {
  try {
    if (!req.session.user) return res.json({ result: { ok: false, err: 'Nincs bejelentkezve' } });
    const p = await computePool(req.session.user.company_id);
    return res.json({ result: {
      ok: true,
      month: p.month_label,
      free_pool_total: p.free_pool_total, free_pool_used: p.free_pool_used, free_pool_remaining: p.free_pool_remaining,
      services: p.services.map((s) => ({
        feature_key: s.feature_key, display_name: s.display_name, description: s.description,
        price_eur: s.price_eur, total_used: s.total_used, billable_trx: s.billable_trx, units: s.units,
        net_eur: s.net_eur, vat_eur: s.vat_eur, gross_eur: s.gross_eur,
      })),
      total_net_eur: p.total_net_eur, total_vat_eur: p.total_vat_eur, total_gross_eur: p.total_gross_eur,
    } });
  } catch (err) {
    console.error('getMyHereUsage hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
  }
};

// Developer: a 4 szolgáltatás metaadata (árszerkesztőhöz).
handlers.getHereServices = async function (req, res, args) {
  try {
    if (!isDev(req.session.user)) return res.json({ result: { ok: false, err: 'Csak developer' } });
    const meta = await getServiceMeta();
    return res.json({ result: { ok: true, free_pool_total: FREE_POOL, services: SERVICE_ORDER.map((k) => meta[k]) } });
  } catch (err) {
    console.error('getHereServices hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
  }
};

// Developer: szolgáltatás-ár (EUR / 1000) + ÁFA módosítása.
handlers.updateHereServicePrice = async function (req, res, args) {
  try {
    if (!isDev(req.session.user)) return res.json({ result: { ok: false, err: 'Csak developer' } });
    const a = Array.isArray(args) ? (args[0] || {}) : (args || {});
    const key = String(a.feature_key || '').trim();
    if (SERVICE_ORDER.indexOf(key) < 0) return res.json({ result: { ok: false, err: 'Ismeretlen szolgáltatás' } });
    const price = parseFloat(a.price_eur);
    if (!Number.isFinite(price) || price < 0) return res.json({ result: { ok: false, err: 'Érvénytelen ár' } });
    const vat = (a.vat_percent != null && Number.isFinite(parseFloat(a.vat_percent))) ? parseFloat(a.vat_percent) : null;
    if (vat != null) {
      await pool.query('UPDATE here_feature_flags SET price_per_1000 = $1, vat_percent = $2, updated_at = now() WHERE feature_key = $3', [price, vat, key]);
    } else {
      await pool.query('UPDATE here_feature_flags SET price_per_1000 = $1, updated_at = now() WHERE feature_key = $2', [price, key]);
    }
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('updateHereServicePrice hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
  }
};

module.exports = handlers;
