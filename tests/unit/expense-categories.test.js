// ============================================================
//  Kiadás-kategóriák — a szerver és a kliens listája NEM csúszhat szét
// ============================================================
const fs = require('fs');
const path = require('path');
const { EXPENSE_CATEGORIES, normalizeCategory } = require('../../lib/expenseCategories');

const ROOT = path.join(__dirname, '..', '..');

describe('expense categories', () => {
  test('REGRESSZIÓ-ŐR: a kliens-lista (public/expense-cat.js) egyezik a szerverrel', () => {
    const src = fs.readFileSync(path.join(ROOT, 'public', 'expense-cat.js'), 'utf8');
    const m = src.match(/window\.VS_EXPENSE_CATS\s*=\s*\[([\s\S]*?)\]/);
    expect(m).toBeTruthy();
    const clientCats = [...m[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1]);
    expect(clientCats).toEqual(EXPENSE_CATEGORIES);
  });

  test('REGRESSZIÓ-ŐR: minden kategóriának van i18n kulcsa (RO+HU)', () => {
    const i18n = fs.readFileSync(path.join(ROOT, 'public', 'i18n.js'), 'utf8');
    EXPENSE_CATEGORIES.forEach(k => {
      const re = new RegExp("'sof\\.cat\\." + k + "':\\s*\\{[^}]*hu:[^}]*ro:[^}]*\\}");
      expect(i18n).toMatch(re);
    });
  });

  test('REGRESSZIÓ-ŐR: a nyomtatott menetlevél RO felirata is teljes', () => {
    const src = fs.readFileSync(path.join(ROOT, 'routes', 'soferApi.js'), 'utf8');
    const m = src.match(/const CAT_RO = \{([\s\S]*?)\};/);
    expect(m).toBeTruthy();
    EXPENSE_CATEGORIES.forEach(k => expect(m[1]).toMatch(new RegExp('\\b' + k + ':')));
  });

  test('normalizeCategory: fehérlista, ismeretlen → altele', () => {
    expect(normalizeCategory('taxa_drum')).toBe('taxa_drum');
    expect(normalizeCategory('TAXA_DRUM')).toBe('taxa_drum');
    expect(normalizeCategory('  parcare  ')).toBe('parcare');
    expect(normalizeCategory('kitalált')).toBe('altele');
    expect(normalizeCategory(null)).toBe('altele');
    expect(normalizeCategory('')).toBe('altele');
    expect(normalizeCategory({ a: 1 })).toBe('altele');
  });
});
