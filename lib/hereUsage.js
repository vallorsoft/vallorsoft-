// lib/hereUsage.js
// HERE prémium funkciók használat-naplózása (here_usage_log).
// Belső segéd — más handlerekből hívható (NEM /api/execute handler).
const pool = require('../db');

// Csak ténylegesen lefutott (enabled) funkciónál hívd!
// companyId: cégenkénti számlázáshoz; userId: felhasználó-szintű követéshez.
async function logHereTransaction(featureKey, count, companyId, userId) {
  try {
    await pool.query(
      `INSERT INTO here_usage_log (feature_key, transaction_count, month_year, company_id, user_id)
       VALUES ($1, $2, TO_CHAR(NOW(), 'YYYY-MM'), $3, $4)`,
      [featureKey, count || 1, companyId || null, userId || null]
    );
  } catch (e) {
    console.error('logHereTransaction hiba:', e.message);
  }
}

module.exports = { logHereTransaction };
