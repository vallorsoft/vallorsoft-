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

describe('stopMatchRunner.upgradedAddress — régi címek átírása', () => {
  const r = require('../../lib/stopMatchRunner');
  const place = { address: 'BILKA STEEL, Str. Zizinului 110, Brașov, RO', addr: 'Str. Zizinului 110, Brașov, RO', name: 'BILKA STEEL' };
  test('generált régi cím (cégnévvel) → cégnév nélkül + koordináta', () => {
    expect(r.upgradedAddress('BILKA STEEL, Str. Zizinului 110, Brașov, RO', place, 45.65, 25.6)).toBe('Str. Zizinului 110, Brașov, RO (45.65000, 25.60000)');
    // a régi térképes mentés a közeli cég nevét elé is tehette
    expect(r.upgradedAddress('Alfa SRL, BILKA STEEL, Str. Zizinului 110, Brașov, RO', place, 45.65, 25.6)).toBe('Str. Zizinului 110, Brașov, RO (45.65000, 25.60000)');
  });
  test('kézzel írt cím megmarad, mögé a koordináta; már új formájú nem változik', () => {
    expect(r.upgradedAddress('Depozit 3, poarta 2', place, 45.65, 25.6)).toBe('Depozit 3, poarta 2 (45.65000, 25.60000)');
    expect(r.upgradedAddress('Str. X 1 (45.65000, 25.60000)', place, 45.65, 25.6)).toBe('Str. X 1 (45.65000, 25.60000)');
  });
  test('cache nélkül a szöveg marad + koordináta; csak koordináta → egységes forma', () => {
    expect(r.upgradedAddress('Str. Y 2, Arad', null, 46.1, 21.3)).toBe('Str. Y 2, Arad (46.10000, 21.30000)');
    expect(r.upgradedAddress('46.1, 21.3', null, 46.1, 21.3)).toBe('46.10000, 21.30000');
  });
});
