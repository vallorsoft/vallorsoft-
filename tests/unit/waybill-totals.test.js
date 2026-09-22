// ============================================================
//  lib/waybillTotals.js — AdBlue KÜLÖN a dízeltől
// ============================================================
//  Regresszió-őr arra a hibára, ami három helyen (sofőr-beküldés, admin
//  szerkesztés, kézi menetlevél) bájtra azonos másolatban élt: a tankolás-
//  sorok literét TÍPUS NÉLKÜL adta össze, így egy AdBlue-töltés a
//  dízel-fogyasztásba került és hamis eltérés-riasztást generált.
const { computeFuelTotals, isAdblueRow } = require('../../lib/waybillTotals');

describe('computeFuelTotals — AdBlue nem dízel', () => {
  test('a régi hibát reprodukáló eset: 500 L dízel + 60 L AdBlue', () => {
    // Régi (hibás) viselkedés: totalAlim=560 → motorina=760 → 38.00 L/100km,
    // ami PONT a sofőr-figyelmeztetés küszöbe (>38). Helyesen 35.00.
    const r = computeFuelTotals(
      [{ tip: 'Motorină', litru: 500 }, { tip: 'AdBlue', litru: 60 }], 300, 100, 2000);
    expect(r.totalAlim).toBe(500);
    expect(r.totalAdblue).toBe(60);
    expect(r.motorinaFolosit).toBe(700);
    expect(r.consum100).toBe(35);
  });

  test('típus nélküli sor dízelnek számít (régi menetlevelek)', () => {
    const r = computeFuelTotals([{ litru: 400 }], 200, 150, 1000);
    expect(r.totalAlim).toBe(400);
    expect(r.totalAdblue).toBe(0);
    expect(r.motorinaFolosit).toBe(450);
  });

  test('csak AdBlue: a dízel-mérleg nem kap litert', () => {
    const r = computeFuelTotals([{ tip: 'AdBlue', litru: 100 }], 100, 80, 500);
    expect(r.totalAlim).toBe(0);
    expect(r.totalAdblue).toBe(100);
    expect(r.motorinaFolosit).toBe(20);   // 100 + 0 - 80
    expect(r.consum100).toBe(4);
  });

  test('üres / hibás bemenet nem dob', () => {
    expect(computeFuelTotals([], 0, 0, 0)).toEqual({ totalAlim: 0, totalAdblue: 0, motorinaFolosit: 0, consum100: 0 });
    expect(computeFuelTotals(null, 0, 0, 0).totalAlim).toBe(0);
    expect(computeFuelTotals([{ litru: 'nem-szám' }], 0, 0, 100).totalAlim).toBe(0);
  });

  test('a tartály-mérleg sosem negatív', () => {
    // Kevesebbet tankolt, mint amennyivel nőtt a szint (elgépelés) → 0.
    expect(computeFuelTotals([{ litru: 10 }], 100, 500, 100).motorinaFolosit).toBe(0);
  });

  test('km = 0 → nincs osztás nullával', () => {
    expect(computeFuelTotals([{ litru: 100 }], 100, 0, 0).consum100).toBe(0);
  });

  test('lebegőpontos maradék nem szivárog a bizonylatra', () => {
    const r = computeFuelTotals([{ litru: 0.1 }, { litru: 0.2 }], 0, 0, 100);
    expect(r.totalAlim).toBe(0.3);
  });

  test('isAdblueRow: kis/nagybetű- és szóköz-független', () => {
    expect(isAdblueRow({ tip: 'AdBlue' })).toBe(true);
    expect(isAdblueRow({ tip: ' ad blue ' })).toBe(true);
    expect(isAdblueRow({ tip: 'ADBLUE' })).toBe(true);
    expect(isAdblueRow({ tip: 'Motorină' })).toBe(false);
    expect(isAdblueRow({})).toBe(false);
    expect(isAdblueRow(null)).toBe(false);
  });
});
