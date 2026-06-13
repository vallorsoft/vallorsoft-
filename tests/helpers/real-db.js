// ============================================================
//  Teszt-helper — VALÓDI Postgres betöltése a tesztekhez.
//  A séma + minden db/*.sql migráció ugyanúgy fut le, mint a
//  szerver indulásakor (schema.sql ELŐSZÖR, majd a migrációk 2
//  menetben, idempotensen). Csak akkor használjuk, ha van
//  DATABASE_URL — különben a hozzá tartozó suite-ot kihagyjuk.
// ============================================================
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');

async function loadSchema(pool) {
  await pool.query(fs.readFileSync(path.join(ROOT, 'schema.sql'), 'utf8'));
  const dir = path.join(ROOT, 'db');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (let pass = 1; pass <= 2; pass++) {
    for (const f of files) {
      try { await pool.query(fs.readFileSync(path.join(dir, f), 'utf8')); }
      catch (e) { if (pass === 2) console.error('migr ' + f + ': ' + e.message.split('\n')[0]); }
    }
  }
}

// A tesztek között üríti a használt táblákat (CASCADE — a függő sorok is).
async function truncateAll(pool) {
  await pool.query(
    'TRUNCATE orders, order_legs, warehouse_items, vehicles, fuvarlevelek, users, companies RESTART IDENTITY CASCADE'
  );
}

function hasDb() { return !!process.env.DATABASE_URL; }

module.exports = { loadSchema, truncateAll, hasDb };
