// ============================================================
//  VallorSoft — lib/planLimits.js
//  Előfizetési csomag-limitek kikényszerítése a create-utakon.
//  NULL limit (vagy nincs csomag) = korlátlan → visszafelé kompatibilis.
//  Visszaad: { ok, limit, used } — ok=true, ha nincs limit VAGY used < limit.
// ============================================================
const pool = require('../db');

// 0 = TILTOTT (nincs engedély); NULL = korlátlan. Csak a pozitív egész szám korlát.
const LIMIT_COL = {
  users:        'max_users',
  vehicles:     'max_vehicles',
  orders_month: 'max_orders_per_month',
  sofors:       'max_sofors',
};

async function checkLimit(cid, kind, dbc) {
  const q = dbc || pool;
  const col = LIMIT_COL[kind];
  if (!col || !cid) return { ok: true, limit: null, used: null };

  const pr = await q.query(
    `SELECT sp.${col} AS lim
       FROM companies c
       JOIN subscription_plans sp ON sp.id = c.subscription_plan_id
      WHERE c.id = $1`, [cid]);
  const rawLim = pr.rows.length ? pr.rows[0].lim : null;
  if (rawLim == null) return { ok: true, limit: null, used: null }; // nincs csomag / nincs limit

  const limit = parseInt(rawLim, 10);
  let used = 0;
  if (kind === 'users') {
    used = (await q.query('SELECT COUNT(*)::int AS n FROM users WHERE company_id = $1', [cid])).rows[0].n;
  } else if (kind === 'vehicles') {
    used = (await q.query('SELECT COUNT(*)::int AS n FROM vehicles WHERE company_id = $1', [cid])).rows[0].n;
  } else if (kind === 'orders_month') {
    used = (await q.query(
      "SELECT COUNT(*)::int AS n FROM orders WHERE company_id = $1 AND created_at >= date_trunc('month', NOW())", [cid])).rows[0].n;
  } else if (kind === 'sofors') {
    used = (await q.query("SELECT COUNT(*)::int AS n FROM users WHERE company_id=$1 AND pozicio='Sofer'", [cid])).rows[0].n;
  }
  return { ok: used < limit, limit: limit, used: used };
}

module.exports = { checkLimit };
