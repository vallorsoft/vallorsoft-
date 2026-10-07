// KÖTELEZŐ céges lábléc — services/email.js appendCompanyFooter (DB mockolva)
jest.mock('../../db', () => ({ query: jest.fn(async (sql) => {
  if (/FROM companies/.test(sql)) return { rows: [{ j: { nev: 'Vallor Team SRL', cui: '47859317', telefon: '0769' } }] };
  if (/company_branding/.test(sql)) return { rows: [{ '?column?': 1 }] };
  return { rows: [] };
}) }));
process.env.APP_URL = 'https://vallorsoft.fly.dev';
const { appendCompanyFooter } = require('../../services/email');

test('a cég arculatából lábléc kerül a levél végére, logóval', async () => {
  const h = await appendCompanyFooter('<p>Szia</p>', 7);
  expect(h.startsWith('<p>Szia</p>')).toBe(true);
  expect(h).toContain('Vallor Team SRL');
  expect(h).toContain('CUI 47859317');
  expect(h).toContain('https://vallorsoft.fly.dev/branding/logo/7.png');
});
test('nincs dupla lábléc; cég nélkül nincs lábléc', async () => {
  const once = await appendCompanyFooter('<p>x</p>', 7);
  expect(await appendCompanyFooter(once, 7)).toBe(once);
  expect(await appendCompanyFooter('<p>x</p>', null)).toBe('<p>x</p>');
});
