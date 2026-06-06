// ============================================================
//  Teszt-helper — pg pool mock
//  A route-ok a `../db` poolt használják (module.exports = pool).
//  A teszt fájlokban:
//     jest.mock('../../db', () => require('../helpers/db-mock').pool);
//  majd a pool.query.mockResolvedValueOnce(rows([...])) hívásokkal
//  állítjuk be a várt DB-válaszokat. Éles DB NEM kell.
// ============================================================

// Egyetlen megosztott mock pool — a query egy jest.fn.
const pool = { query: jest.fn() };

// Kényelmi segéd: pg-szerű eredmény ({ rows, rowCount }).
function rows(arr) {
  return { rows: arr || [], rowCount: (arr || []).length };
}

// Állítsd vissza a mockot tesztek között.
function reset() {
  pool.query.mockReset();
}

module.exports = { pool, rows, reset };
