// ============================================================
//  Unit-teszt — lib/roBorder.js (Románia-geozóna, határátlépés-felismerés)
// ============================================================
const geo = require('../../lib/roBorder');

// Egyenes vonalú, percenkénti pontsor A → B (a gps_track_days formátuma)
function track(a, b, n, t0, stepSec) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    out.push([t0 + i * (stepSec || 60), a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, 70]);
  }
  return out;
}
const ARAD = [46.18, 21.31], MAKO = [46.21, 20.48];
const GIURGIU_IN = [43.95, 25.97], RUSE = [43.83, 25.96];

describe('isInRomania', () => {
  test.each([
    ['București', 44.43, 26.10, true], ['Cluj', 46.77, 23.59, true], ['Arad', 46.18, 21.31, true],
    ['Konstanca (kikötő is)', 44.17, 28.63, true], ['Konstanca-Dél kikötő', 44.08, 28.70, true],
    ['Sulina', 45.16, 29.65, true], ['Mangalia', 43.81, 28.58, true], ['Tulcea', 45.18, 28.80, true],
    ['Budapest', 47.50, 19.04, false], ['Makó (HU)', 46.21, 20.48, false], ['Rusze (BG)', 43.85, 25.96, false],
    ['Chișinău (MD)', 47.01, 28.86, false], ['Izmajil (UA)', 45.35, 28.84, false], ['Durankulak (BG)', 43.69, 28.53, false],
    ['Bécs', 48.21, 16.37, false],
  ])('%s', (_n, lat, lng, exp) => {
    expect(geo.isInRomania(lat, lng)).toBe(exp);
  });
  test('érvénytelen koordináta → null', () => {
    expect(geo.isInRomania('x', 1)).toBeNull();
  });
});

describe('detectCrossings', () => {
  test('Arad → Makó: egy KILÉPÉS, a határ közelében, interpolált idővel', () => {
    const t0 = 1_780_000_000;
    const r = geo.detectCrossings(track(ARAD, MAKO, 60, t0));
    expect(r.crossings).toHaveLength(1);
    const c = r.crossings[0];
    expect(c.dir).toBe('OUT');
    expect(c.t).toBeGreaterThan(t0);
    expect(c.t).toBeLessThan(t0 + 3600);
    expect(geo.distToBorderM(c.lat, c.lng)).toBeLessThan(200);
    expect(c.approx).toBe(false);
    expect(r.state).toBe(false);
  });

  test('oda-vissza: KI majd BE', () => {
    const t0 = 1_780_000_000;
    const out = track(ARAD, MAKO, 60, t0);
    const back = track(MAKO, ARAD, 60, t0 + 7200);
    const r = geo.detectCrossings(out.concat(back));
    expect(r.crossings.map((c) => c.dir)).toEqual(['OUT', 'IN']);
  });

  test('Giurgiu → Rusze (Duna-híd)', () => {
    const r = geo.detectCrossings(track(GIURGIU_IN, RUSE, 30, 1_780_000_000));
    expect(r.crossings.map((c) => c.dir)).toEqual(['OUT']);
  });

  test('billegés a határon (vámnál várakozás) NEM átlépés', () => {
    // A határ két oldalán ~100 m-re ugrál, majd visszamegy Romániába
    const c = geo.detectCrossings(track(ARAD, MAKO, 60, 0)).crossings[0];
    const pts = track(ARAD, [c.lat, c.lng + 0.01], 30, 0);
    let t = pts[pts.length - 1][0];
    for (let i = 0; i < 40; i++) {
      t += 60;
      pts.push([t, c.lat, c.lng + (i % 2 ? 0.0015 : -0.0015), 0]);
    }
    pts.push(...track([c.lat, c.lng + 0.01], ARAD, 30, t + 60));
    const r = geo.detectCrossings(pts);
    expect(r.crossings).toHaveLength(0);
  });

  test('a sor végén meg nem erősített irányváltás → pending, nincs átlépés', () => {
    const c = geo.detectCrossings(track(ARAD, MAKO, 60, 0)).crossings[0];
    const pts = track(ARAD, [c.lat, c.lng - 0.003], 40, 0);   // épp átment, de még csak ~200 m
    const r = geo.detectCrossings(pts);
    expect(r.crossings).toHaveLength(0);
    expect(r.pending).toBe(true);
  });

  test('nagy GPS-hézag (pl. kikapcsolt eszköz) → approx jelölés', () => {
    const pts = [[0, ARAD[0], ARAD[1]], [7200, MAKO[0], MAKO[1]]];
    const r = geo.detectCrossings(pts);
    expect(r.crossings).toHaveLength(1);
    expect(r.crossings[0].approx).toBe(true);
  });

  test('Konstanca kikötőjében mozgás nem okoz átlépést', () => {
    const r = geo.detectCrossings(track([44.20, 28.55], [44.08, 28.70], 60, 0));
    expect(r.crossings).toHaveLength(0);
  });

  test('0,0 koordinátájú (hibás) pontok kiszűrve', () => {
    const pts = track(ARAD, [46.0, 22.5], 20, 0);
    pts.splice(10, 0, [pts[9][0] + 1, 0, 0]);
    expect(geo.detectCrossings(pts).crossings).toHaveLength(0);
  });

  test('sebesség: 3 napnyi pont (~4300) gyorsan feldolgozható', () => {
    const pts = [];
    for (let d = 0; d < 3; d++) pts.push(...track(ARAD, MAKO, 1440, d * 86400 * 2, 60));
    const t = Date.now();
    geo.detectCrossings(pts);
    expect(Date.now() - t).toBeLessThan(2000);
  });
});
