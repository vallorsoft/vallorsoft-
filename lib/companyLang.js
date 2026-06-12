// ============================================================
//  VallorSoft — lib/companyLang.js
//  A cég e-mail-nyelve (companies.email_lang) — admin állítja, alap 'ro'.
//  A meghívó/jelszó-e-mailek ez alapján RO/HU-ban mennek.
// ============================================================
const pool = require('../db');
async function emailLang(companyId) {
  if (!companyId) return 'ro';
  try {
    const r = await pool.query('SELECT email_lang FROM companies WHERE id = $1', [companyId]);
    return (r.rows[0] && r.rows[0].email_lang === 'hu') ? 'hu' : 'ro';
  } catch (e) { return 'ro'; }
}
module.exports = { emailLang };
