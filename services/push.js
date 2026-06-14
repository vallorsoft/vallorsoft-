// ============================================================
//  VallorSoft — Push küldő segédfüggvények
//  Kivágva a régi server.js-ből, a kód-törzs változatlan.
// ============================================================
const pool = require('../db');
const webpush = require('./webpush');

async function sendPushToEmail(emails, payload) {
  if (!webpush) return;
  if (!Array.isArray(emails)) emails = [emails];
  if (!emails.length) return;

  try {
    const placeholders = emails.map((_, i) => '$' + (i + 1)).join(',');
    const r = await pool.query(
      `SELECT id, subscription FROM push_subscriptions WHERE email IN (${placeholders})`,
      emails
    );
    if (!r.rows.length) return;

    const payloadStr = JSON.stringify(payload);
    const sends = r.rows.map(async (row) => {
      try {
        const sub = typeof row.subscription === 'string'
          ? JSON.parse(row.subscription)
          : row.subscription;
        await webpush.sendNotification(sub, payloadStr);
      } catch (err) {
        // 410 Gone = subscription lejart, toroljuk
        if (err.statusCode === 410 || err.statusCode === 404) {
          await pool.query('DELETE FROM push_subscriptions WHERE id = $1', [row.id]);
          console.log('Push subscription torolve (lejart):', row.id);
        } else {
          console.error('Push kuldesi hiba:', err.message);
        }
      }
    });
    await Promise.allSettled(sends);
  } catch(err) {
    console.error('sendPushToEmail hiba:', err);
  }
}

// Push kuldese csoport (company_id + szerepkor) alapjan
async function sendPushToRole(companyId, roles, payload) {
  if (!webpush || !companyId) return;
  if (!Array.isArray(roles)) roles = [roles];
  try {
    const r = await pool.query(
      `SELECT ps.id, ps.subscription FROM push_subscriptions ps
       JOIN users u ON u.email = ps.email AND u.company_id = ps.company_id
       WHERE ps.company_id = $1 AND u.pozicio = ANY($2)`,
      [companyId, roles]
    );
    if (!r.rows.length) return;
    const payloadStr = JSON.stringify(payload);
    const sends = r.rows.map(async (row) => {
      try {
        const sub = typeof row.subscription === 'string'
          ? JSON.parse(row.subscription)
          : row.subscription;
        await webpush.sendNotification(sub, payloadStr);
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await pool.query('DELETE FROM push_subscriptions WHERE id = $1', [row.id]);
        }
      }
    });
    await Promise.allSettled(sends);
  } catch(err) {
    console.error('sendPushToRole hiba:', err);
  }
}

module.exports = { sendPushToEmail, sendPushToRole };
