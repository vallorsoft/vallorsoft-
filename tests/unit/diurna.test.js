// ============================================================
//  lib/diurna.js — menetlevél-alapú diurna kalkulátor
//  Szabály: 12:00 szabály (Europe/Bucharest)
//    - indulás napja számít, ha indulás < 12:00
//    - érkezés napja számít, ha érkezés > 12:00
//    - közbülső nap mindig számít
//    - nap típusa: sofőr helyzete 12:00-kor (OUT=kívül → EXTERN, belül → INTERN)
// ============================================================
const { calculateDiurna } = require('../../lib/diurna');

describe('lib/diurna calculateDiurna', () => {
  test('null bemenet → nulla nap', () => {
    expect(calculateDiurna(null, null, [])).toEqual({ externDays: 0, internDays: 0, crossingLog: [] });
    expect(calculateDiurna(null, '2025-01-10T21:00:00', [])).toEqual({ externDays: 0, internDays: 0, crossingLog: [] });
    expect(calculateDiurna('2025-01-06T10:00:00', null, [])).toEqual({ externDays: 0, internDays: 0, crossingLog: [] });
  });

  test('docstring példa: 3 EXTERN + 2 INTERN', () => {
    // Hétfő 10:00 indulás → Péntek 21:00 érkezés
    // Kedd 11:00 OUT (Bucharest helyi idő), Csütörtök 19:30 IN
    const r = calculateDiurna(
      '2025-01-06T08:00:00Z', // Hétfő < 12:00 Bucharest (08:00 UTC = 10:00 EET) → számít
      '2025-01-10T19:00:00Z', // Péntek > 12:00 Bucharest (19:00 UTC = 21:00 EET) → számít
      [
        { datetime: '2025-01-07T09:00:00Z', direction: 'OUT' }, // Kedd 11:00 Bucharest (09:00 UTC)
        { datetime: '2025-01-09T17:30:00Z', direction: 'IN'  }, // Csütörtök 19:30 Bucharest (17:30 UTC)
      ]
    );
    expect(r.externDays).toBe(3);
    expect(r.internDays).toBe(2);
    expect(r.crossingLog).toHaveLength(5);
    expect(r.crossingLog[0]).toEqual({ day: '2025-01-06', type: 'INTERN' });
    expect(r.crossingLog[1]).toEqual({ day: '2025-01-07', type: 'EXTERN' });
    expect(r.crossingLog[2]).toEqual({ day: '2025-01-08', type: 'EXTERN' });
    expect(r.crossingLog[3]).toEqual({ day: '2025-01-09', type: 'EXTERN' });
    expect(r.crossingLog[4]).toEqual({ day: '2025-01-10', type: 'INTERN' });
  });

  test('indulás napja nem számít ha >= 12:00 Bucharest', () => {
    // Indulás 13:00 Bucharest (11:00 UTC, EET=UTC+2) → az indulás napja NEM számít
    const r = calculateDiurna(
      '2025-01-06T11:00:00Z', // 13:00 Bucharest EET → >= 12:00 → nem számít
      '2025-01-08T19:00:00Z', // 21:00 Bucharest → számít
      []
    );
    // Jan 6 kiesik, Jan 7 (közbülső) számít, Jan 8 (> 12:00) számít → 2 nap
    expect(r.crossingLog).toHaveLength(2);
    expect(r.crossingLog[0].day).toBe('2025-01-07');
    expect(r.crossingLog[1].day).toBe('2025-01-08');
  });

  test('érkezés napja nem számít ha <= 12:00 Bucharest', () => {
    // Érkezés 11:00 Bucharest (09:00 UTC) → az érkezés napja NEM számít
    const r = calculateDiurna(
      '2025-01-06T06:00:00Z', // 08:00 Bucharest → számít
      '2025-01-08T09:00:00Z', // 11:00 Bucharest → < 12:00 → nem számít
      []
    );
    // Jan 6 számít, Jan 7 (közbülső) számít, Jan 8 kiesik → 2 nap
    expect(r.crossingLog).toHaveLength(2);
    expect(r.crossingLog[0].day).toBe('2025-01-06');
    expect(r.crossingLog[1].day).toBe('2025-01-07');
  });

  test('határátlépés nélkül minden nap INTERN', () => {
    const r = calculateDiurna(
      '2025-01-06T06:00:00Z', // 08:00 Bucharest
      '2025-01-08T19:00:00Z', // 21:00 Bucharest
      []
    );
    expect(r.externDays).toBe(0);
    expect(r.internDays).toBe(3);
    r.crossingLog.forEach(e => expect(e.type).toBe('INTERN'));
  });

  test('egész tartózkodás külföldön (OUT előtte, IN utána) → minden nap EXTERN', () => {
    // OUT jan 5-én, a teljes jan 6-8 külföldön, IN jan 9-én
    const r = calculateDiurna(
      '2025-01-06T06:00:00Z',
      '2025-01-08T19:00:00Z',
      [
        { datetime: '2025-01-05T08:00:00Z', direction: 'OUT' },
        { datetime: '2025-01-09T08:00:00Z', direction: 'IN'  },
      ]
    );
    expect(r.externDays).toBe(3);
    expect(r.internDays).toBe(0);
  });

  test('ugyanaz a nap indulás és érkezés: számít ha indulás < 12:00 ÉS érkezés > 12:00', () => {
    // 08:00 UTC = 10:00 Bucharest (< 12:00); 19:00 UTC = 21:00 Bucharest (> 12:00) → számít
    const r1 = calculateDiurna('2025-01-06T06:00:00Z', '2025-01-06T19:00:00Z', []);
    expect(r1.crossingLog).toHaveLength(1);

    // Indulás 13:00 Bucharest (11:00 UTC) → nem számít
    const r2 = calculateDiurna('2025-01-06T11:00:00Z', '2025-01-06T19:00:00Z', []);
    expect(r2.crossingLog).toHaveLength(0);

    // Érkezés 11:00 Bucharest (09:00 UTC) → nem számít
    const r3 = calculateDiurna('2025-01-06T06:00:00Z', '2025-01-06T09:00:00Z', []);
    expect(r3.crossingLog).toHaveLength(0);
  });
});
