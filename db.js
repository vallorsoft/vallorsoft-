// ============================================================
//  VallorSoft — Adatbázis pool (megosztott)
//  Kivágva a régi server.js-ből, a kód-törzs változatlan.
// ============================================================
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

module.exports = pool;
