require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function test() {
  try {
    const result = await pool.query('SELECT NOW() as ido, version() as verzio');
    console.log('Sikeres kapcsolat a Neon DB-vel!');
    console.log('Szerver ido:', result.rows[0].ido);
    console.log('Postgres verzio:', result.rows[0].verzio);
  } catch (err) {
    console.error('Hiba a kapcsolodaskor:', err.message);
  } finally {
    await pool.end();
  }
}

test();