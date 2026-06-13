// ============================================================
//  lib/tollProvider — HERE toll-parser (hálózat nélkül)
// ============================================================
const tp = require('../../lib/tollProvider');

describe('lib/tollProvider.parseHereToll', () => {
  test('tollonként a LEGOLCSÓBB fare, országonként összegezve', () => {
    const data = { routes: [{ sections: [
      { tolls: [
        { countryCode: 'ROU', fares: [{ price: { value: '10.5', currency: 'EUR' } }, { price: { value: '12', currency: 'EUR' } }] },
        { countryCode: 'HUN', fares: [{ price: { value: '8', currency: 'EUR' } }] },
      ] },
      { tolls: [
        { countryCode: 'ROU', fares: [{ price: { value: '5', currency: 'EUR' } }] },
      ] },
    ] }] };
    const r = tp.parseHereToll(data);
    expect(r.total).toBe(23.5);                 // ROU 10.5+5 + HUN 8
    expect(r.currency).toBe('EUR');
    expect(r.source).toBe('here');
    expect(r.breakdown.find((b) => b.country === 'ROU').cost).toBe(15.5);
    expect(r.breakdown.find((b) => b.country === 'HUN').cost).toBe(8);
  });

  test('nincs toll / üres válasz → 0', () => {
    expect(tp.parseHereToll({ routes: [{ sections: [{}] }] }).total).toBe(0);
    expect(tp.parseHereToll({}).total).toBe(0);
    expect(tp.parseHereToll(null).total).toBe(0);
  });
});

describe('lib/tollProvider.hereToll őrök (hálózat nélkül dobnak)', () => {
  test('kevesebb mint 2 koordináta → hiba', async () => {
    await expect(tp.hereToll([{ lat: 1, lng: 1 }], 'kulcs')).rejects.toThrow();
  });
  test('hiányzó kulcs → hiba', async () => {
    await expect(tp.hereToll([{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }], '')).rejects.toThrow();
  });
});
