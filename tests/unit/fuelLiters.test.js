const { fixLiters, inRange } = require('../../lib/fuelLiters');
const { _sanitize } = require('../../handlers/receiptScan');

describe('fuelLiters', () => {
  test('dízel tartomány 50–1500, AdBlue kevesebb is', () => {
    expect(inRange(300, 'Motorină')).toBe(true);
    expect(inRange(10.93, 'Motorină')).toBe(false);
    expect(inRange(1600, 'Motorină')).toBe(false);
    expect(inRange(20, 'AdBlue')).toBe(true);
    expect(inRange(0, 'AdBlue')).toBe(false);
  });
  test('literár a liter mezőben → összeg / literár', () => {
    expect(fixLiters(10.93, 3279, null, 'Motorină')).toEqual({ litru: 300, fixed: true, warn: false });
    expect(fixLiters(10.93, 3279, 10.93, 'Motorină').litru).toBe(300);
  });
  test('rossz liter + van literár → összeg / literár', () => {
    expect(fixLiters(5, 3279, 10.93, 'Motorină').litru).toBe(300);
  });
  test('jó érték változatlan; nem javítható → null + warn', () => {
    expect(fixLiters(300, 3279, 10.93, 'Motorină')).toEqual({ litru: 300, fixed: false, warn: false });
    expect(fixLiters(10.93, null, null, 'Motorină')).toEqual({ litru: null, fixed: false, warn: true });
  });
  test('AdBlue kis mennyiség megmarad', () => {
    expect(fixLiters(20, 80, 4, 'AdBlue').litru).toBe(20);
  });
  test('sanitize alkalmazza a javítást', () => {
    const f = _sanitize({ kind: 'fuel', tip: 'Motorină', litru: 10.93, pret_litru: 10.93, suma: 3279 });
    expect(f.litru).toBe(300);
  });
});
