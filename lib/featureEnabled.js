// ============================================================
//  VallorSoft — lib/featureEnabled.js
//  Megosztott feature-kapcsoló ellenőrzés.
//  Hierarchia: company_features (cég-override) > plan_features (csomag) > true
//  NULL limit / hiányzó sor = engedélyezett (visszafelé kompatibilis).
// ============================================================
const pool = require('../db');

async function featureEnabled(companyId, key) {
  if (!companyId) return true;
  try {
    // 1. Cég-szintű override (felülírja a csomagot — egyedi beállítás)
    const cr = await pool.query(
      'SELECT enabled FROM company_features WHERE company_id=$1 AND feature_key=$2',
      [companyId, key]);
    if (cr.rows.length) return cr.rows[0].enabled !== false;
    // 2. Csomag-szintű alapértelmezés
    const pr = await pool.query(
      `SELECT pf.enabled FROM plan_features pf
         JOIN companies c ON c.subscription_plan_id = pf.plan_id
        WHERE c.id=$1 AND pf.feature_key=$2`, [companyId, key]);
    if (pr.rows.length) return pr.rows[0].enabled !== false;
    // 3. Default: engedélyezett
    return true;
  } catch (e) { return true; }
}

module.exports = { featureEnabled };
