require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

// IDE IRD BE A SAJAT ADATAIDAT
const ADMIN_NAME = 'Admin Felhasznalo';
const ADMIN_EMAIL = 'vallorsoft@gmail.com';
const ADMIN_PHONE = '+40700000000';
const ADMIN_PASSWORD = 'vallorteam25';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function createAdmin() {
  try {
    // jelszo hash-elese
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);

    // beszuras a DB-be
    const result = await pool.query(
      `INSERT INTO users (nume, email, tel, pozicio, password_hash)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, pozicio`,
      [ADMIN_NAME, ADMIN_EMAIL.toLowerCase(), ADMIN_PHONE, 'Admin', passwordHash]
    );

    console.log('Admin felhasznalo letrehozva!');
    console.log('ID:', result.rows[0].id);
    console.log('Email:', result.rows[0].email);
    console.log('Pozicio:', result.rows[0].pozicio);
    console.log('');
    console.log('FONTOS: Most lepj be ezzel az email-jelszo parossal.');
  } catch (err) {
    if (err.code === '23505') {
      console.error('Ez az email mar letezik a DB-ben!');
    } else {
      console.error('Hiba:', err.message);
    }
  } finally {
    await pool.end();
  }
}

createAdmin();