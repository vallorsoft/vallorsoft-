jest.mock('../../db', () => ({ query: jest.fn() }));

describe('stopMatchRunner.formatAddress — cégnév nélkül, pontos koordinátával', () => {
  const r = require('../../lib/stopMatchRunner');
  test('a környező cég neve kimarad, a koordináta zárójelben', () => {
    const p = r._placeFromNominatim({ name: 'BILKA STEEL', address: { road: 'Str. Zizinului', house_number: '110', city: 'Brașov', county: 'Brașov', country_code: 'ro', postcode: '500407' } });
    expect(r.formatAddress(p, 45.6512345, 25.6234567)).toBe('Str. Zizinului 110, Brașov, 500407, RO (45.65123, 25.62346)');
  });
  test('régi cache-sor (addr nélkül): a név levágva', () => {
    expect(r.formatAddress({ address: 'OMV, Calea Turzii 5, Cluj-Napoca', name: 'OMV' }, 46.7, 23.6)).toBe('Calea Turzii 5, Cluj-Napoca (46.70000, 23.60000)');
  });
  test('nincs cím → csak koordináta; régi koordináta nem duplázódik', () => {
    expect(r.formatAddress(null, 46.7, 23.6)).toBe('46.70000, 23.60000');
    expect(r.formatAddress({ address: 'Str. X 1, Turda (46.12345, 23.12345)' }, 46.7, 23.6)).toBe('Str. X 1, Turda (46.70000, 23.60000)');
  });
});
