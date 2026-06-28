// ============================================================
//  Require-sweep — MINDEN szerver-modul betöltődik-e hibamentesen.
//  A korábban kézzel futtatott „require-sweep" automatizált változata:
//  syntax-/betöltési hibát (pl. elgépelt require, hibás export) azonnal
//  elkap. A ../db mockolva, hogy ne nyíljon valódi pg-pool kapcsolat.
// ============================================================
jest.mock('../../db', () => require('../helpers/db-mock').pool);

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const DIRS = ['handlers', 'routes', 'services', 'lib', 'middleware'];

function listJs(dir) {
  const out = [];
  (function walk(d) {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p);
      else if (f.name.endsWith('.js')) out.push(p);
    }
  })(path.join(ROOT, dir));
  return out;
}

describe('require-sweep: minden szerver-modul betöltődik', () => {
  const files = DIRS.flatMap(listJs);

  test('van mit ellenőrizni (>50 modul)', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  test.each(files.map((f) => path.relative(ROOT, f)))('require: %s', (rel) => {
    expect(() => require(path.join(ROOT, rel))).not.toThrow();
  });
});
