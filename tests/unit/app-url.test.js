const { appBaseUrl } = require('../../lib/appUrl');

describe('appBaseUrl — APP_URL biztonságos kinyerése', () => {
  const orig = process.env.APP_URL;
  afterEach(() => { process.env.APP_URL = orig; });

  test('markdown-os APP_URL-ből a tiszta URL-t adja vissza', () => {
    process.env.APP_URL = '[https://vallorsoft.onrender.com](https://vallorsoft.onrender.com)';
    expect(appBaseUrl('http://localhost:3000')).toBe('https://vallorsoft.onrender.com');
    expect(appBaseUrl() + '/t/TOKEN').toBe('https://vallorsoft.onrender.com/t/TOKEN');
  });

  test('normál URL záró perjellel → perjel nélkül', () => {
    process.env.APP_URL = 'https://vallorsoft.onrender.com/';
    expect(appBaseUrl()).toBe('https://vallorsoft.onrender.com');
  });

  test('üres APP_URL → fallback', () => {
    process.env.APP_URL = '';
    expect(appBaseUrl('http://localhost:3000')).toBe('http://localhost:3000');
  });

  test('körítő szöveg/szóköz esetén az URL-t emeli ki', () => {
    process.env.APP_URL = '  Link: https://app.vallorsoft.com  ';
    expect(appBaseUrl()).toBe('https://app.vallorsoft.com');
  });
});
