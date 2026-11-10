// ============================================================
//  Unit-teszt — a cím-felismerés két bővítése (lib/stopMatch.js):
//   1. a cég MENTETT helye akkor is számít, ha a fuvaron nincs / más a cégnév
//      (a fuvarba a mentett hely címe került, vagy a hely a tervezett település környékén van);
//   2. ha egy több pontos fuvarnál a KÖVETKEZŐ állomás megvan, a kimaradt előző is
//      megtörtént → megnézzük, járt-e a kamion a tervezett helyen, és azt a látogatást kapja.
//  + a menetlevél pontjainak GPS-ideje (lib/waybillRows.js).
// ============================================================
const sm = require('../../lib/stopMatch');
const { buildRouteRows } = require('../../lib/waybillRows');

const T0 = Date.parse('2026-11-05T05:00:00Z') / 1000;
function drive(p, t, a, b, mins) {
  for (let i = 1; i <= mins; i++) { const f = i / mins; p.push([t + i * 60, a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, 70, 1, null, null, null, 90]); }
  return t + mins * 60;
}
function stand(p, t, at, mins) {
  for (let i = 1; i <= mins; i++) p.push([t + i * 60, at[0] + (i % 2) * 0.00002, at[1], 0, 0, null, null, null, null]);
  return t + mins * 60;
}
const A = [46.1105, 24.3050], B = [46.1866, 21.3123], START = [46.15, 25.2], END = [46.3, 20.5];

describe('savedFor — a mentett helyek hozzárendelése', () => {
  const rows = [
    { label: 'Rebat Copșa', firma: 'Rebat SRL', address: 'Str. Fabricii 4, Copșa Mică', lat: A[0], lng: A[1], radius_m: 250 },
    { label: 'Depozit vest', firma: null, address: 'Zona Industrială Vest 12, Arad', lat: B[0], lng: B[1] },
    { label: 'Fără coordonate', firma: 'Rebat SRL', address: 'x', lat: null, lng: null },
  ];
  test('cégnév-egyezés → az állomás saját helye (régi viselkedés)', () => {
    const r = sm.savedFor({ loc: 'Copșa Mică', firma: 'REBAT' }, rows, null);
    expect(r.memory.map((m) => m.label)).toEqual(['Rebat Copșa']);
  });
  test('cégnév nélkül: a fuvarba a mentett hely címe került → saját hely', () => {
    const r = sm.savedFor({ loc: 'Zona Industrială Vest 12, Arad', firma: '' }, rows, null);
    expect(r.memory.map((m) => m.label)).toEqual(['Depozit vest']);
  });
  test('más cégnév, de a mentett hely a tervezett település környékén van → „saved"', () => {
    const r = sm.savedFor({ loc: 'Arad', firma: 'Alt Client SA' }, rows, { lat: B[0] + 0.02, lng: B[1] });
    expect(r.memory).toHaveLength(0);
    expect(r.saved.map((m) => m.label)).toEqual(['Depozit vest']);
  });
  test('távoli mentett hely nem számít; hibás bemenet nem dob', () => {
    expect(sm.savedFor({ loc: 'Arad', firma: 'X' }, rows, { lat: 44.4, lng: 26.1 })).toEqual({ memory: [], saved: [] });
    expect(sm.savedFor(null, null, null)).toEqual({ memory: [], saved: [] });
  });
  test('a mentett helyen álló jelölt „saved_place" jelet kap, és rövid állásból is jelölt lesz', () => {
    const p = [[T0, START[0], START[1], 0, 1, null, null, null, null]];
    let t = T0;
    t = drive(p, t, START, B, 180); t = stand(p, t, B, 6); drive(p, t, B, END, 60);
    const saved = [{ lat: B[0], lng: B[1] }];
    expect(sm.buildCandidates(p, {})).toHaveLength(0);                       // 6 perc magában kevés
    const c = sm.buildCandidates(p, { sitePoints: saved });
    expect(c).toHaveLength(1);
    const sp = sm.scorePair({ loc: 'Arad', firma: 'Alt Client SA', data: '2026-11-05' }, c[0], { saved, cityGeo: { lat: B[0], lng: B[1] } });
    expect(sp.signals.some((x) => x[0] === 'saved_place' && x[1] === 25)).toBe(true);
  });
});

describe('inferVisits — a következő állomás megvan → az előző is megtörtént', () => {
  // A-nál csak 1 percet állt (nem jelölt), B-nél 50 percet (megvan)
  function track(aMins) {
    const p = [[T0, START[0], START[1], 0, 1, null, null, null, null]];
    let t = T0;
    t = drive(p, t, START, A, 60);
    const aFrom = t;
    if (aMins) t = stand(p, t, A, aMins);
    t = drive(p, t, A, B, 180);
    const bFrom = t; t = stand(p, t, B, 50);
    drive(p, t, B, END, 60);
    return { p, aFrom, bFrom, bTo: bFrom + 50 * 60 };
  }
  const stops = [{ id: 1, kind: 'delivery', loc: 'Copșa Mică', firma: 'Rebat' }, { id: 2, kind: 'delivery', loc: 'Arad', firma: 'Client' }];
  const resOf = () => [{ stopIdx: 0, candIdx: null, status: 'unmatched' }, { stopIdx: 1, candIdx: 0, status: 'auto' }];

  test('ismert (mentett) helyen megállt → azt a látogatást kapja, a megállás idejével', () => {
    const k = track(2);
    const cands = [{ from: k.bFrom, to: k.bTo, lat: B[0], lng: B[1] }];
    const out = sm.inferVisits(stops, resOf(), cands, [{ memory: [{ lat: A[0], lng: A[1], radius_m: 250 }] }, {}], k.p);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ stopIdx: 0, level: 'site', stopped: true, score: 55 });
    expect(Math.abs(out[0].lat - A[0])).toBeLessThan(0.001);
    expect(out[0].from).toBeGreaterThanOrEqual(k.aFrom - 120);
    expect(out[0].to).toBeLessThan(k.bFrom);
    expect(out[0].signals.map((x) => x[0])).toEqual(['next_done', 'visit_site']);
  });

  test('csak a település ismert: megállt ott → „visit_city"; csak áthaladt → gyengébb „pass_city"', () => {
    const k = track(2);
    const cands = [{ from: k.bFrom, to: k.bTo, lat: B[0], lng: B[1] }];
    const exp = [{ cityGeo: { lat: A[0] + 0.005, lng: A[1] } }, {}];
    const a = sm.inferVisits(stops, resOf(), cands, exp, k.p)[0];
    expect(a).toMatchObject({ level: 'city', stopped: true, score: 40 });
    const k2 = track(0);
    const b = sm.inferVisits(stops, resOf(), [{ from: k2.bFrom, to: k2.bTo, lat: B[0], lng: B[1] }], exp, k2.p)[0];
    expect(b).toMatchObject({ level: 'city', stopped: false, score: 30 });
    expect(b.signals[1][0]).toBe('pass_city');
  });

  test('nem járt a tervezett helyen → nincs kitalált találat', () => {
    const k = track(2);
    const cands = [{ from: k.bFrom, to: k.bTo, lat: B[0], lng: B[1] }];
    expect(sm.inferVisits(stops, resOf(), cands, [{ cityGeo: { lat: 44.43, lng: 26.10 } }, {}], k.p)).toEqual([]);
  });

  test('a következő állomást a sofőr gombja jelzi (GPS-találat nélkül) → „next_button"', () => {
    const k = track(2);
    const st = [stops[0], { ...stops[1], done_at: new Date((k.bFrom + 600) * 1000).toISOString() }];
    const res = [{ stopIdx: 0, candIdx: null }, { stopIdx: 1, candIdx: null }];
    const out = sm.inferVisits(st, res, [], [{ memory: [{ lat: A[0], lng: A[1] }] }, {}], k.p);
    expect(out).toHaveLength(1);
    expect(out[0].signals[0][0]).toBe('next_button');
  });

  test('nem következtet: nincs későbbi találat / az iroda már döntött / az utolsó állomás', () => {
    const k = track(2);
    const exp = [{ memory: [{ lat: A[0], lng: A[1] }] }, { memory: [{ lat: B[0], lng: B[1] }] }];
    expect(sm.inferVisits(stops, [{ candIdx: null }, { candIdx: null }], [], exp, k.p)).toEqual([]);
    const cands = [{ from: k.bFrom, to: k.bTo, lat: B[0], lng: B[1] }];
    for (const ms of ['confirmed', 'rejected']) {
      expect(sm.inferVisits([{ ...stops[0], match_status: ms }, stops[1]], resOf(), cands, exp, k.p)).toEqual([]);
    }
    expect(sm.inferVisits(stops, resOf(), cands, exp, [])).toEqual([]);
    expect(sm.inferVisits(null, null, null, null, null)).toEqual([]);
  });

  test('a látogatás csak az előző és a következő állomás KÖZÖTT számít (korábbi ottjárt nem)', () => {
    // A-nál járt, DE még az előző (megtalált) állomás előtt → nem ez a látogatás
    const p = [[T0, START[0], START[1], 0, 1, null, null, null, null]];
    let t = T0;
    t = drive(p, t, START, A, 60); t = stand(p, t, A, 3);
    t = drive(p, t, A, END, 120); const e0 = t; t = stand(p, t, END, 40); const e1 = t;
    t = drive(p, t, END, B, 60); const b0 = t; t = stand(p, t, B, 40);
    const st = [{ id: 0, kind: 'pickup', loc: 'X' }, stops[0], stops[1]];
    const cands = [{ from: e0, to: e1, lat: END[0], lng: END[1] }, { from: b0, to: t, lat: B[0], lng: B[1] }];
    const res = [{ candIdx: 0 }, { candIdx: null }, { candIdx: 1 }];
    expect(sm.inferVisits(st, res, cands, [{}, { memory: [{ lat: A[0], lng: A[1] }] }, {}], p)).toEqual([]);
  });
});

describe('menetlevél: a pont ideje a GPS-ből', () => {
  const st = { 5: { from: '2026-03-03T08:15:00Z', to: '2026-03-03T09:40:00Z' }, 6: { from: '2026-03-03T10:00:00Z' } };
  test('beírt óra nélkül a GPS érkezés–távozás kerül ki, a valós nappal', () => {
    const r = buildRouteRows([{ tip: 'Încărcare', loc: 'Cluj', data: '2026-03-02', stopId: 5 }], [], st);
    expect(r[0]).toMatchObject({ date: '2026-03-03', time: '11:40', gps: true });
  });
  test('a sofőr által beírt óra elsőbbséget élvez; stopId / GPS-adat nélkül nincs változás', () => {
    const r = buildRouteRows([
      { tip: 'Descărcare', loc: 'W', data: '2026-03-03', time: '14:00', stopId: 6 },
      { tip: 'Descărcare', loc: 'V', data: '2026-03-04' },
      { tip: 'Descărcare', loc: 'U', data: '2026-03-04', stopId: 99 },
    ], [], st);
    expect(r[0]).toEqual({ kind: 'punct', tip: 'Descărcare', loc: 'W', date: '2026-03-03', time: '14:00' });
    expect(r[1].time).toBe(''); expect(r[2].time).toBe('');
  });
  test('a GPS-idő a határátlépések közé rendezéshez is számít', () => {
    const r = buildRouteRows([{ tip: 'Încărcare', loc: 'Cluj', data: '2026-03-03', stopId: 5 }],
      [{ datetime: '2026-03-03T07:00:00Z', direction: 'OUT', locatie: 'Borș' }, { datetime: '2026-03-03T12:00:00Z', direction: 'IN', locatie: 'Borș' }], st);
    expect(r.map((x) => x.kind)).toEqual(['border', 'punct', 'border']);
  });
});
