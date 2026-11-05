// Robusztussági (fuzz) teszt: a cím-felismerő motor és a gomb-pótlás döntése
// véletlenszerű, hibás GPS-adaton sem dobhat kivételt, és az eredménye mindig érvényes.
const sm = require('../../lib/stopMatch');
const ae = require('../../lib/stopAutoEvents');

// determinisztikus véletlen (mulberry32) — a hiba mindig reprodukálható
function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const T0 = Date.parse('2026-10-06T00:00:00Z') / 1000;

// Valószerű nap: menetek és állások (néha 2 perces, néha 10 órás), plusz szándékos szemét
function track(r) {
  const pts = [];
  let t = T0 + Math.floor(r() * 3600), lat = 45 + r() * 3, lng = 21 + r() * 5;
  const legs = 3 + Math.floor(r() * 10);
  for (let k = 0; k < legs; k++) {
    const drive = 5 + Math.floor(r() * 120);
    const dLat = (r() - 0.5) * 0.02, dLng = (r() - 0.5) * 0.02;
    for (let i = 0; i < drive; i++) {
      t += 30 + Math.floor(r() * 90); lat += dLat; lng += dLng;
      pts.push([t, lat, lng, 40 + r() * 50, 1, null, null, null, Math.floor(r() * 360)]);
    }
    const kind = r();
    const mins = kind < 0.3 ? 2 + r() * 5 : kind < 0.6 ? 20 + r() * 60 : kind < 0.8 ? 40 + r() * 20 : 480 + r() * 300;
    const end = t + mins * 60;
    while (t < end) { t += 60 + Math.floor(r() * 300); pts.push([t, lat + (r() - 0.5) * 2e-4, lng, r() * 3, r() < 0.7 ? 0 : 1, null, null, null, null]); }
  }
  // szemét: null sebesség, hiányzó mezők, ismétlődő időbélyeg, NaN, rövid sor, nagy adathiány
  const junk = Math.floor(r() * 8);
  for (let j = 0; j < junk; j++) {
    const i = Math.floor(r() * pts.length);
    const v = r();
    if (v < 0.2) pts[i][3] = null;
    else if (v < 0.4) pts[i] = [pts[i][0], pts[i][1], pts[i][2]];
    else if (v < 0.6) pts.splice(i, 0, pts[i].slice());
    else if (v < 0.75) pts[i][4] = null;
    else if (v < 0.9) pts[i][8] = NaN;
    else pts.splice(i, Math.floor(r() * 20));
  }
  return pts.sort((a, b) => a[0] - b[0]);
}

const STATUSES = ['auto', 'suggested', 'unmatched'];

describe('stopMatch — fuzz: hibás / véletlen GPS-adaton sem dob, érvényes eredményt ad', () => {
  test('400 véletlen nap', () => {
    for (let seed = 1; seed <= 400; seed++) {
      const r = rng(seed);
      const pts = track(r);
      // az út fele esetben maga a nyomvonal (így a szünet- és forgalmi-megállás ágak is futnak)
      const roadLines = r() < 0.5 ? [pts.filter((p, i) => i % 3 === 0).map((p) => [p[1], p[2]])] : [];
      let cands;
      expect(() => { cands = sm.buildCandidates(pts, { roadLines }); }).not.toThrow();
      // jelöltek: időrendben, értelmes számok
      for (let i = 0; i < cands.length; i++) {
        const c = cands[i];
        expect(Number.isFinite(c.lat) && Number.isFinite(c.lng)).toBe(true);
        expect(c.to).toBeGreaterThanOrEqual(c.from);
        if (i) expect(c.from).toBeGreaterThanOrEqual(cands[i - 1].from);
        if (c.hop) expect(c.to - c.from).toBeGreaterThanOrEqual(120);
      }
      const n = 1 + Math.floor(r() * 4);
      const stops = [], exp = [];
      for (let k = 0; k < n; k++) {
        const c = cands[Math.floor(r() * Math.max(1, cands.length))];
        stops.push({ kind: k ? 'delivery' : 'pickup', loc: r() < 0.2 ? '' : 'Oras' + k, firma: r() < 0.3 ? null : 'Firma ' + k,
          data: r() < 0.3 ? null : '2026-10-0' + (6 + Math.floor(r() * 3)) });
        exp.push(r() < 0.2 ? {} : { cityGeo: c ? { lat: c.lat + (r() - 0.5) * 0.05, lng: c.lng } : { lat: 45, lng: 21 }, memory: [] });
      }
      let res;
      expect(() => { res = sm.align(stops, cands, exp); }).not.toThrow();
      expect(res).toHaveLength(n);
      let last = -1;
      for (const x of res) {
        expect(STATUSES).toContain(x.status);
        if (x.candIdx != null) { expect(x.candIdx).toBeGreaterThanOrEqual(last); last = x.candIdx; }
        // pihenő utáni rövid állás tanult adat nélkül sosem „biztos"
        if (x.status === 'auto' && x.candIdx != null) expect(cands[x.candIdx].hop).not.toBe(true);
      }
      // a gomb-pótlás döntése is: csak auto, sorrendben, kész ≥ érkezés
      const st = res.map((x, i) => {
        const c = x.candIdx != null ? cands[x.candIdx] : null;
        return { id: i + 1, kind: stops[i].kind, match_status: x.status,
          gps_arrived_at: c ? new Date(c.from * 1000).toISOString() : null, gps_left_at: c ? new Date(c.to * 1000).toISOString() : null };
      });
      const lastPt = pts.length ? pts[pts.length - 1][0] : null;
      let plan;
      expect(() => { plan = ae.planAutoFill(st, lastPt, (lastPt || T0) * 1000 + 3600e3); }).not.toThrow();
      let prevIdx = -1;
      for (const p of plan) {
        const i = st.findIndex((s) => s.id === p.id);
        expect(i).toBe(prevIdx + 1); prevIdx = i;               // nem ugrik át állomást
        expect(st[i].match_status).toBe('auto');
        if (p.arrive) expect(Date.parse(p.done)).toBeGreaterThan(Date.parse(p.arrive));
      }
      // térképes javítás: bárhová koppint, nem dob
      const any = pts[Math.floor(r() * Math.max(1, pts.length))];
      expect(() => ae.dwellNear(pts, any ? any[1] : 45, any ? any[2] : 21, 400)).not.toThrow();
    }
  });

  test('üres / értelmetlen bemenet', () => {
    expect(sm.buildCandidates(null)).toEqual([]);
    expect(sm.buildCandidates([])).toEqual([]);
    expect(sm.buildCandidates([[T0, 45, 21, 0]])).toEqual([]);
    expect(sm.align([], [], [])).toEqual([]);
    expect(sm.align([{ loc: 'X' }], [], [{}])[0].status).toBe('unmatched');
    expect(ae.planAutoFill(null, 1)).toEqual([]);
    expect(ae.planAutoFill([{ id: 1, match_status: 'auto', gps_arrived_at: 'nem dátum', gps_left_at: 'x' }], T0, Date.now())).toEqual([]);
    expect(ae.dwellNear([], 45, 21)).toBeNull();
    expect(ae.dwellNear([[1, 45, 21]], NaN, 21)).toBeNull();
  });
});
