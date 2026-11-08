// Unit — lib/fuelLossAlert.js (napi hiány-összesítés + fokozat) és lib/orderAutoToll.js canOverwrite
jest.mock('../../db', () => require('../helpers/db-mock').pool);
const fl = require('../../lib/fuelLossAlert');
const at = require('../../lib/orderAutoToll');

describe('fuelLossAlert.summarizeDay', () => {
  const d0 = 1000000, d1 = d0 + 86400;
  test('álló hiány + bon-hiány összeadódik', () => {
    const s = fl.summarizeDay([{ from: d0 + 3600, to: d0 + 7200, liters: 80, lat: 46, lng: 21 }], [], 30, d0, d1);
    expect(s.total_l).toBe(110);
    expect(s.stop_l).toBe(80);
    expect(s.receipt_l).toBe(30);
    expect(s.events).toHaveLength(1);
  });
  test('ugyanaz az esemény (hirtelen csökkenés az állás alatt) nem számít kétszer', () => {
    const s = fl.summarizeDay(
      [{ from: d0 + 3600, to: d0 + 7200, liters: 120 }],
      [{ t: d0 + 5000, liters: 118 }, { t: d0 + 40000, liters: 60, moving: true }], 0, d0, d1);
    expect(s.stop_l).toBe(120);
    expect(s.sudden_l).toBe(60);
    expect(s.total_l).toBe(180);
  });
  test('más napra eső esemény kimarad', () => {
    const s = fl.summarizeDay([{ from: d1 + 100, to: d1 + 4000, liters: 200 }], [{ t: d0 - 100, liters: 90 }], 0, d0, d1);
    expect(s.total_l).toBe(0);
  });
  test('negatív bon-eltérés nem csökkenti a hiányt', () => {
    expect(fl.summarizeDay([], [], -50, d0, d1).total_l).toBe(0);
  });
});

describe('fuelLossAlert.levelFor', () => {
  test('küszöbök: 100 L felett iroda, 250 L felett sofőr is', () => {
    expect(fl.levelFor(100)).toBe(0);
    expect(fl.levelFor(100.1)).toBe(1);
    expect(fl.levelFor(250)).toBe(1);
    expect(fl.levelFor(251)).toBe(2);
  });
});

describe('orderAutoToll.canOverwrite', () => {
  test('üres útdíj → számolható', () => {
    expect(at.canOverwrite({ toll_cost: null })).toBe(true);
  });
  test('kézi / gombbal számolt érték → nem írjuk felül', () => {
    expect(at.canOverwrite({ toll_cost: 120, toll_geo: { total: 120 } })).toBe(false);
    expect(at.canOverwrite({ toll_cost: 120, toll_geo: null })).toBe(false);
  });
  test('automata érték, azóta nem módosították → újraszámolható', () => {
    expect(at.canOverwrite({ toll_cost: '95.5', toll_geo: JSON.stringify({ auto: true, total: 95.5 }) })).toBe(true);
  });
  test('automata érték, de kézzel átírták → nem írjuk felül', () => {
    expect(at.canOverwrite({ toll_cost: 150, toll_geo: { auto: true, total: 95.5 } })).toBe(false);
  });
});
