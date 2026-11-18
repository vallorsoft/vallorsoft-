// Bináris keresés a GPS-pontsoron — egyezés a lineáris kereséssel
const { lowerBoundT } = require('../../lib/sortedSearch');
const { trackVisits } = require('../../lib/waybillRows');

function linear(pts, sec) { for (let i = 0; i < pts.length; i++) if (pts[i][0] >= sec) return i; return pts.length; }

describe('lowerBoundT', () => {
  test('üres / hibás bemenet', () => {
    expect(lowerBoundT([], 5)).toBe(0);
    expect(lowerBoundT(null, 5)).toBe(0);
    expect(lowerBoundT([[1]], null)).toBe(0);
  });
  test('azonos a lineáris kereséssel (véletlen pontsorok, ismétlődő idővel)', () => {
    for (let k = 0; k < 300; k++) {
      const n = Math.floor(Math.random() * 200);
      let t = 0; const pts = [];
      for (let i = 0; i < n; i++) { t += Math.floor(Math.random() * 3); pts.push([t, 0, 0]); }
      for (let q = -2; q <= t + 2; q++) expect(lowerBoundT(pts, q)).toBe(linear(pts, q));
    }
  });
});

describe('trackVisits a felezéses kezdőponttal', () => {
  test('ugyanazt a látogatást adja, mint teljes pontsoron', () => {
    const pts = [];
    for (let s = 0; s < 3 * 86400; s += 60) {
      const here = (s > 90000 && s < 93000);          // ~50 perc a célponton
      pts.push([s, here ? 46.0 : 45.0, here ? 25.0 : 24.0]);
    }
    const a = trackVisits(pts, 46.0, 25.0, 80000, 200000);
    const b = trackVisits(pts.slice(), 46.0, 25.0, null, 200000).filter(v => v.from >= 80000);
    expect(a).toEqual(b);
    expect(a.length).toBe(1);
  });
});
