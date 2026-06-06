// ============================================================
//  lib/diurna.js — diurna (külföldi nap) kalkulátor
//  EXTERN: >= 12 óra külföldön egy adott naptári napon, egyébként INTERN.
// ============================================================
const { calculateDiurna } = require('../../lib/diurna');

describe('lib/diurna calculateDiurna', () => {
  test('üres bemenet → nulla nap', () => {
    expect(calculateDiurna([])).toEqual({ externDays: 0, internDays: 0, crossingLog: [] });
    expect(calculateDiurna(null)).toEqual({ externDays: 0, internDays: 0, crossingLog: [] });
  });

  test('teljes nap külföldön → EXTERN (>= 12 óra)', () => {
    // 2026-01-10 06:00 OUT → 2026-01-10 20:00 IN = 14 óra egy napon
    const r = calculateDiurna([
      { direction: 'OUT', crossed_at: '2026-01-10T06:00:00Z' },
      { direction: 'IN',  crossed_at: '2026-01-10T20:00:00Z' },
    ]);
    expect(r.externDays).toBe(1);
    expect(r.internDays).toBe(0);
    expect(r.crossingLog[0].type).toBe('EXTERN');
    expect(r.crossingLog[0].hours).toBeCloseTo(14, 1);
  });

  test('rövid külföldi tartózkodás → INTERN (< 12 óra)', () => {
    // 4 óra külföldön
    const r = calculateDiurna([
      { direction: 'OUT', crossed_at: '2026-01-11T08:00:00Z' },
      { direction: 'IN',  crossed_at: '2026-01-11T12:00:00Z' },
    ]);
    expect(r.externDays).toBe(0);
    expect(r.internDays).toBe(1);
    expect(r.crossingLog[0].type).toBe('INTERN');
  });

  test('IN pár nélküli OUT nem számít bele', () => {
    const r = calculateDiurna([{ direction: 'OUT', crossed_at: '2026-01-12T08:00:00Z' }]);
    expect(r.crossingLog).toHaveLength(0);
  });
});
