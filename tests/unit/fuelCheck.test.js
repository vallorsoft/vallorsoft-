const fc = require('../../lib/fuelCheck');

// menet: percenként ~1 km, 0,3 L/km; állás: 60 perc, percenként egy pont
function track({ parkShift = 0, afterShift = 0, parkDropAt = null, parkDrop = 0 }) {
  const pts = []; let t = 0, lat = 45, lvl = 500, odo = 1000;
  for (let i = 0; i < 30; i++) { pts.push([t, lat, 25, 60, 1, odo, null, lvl, 0]); t += 60; lat += 0.009; lvl -= 0.3; odo += 1; }
  for (let i = 0; i < 60; i++) {
    let l = lvl + parkShift;
    if (parkDropAt != null && i >= parkDropAt) l -= parkDrop;
    pts.push([t, lat, 25, 0, 0, odo, null, l, 0]); t += 60;
  }
  lvl -= afterShift;
  for (let i = 0; i < 30; i++) { lat += 0.009; lvl -= 0.3; odo += 1; pts.push([t, lat, 25, 60, 1, odo, null, lvl, 0]); t += 60; }
  return pts;
}

describe('stopCheck — álló helyzetű hiány', () => {
  test('parkolás közbeni 8 L hiány, utána is hiányzik → jelzés, megerősítve', () => {
    const r = fc.stopCheck(track({ parkDropAt: 30, parkDrop: 8, afterShift: 8 }), { lPerKm: 0.3 });
    expect(r.checked).toBe(1);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].liters).toBeCloseTo(8, 0);
    expect(r.items[0].confirmed).toBe(true);
  });
  test('légrugó/emelt szint: parkolás alatt −15 L látszat, indulás után visszaáll → nincs jelzés', () => {
    const r = fc.stopCheck(track({ parkDropAt: 20, parkDrop: 15 }), { lPerKm: 0.3 });
    expect(r.items).toHaveLength(0);
  });
  test('lejtős parkoló: az egész állás −20 L, utána rendben → nincs jelzés', () => {
    expect(fc.stopCheck(track({ parkShift: -20 }), { lPerKm: 0.3 }).items).toHaveLength(0);
  });
  test('menet-szint szerint 9 L hiány, a parkolás nem mutatja → jelzés, de nem megerősített', () => {
    const r = fc.stopCheck(track({ afterShift: 9 }), { lPerKm: 0.3 });
    expect(r.items).toHaveLength(1);
    expect(r.items[0].confirmed).toBe(false);
  });
  test('tankolás az állás alatt → kihagyva', () => {
    const pts = track({ afterShift: 9 });
    expect(fc.stopCheck(pts, { lPerKm: 0.3, refuels: [{ t: pts[40][0] }] }).items).toHaveLength(0);
  });
  test('kevés adat → nem dob', () => {
    expect(fc.stopCheck([], {}).items).toEqual([]);
  });
});

describe('receiptCheck — bon vs. tartály', () => {
  const dayOf = (t) => new Date(t * 1000).toISOString().slice(0, 10);
  const T = (d, h) => Date.parse(d + 'T' + h + ':00Z') / 1000;
  test('hiány / egyezik / nem mérhető / szomszéd nap', () => {
    const r = fc.receiptCheck([
      { day: '2026-11-01', liters: 400, loc: 'MOL' },
      { day: '2026-11-02', liters: 300 },
      { day: '2026-11-03', liters: 40 },
      { day: '2026-11-05', liters: 350 },
    ], [
      { t: T('2026-11-01', '10:00'), liters: 380 },
      { t: T('2026-11-02', '09:00'), liters: 298 },
      { t: T('2026-11-06', '00:20'), liters: 349 },
      { t: T('2026-11-08', '12:00'), liters: 200 },
    ], dayOf);
    const by = Object.fromEntries(r.items.map((i) => [i.day, i]));
    expect(by['2026-11-01'].status).toBe('missing');
    expect(by['2026-11-01'].diff_l).toBe(20);
    expect(by['2026-11-02'].status).toBe('ok');
    expect(by['2026-11-03'].status).toBe('not_measured');
    expect(by['2026-11-05'].status).toBe('ok');
    expect(r.no_receipt).toHaveLength(1);
    expect(r.missing_l).toBe(20);
  });
});

describe('consumptionCheck — fogyasztás', () => {
  test('rövid időszak', () => {
    expect(fc.consumptionCheck({ km: 100 }).too_short).toBe(true);
  });
  test('saját átlag felett + bon-alapú + szint vs. számláló', () => {
    const r = fc.consumptionCheck({ km: 2000, used_level: 700, used_counter: 640, start_level: 300, end_level: 200, receipt_l: 600, hist_l100: 31 });
    expect(r.baseline_src).toBe('history');
    const keys = r.flags.map((f) => f.key);
    expect(keys).toContain('level');
    expect(keys).toContain('receipts');
    expect(keys).toContain('level_vs_counter');
    expect(keys).not.toContain('counter');
  });
  test('névleges fallback, rendben', () => {
    const r = fc.consumptionCheck({ km: 1000, used_level: 300, nominal_l100: 30 });
    expect(r.baseline_src).toBe('nominal');
    expect(r.flags).toHaveLength(0);
  });
});
