// tests/unit/calcEngine.test.js
// A calc-engine bit-pontos portjának regresszió-védelme. Az elvárások
// a Vallorcalc TS-forrás algoritmusából származnak (VAT_RATE=0.21).
const { calculate, grossToNet, grossToVat, netToGross, toNet, computeFreightRevenue, prorateCost } = require('../../lib/calcEngine');

describe('calcEngine — ÁFA-segédek', () => {
  test('grossToNet + grossToVat visszaadja az eredetit', () => {
    const g = 121; expect(grossToNet(g) + grossToVat(g)).toBeCloseTo(g, 8);
  });
  test('netToGross 100 → 121', () => { expect(netToGross(100)).toBeCloseTo(121, 8); });
  test('toNet(bruttó=true) = grossToNet', () => { expect(toNet(121, true)).toBeCloseTo(100, 8); });
  test('toNet(bruttó=false) változatlan', () => { expect(toNet(100, false)).toBeCloseTo(100, 8); });
});

describe('calcEngine — prorateCost', () => {
  test('km-alapú: interval alapján osztva × nettó összeg', () => {
    const item = { basisType: 'km', intervalKm: 1000, amountLei: 121, isGross: true };
    // trip 500km → 0.5 × 100 = 50
    expect(prorateCost(item, 500, 120000, 1, 48)).toBeCloseTo(50, 6);
  });
  test('idő-alapú: hetek alapján osztva × nettó összeg', () => {
    const item = { basisType: 'time', intervalMonths: 12, amountLei: 121, isGross: true };
    // tripWeeks=1, intervalWeeks=48 → 1/48 × 100
    expect(prorateCost(item, 100, 120000, 1, 48)).toBeCloseTo(100 / 48, 6);
  });
  test('km-alapú intervalKm hiányzik → annualKm fallback', () => {
    const item = { basisType: 'km', amountLei: 121, isGross: true };
    expect(prorateCost(item, 12000, 120000, 1, 48)).toBeCloseTo(10, 6);
  });
});

describe('calcEngine — calculate', () => {
  const baseInput = {
    tripKm: 1000, tripDays: 7,
    annualKmTarget: 120000, workingWeeksPerYear: 48,
    truckCosts: [], trailerCosts: [], driverCosts: [], companyCosts: [], tolls: [],
    fuelMethod: 'per_liter', fuelLiterPer100km: 30, fuelPricePerLiterGross: 7.55,
    excisaApplied: false, fuelDiscountApplied: false,
    activeTrucksCount: 1, bnrEurLei: 5,
  };

  test('üzemanyag per_liter: liters × price → gross → net + vat', () => {
    const r = calculate(baseInput);
    // 1000/100 × 30 × 7.55 = 2265 bruttó
    expect(r.fuelGross).toBeCloseTo(2265, 4);
    expect(r.fuelNet).toBeCloseTo(2265 * 100 / 121, 4);
    expect(r.fuelVat).toBeCloseTo(2265 * 21 / 121, 4);
  });

  test('üzemanyag fixed módban a fuelTotalGross-t használja', () => {
    const r = calculate({ ...baseInput, fuelMethod: 'fixed', fuelTotalGross: 3200 });
    expect(r.fuelGross).toBeCloseTo(3200, 4);
  });

  test('vontató-költség km-alapú: bekerül a line-okba "Vontató – X" prefix-szel', () => {
    const r = calculate({ ...baseInput, truckCosts: [{ name: 'ITP', basisType: 'km', intervalKm: 1000, amountLei: 121, isGross: true }] });
    const l = r.lines.find(x => x.name === 'Vontató – ITP');
    expect(l).toBeTruthy();
    expect(l.netLei).toBeCloseTo(100, 4);
    expect(l.vatLei).toBeCloseTo(21, 4);
  });

  test('sofőr-költség: éves nettó / munkahetek × tripWeeks', () => {
    const r = calculate({ ...baseInput, driverCosts: [{ name: 'Bér', amountLei: 4800, isGross: false }] });
    const l = r.lines.find(x => x.name === 'Sofőr – Bér');
    // 4800/48 = 100 per hét, tripWeeks = 1 → 100
    expect(l.netLei).toBeCloseTo(100, 4);
  });

  test('cég-költség: aktív vontatók számára osztva', () => {
    const r = calculate({ ...baseInput, activeTrucksCount: 4, companyCosts: [{ name: 'Iroda', basisType: 'time', intervalMonths: 12, amountLei: 121, isGross: true }] });
    const l = r.lines.find(x => x.name === 'Céges – Iroda');
    // 1/48 × 100 = 2.0833, / 4 = 0.5208
    expect(l.netLei).toBeCloseTo((100 / 48) / 4, 6);
  });

  test('kedvezmények és útdíj: nettósítva, discountNet levonva a totalNet-ből', () => {
    const r = calculate({
      ...baseInput,
      excisaApplied: true, excisaDiscountLei: 121, excisaDiscountType: 'gross',
      fuelDiscountApplied: true, fuelDiscountLei: 100, fuelDiscountType: 'net',
      tolls: [{ amountLei: 242 }],
    });
    expect(r.discountNet).toBeCloseTo(200, 4); // 100 (excisa net) + 100 (fuel net)
    expect(r.tollNet).toBeCloseTo(200, 4);      // 242 gross → 200 net
  });

  test('freight bevétel + profit-számítás', () => {
    const r = calculate({ ...baseInput, freightRevenueLei: 3630 });
    // freightNet = 3630/1.21 = 3000; total ~ fuel csak
    expect(r.freightNet).toBeCloseTo(3000, 4);
    expect(r.profitNet).toBeCloseTo(3000 - r.totalNet, 4);
    expect(r.profitEur).toBeCloseTo((3000 - r.totalNet) / 5, 4);
  });

  test('EUR-átváltás: totalNet / bnr = totalNetEur', () => {
    const r = calculate({ ...baseInput, bnrEurLei: 5 });
    expect(r.totalNetEur).toBeCloseTo(r.totalNet / 5, 4);
  });
});

describe('calcEngine — computeFreightRevenue', () => {
  test('LEI, bruttó', () => {
    expect(computeFreightRevenue(1210, 'lei', true, 5)).toEqual({ grossLei: 1210, grossEur: 242 });
  });
  test('EUR, nettó → LEI bruttó', () => {
    // 100 EUR × 5 = 500 LEI nettó → 605 LEI bruttó → 121 EUR
    expect(computeFreightRevenue(100, 'eur', false, 5)).toEqual({ grossLei: 605, grossEur: 121 });
  });
  test('null bemenet → null-null', () => {
    expect(computeFreightRevenue(null, 'lei', true, 5)).toEqual({ grossLei: null, grossEur: null });
  });
});
