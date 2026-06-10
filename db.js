// ============================================================
//  VallorSoft — Adatbázis pool (megosztott)
//  Kivágva a régi server.js-ből, a kód-törzs változatlan.
// ============================================================
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  keepAlive: true,
});

// Managed Postgres (Neon/Render) eldobhatja az idle kapcsolatokat — kezelő
// nélkül az 'error' esemény az egész Node folyamatot leállítaná.
pool.on('error', (err) => {
  console.error('PG pool idle kliens hiba (a szerver tovább fut):', err.message);
});

module.exports = pool;
