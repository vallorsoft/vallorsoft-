const { normalizePlate } = require('../../lib/plate');

describe('normalizePlate — CargoTrack rendszám-felismerés', () => {
  test('szóközös név normalizálása (a képen látott eset)', () => {
    expect(normalizePlate('B 104 VLR')).toBe('B104VLR');
  });

  test('kötőjel és pont eltávolítása, nagybetűsítés', () => {
    expect(normalizePlate('b-104.vlr')).toBe('B104VLR');
  });

  test('null/undefined -> üres string', () => {
    expect(normalizePlate(null)).toBe('');
    expect(normalizePlate(undefined)).toBe('');
  });

  test('már tiszta rendszám változatlan', () => {
    expect(normalizePlate('TM01ABC')).toBe('TM01ABC');
  });
});
