// Rövid (pl. 5 perces) állás ismert rakodóhelyen: ha ott megállt és utána továbbment, ott rakodott.
// Valós eset: ugyanarra a lerakóra (Copșa Mică, Rebat) sokadszor jön, a lerakás 5 perc alatt megvolt,
// a régi motor (min. 20 perc) nem vette jelöltnek → a sofőrnek nem ajánlotta fel.
jest.mock('../../db', () => require('../helpers/db-mock').pool);
jest.mock('../../lib/mapsProvider', () => ({ geocode: jest.fn() }));
jest.mock('../../lib/stopWaybill', () => ({
  getSettings: jest.fn().mockResolvedValue({ auto_apply: false, min_score: 80, auto_events: true }),
  qualifies: jest.fn().mockReturnValue(false),
  applyStop: jest.fn().mockResolvedValue({ ok: true, points: 1, waybills: 1 }),
}));
jest.mock('../../lib/stopAutoEvents', () => ({ applyAutoEvents: jest.fn().mockResolvedValue({ filled: 1 }) }));

const sm = require('../../lib/stopMatch');
const { planAutoFill } = jest.requireActual('../../lib/stopAutoEvents');
const { pool, rows, reset } = require('../helpers/db-mock');
const maps = require('../../lib/mapsProvider');
const runner = require('../../lib/stopMatchRunner');

const T0 = Date.parse('2026-11-05T05:00:00Z') / 1000;
function drive(p, t, a, b, mins) {
  for (let i = 1; i <= mins; i++) { const f = i / mins; p.push([t + i * 60, a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, 70, 1, null, null, null, 90]); }
  return t + mins * 60;
}
function stand(p, t, at, mins, ign) {
  for (let i = 1; i <= mins; i++) p.push([t + i * 60, at[0] + (i % 2) * 0.00002, at[1], 0, ign == null ? 0 : ign, null, null, null, null]);
  return t + mins * 60;
}
const REBAT = [46.1105, 24.3050], ARAD = [46.1866, 21.3123], MID = [46.15, 23.0], AWAY = [46.05, 24.60];

// előző nap: hosszú lerakás Rebatnál → felrakás Aradon; ma reggel: 5 perc Rebatnál, majd továbbmegy
function track(shortMins, ign) {
  const p = [[T0, MID[0], MID[1], 0, 1, null, null, null, null]];
  let t = T0;
  t = drive(p, t, MID, REBAT, 60); t = stand(p, t, REBAT, 45);           // 1. lerakás (hosszú)
  t = drive(p, t, REBAT, ARAD, 120); t = stand(p, t, ARAD, 50);          // felrakás
  t = drive(p, t, ARAD, REBAT, 150); t = stand(p, t, REBAT, shortMins, ign); // 2. lerakás (rövid)
  drive(p, t, REBAT, AWAY, 40);
  return p;
}
const SITE = [{ lat: REBAT[0], lng: REBAT[1], radius_m: 250 }];
const shortCand = (cands) => cands.find((c) => c.atSite);

describe('rövid állás ismert rakodóhelyen', () => {
  test('ismert hely nélkül az 5 perces állás nem jelölt (régi viselkedés)', () => {
    const c = sm.buildCandidates(track(5), {});
    expect(c.length).toBe(2);
    expect(c.some((x) => x.dwell < 20 * 60)).toBe(false);
  });

  test('ismert helyen az 5 perces állás jelölt, a hosszú állásokkal nem duplikálva', () => {
    const c = sm.buildCandidates(track(5), { sitePoints: SITE });
    expect(c.length).toBe(3);
    const s = shortCand(c);
    expect(s).toBeTruthy();
    expect(s.dwell).toBeGreaterThanOrEqual(4 * 60);
    expect(s.dwell).toBeLessThanOrEqual(6 * 60);
    // a hosszú (45 perces) rebati állás nem kapott második, rövid példányt
    expect(c.filter((x) => Math.abs(x.lat - REBAT[0]) < 0.01).length).toBe(2);
  });

  test('máshol (nem ismert helyen) a rövid állás továbbra sem jelölt', () => {
    const c = sm.buildCandidates(track(5), { sitePoints: [{ lat: 45.0, lng: 25.0 }] });
    expect(shortCand(c)).toBeUndefined();
  });

  test('1 percnél rövidebb megállás nem jelölt (lámpa, sorompó)', () => {
    const c = sm.buildCandidates(track(1), { sitePoints: SITE });
    expect(shortCand(c)).toBeUndefined();
  });

  test('forgalmi megállás az úton (járó motor, manőver nélkül, 3 perc) nem jelölt', () => {
    const road = [[[REBAT[0] - 0.01, REBAT[1]], [REBAT[0] + 0.01, REBAT[1]]]];
    const c = sm.buildCandidates(track(3, 1), { sitePoints: SITE, roadLines: road });
    expect(shortCand(c)).toBeUndefined();
    // ugyanez gyújtás nélkül (leállította) → rakodás
    expect(shortCand(sm.buildCandidates(track(3, 0), { sitePoints: SITE, roadLines: road }))).toBeTruthy();
  });

  test('pontozás: rövid megállás ismert helyen csak kis levonás (nem a „rövid" -10)', () => {
    const c = shortCand(sm.buildCandidates(track(5), { sitePoints: SITE }));
    const r = sm.scorePair({ kind: 'delivery', loc: 'Strada Uzinei, 555400 Copșa Mică', firma: 'Rebat', data: c.day },
      c, { memory: SITE });
    const keys = r.signals.map((x) => x[0]);
    expect(keys).toContain('short_site');
    expect(keys).not.toContain('short_dwell');
    expect(keys).toContain('memory');
  });

  test('párosítás: a mai lerakás a rövid álláshoz kerül, „biztos", és a gomb-pótlás felajánlja', () => {
    const pts = track(5);
    const cands = sm.buildCandidates(pts, { sitePoints: SITE });
    const day = (sec) => sm.localDay(sec);
    const stops = [
      { kind: 'delivery', loc: 'Strada Uzinei, 555400 Copșa Mică', firma: 'Rebat', data: day(cands[0].from),
        done_at: new Date((cands[0].to + 120) * 1000).toISOString() },
      { kind: 'pickup', loc: 'Arad', firma: 'Alfa', data: day(cands[1].from), done_at: new Date((cands[1].to + 120) * 1000).toISOString() },
      { kind: 'delivery', loc: 'Strada Uzinei, 555400 Copșa Mică', firma: 'Rebat', data: day(cands[2].from), done_at: null },
    ];
    const ex = { memory: SITE, cityGeo: { lat: REBAT[0], lng: REBAT[1] } };
    const res = sm.align(stops, cands, [ex, { memory: [], cityGeo: { lat: ARAD[0], lng: ARAD[1] } }, ex]);
    expect(res[0].candIdx).toBe(0);
    expect(res[1].candIdx).toBe(1);
    expect(res[2].candIdx).toBe(2);
    expect(cands[2].atSite).toBe(true);
    expect(res[2].status).toBe('auto');

    const c = cands[2];
    const plan = planAutoFill([
      { id: 1, kind: 'delivery', done_at: stops[0].done_at, arrived_at: stops[0].done_at },
      { id: 2, kind: 'pickup', done_at: stops[1].done_at, arrived_at: stops[1].done_at },
      { id: 3, kind: 'delivery', match_status: res[2].status, gps_arrived_at: new Date(c.from * 1000).toISOString(), gps_left_at: new Date(c.to * 1000).toISOString() },
    ], pts[pts.length - 1][0], (pts[pts.length - 1][0] + 600) * 1000);
    expect(plan).toEqual([expect.objectContaining({ id: 3, filled: 'both' })]);
  });
});

describe('pressSites — ismert hely a sofőr gombnyomásaiból', () => {
  const pts = track(5);
  const at = (min) => new Date((T0 + min * 60) * 1000).toISOString();
  test('két állomás gombnyomása ugyanott (álló kamion) → ismert hely', () => {
    const r = sm.pressSites(pts, [{ id: 1, done_at: at(100) }, { id: 2, done_at: at(80) }]);
    expect(r.length).toBe(2);
    expect(Math.abs(r[0].lat - REBAT[0])).toBeLessThan(0.002);
  });
  test('egyetlen gombnyomás csak akkor, ha a felismert hellyel egyezik', () => {
    expect(sm.pressSites(pts, [{ id: 1, done_at: at(100) }])).toEqual([]);
    expect(sm.pressSites(pts, [{ id: 1, done_at: at(100), actual_lat: REBAT[0], actual_lng: REBAT[1] }]).length).toBe(1);
    expect(sm.pressSites(pts, [{ id: 1, done_at: at(100), actual_lat: ARAD[0], actual_lng: ARAD[1] }])).toEqual([]);
  });
  test('menet közben megnyomott gomb nem számít; a „kész" hiányában az „odaértem" számít', () => {
    expect(sm.pressSites(pts, [{ id: 1, done_at: at(130), actual_lat: REBAT[0], actual_lng: REBAT[1] }])).toEqual([]);
    expect(sm.pressSites(pts, [{ id: 1, arrived_at: at(70), actual_lat: REBAT[0], actual_lng: REBAT[1] }]).length).toBe(1);
  });
  test('GPS-pont nélküli időpont (5 percnél messzebb) nem számít', () => {
    expect(sm.pointAt(pts, T0 - 3600)).toBeNull();
    expect(sm.pointAt(pts, T0 + 100 * 60)).toBeTruthy();
  });
});

describe('sorrend-korlát', () => {
  test('az előző állomás kész-ideje előtt véget ért állás büntetést kap', () => {
    const c = sm.buildCandidates(track(5), { sitePoints: SITE });
    const stop = { kind: 'delivery', loc: 'Copșa Mică', firma: 'Rebat', data: c[2].day };
    const prevDone = c[1].to + 60;
    const a = sm.scorePair(stop, c[0], { memory: SITE, prevDone });
    const b = sm.scorePair(stop, c[2], { memory: SITE, prevDone });
    expect(a.signals.map((x) => x[0])).toContain('before_prev');
    expect(b.signals.map((x) => x[0])).not.toContain('before_prev');
    expect(b.score).toBeGreaterThan(a.score);
  });
});

describe('matchOrder — a fuvar korábbi, azonos helyű állomása is ismert hely', () => {
  // a település geokódolható (a cég neve nem) — mint élesben a legtöbbször
  beforeEach(() => {
    reset();
    maps.geocode.mockImplementation(async (cid, text) => (/rebat|alfa/i.test(text) ? null
      : /cop/i.test(text) ? { lat: REBAT[0] + 0.01, lng: REBAT[1] + 0.01 } : /arad/i.test(text) ? { lat: ARAD[0], lng: ARAD[1] } : null));
  });

  function route(stops) {
    pool.query.mockImplementation(async (sql) => {
      const q = String(sql);
      if (/FROM orders WHERE id=\$1/.test(q)) return rows([{ id: 'O1', status: 'In Curs', rendszam_camion: 'B104VLR', data_incarcare: '2026-11-05', data_descarcare: '2026-11-05' }]);
      if (/FROM order_stops WHERE order_id=\$1/.test(q)) return rows(stops);
      if (/FROM gps_track_days/.test(q)) return rows([{ day: '2026-11-05', points_json: JSON.stringify(track(5)), segments: [], complete: true }]);
      if (/^\s*UPDATE/.test(q)) return { rows: [], rowCount: 1 };
      return rows([]);
    });
  }
  const DONE1 = new Date((T0 + 107 * 60) * 1000).toISOString();     // 1. lerakás kész (gomb)
  const DONE2 = new Date((T0 + 277 * 60) * 1000).toISOString();     // felrakás kész (gomb)
  const upd = (id) => pool.query.mock.calls.find((c) => /UPDATE order_stops SET actual_lat/.test(String(c[0])) && c[1][0] === id);

  test('helymemória nélkül is: a már megerősített rebati lerakás helyén a rövid állás „biztos"', async () => {
    route([
      { id: 1, kind: 'delivery', loc: 'Strada Uzinei, 555400 Copșa Mică', firma: 'Rebat', data: '2026-11-05', match_status: 'confirmed', actual_lat: REBAT[0], actual_lng: REBAT[1], done_at: DONE1 },
      { id: 2, kind: 'pickup', loc: 'Arad', firma: 'Alfa', data: '2026-11-05', match_status: 'confirmed', actual_lat: ARAD[0], actual_lng: ARAD[1], done_at: DONE2 },
      { id: 3, kind: 'delivery', loc: 'Strada Uzinei, 555400 Copșa Mică', firma: 'Rebat', data: '2026-11-05', match_status: null },
    ]);
    const r = await runner.matchOrder(7, 'O1', { cacheOnly: true });
    expect(r.ok).toBe(true);
    const u = upd(3);
    expect(u).toBeTruthy();
    const [, , lat, lng] = u[1];
    expect(Math.abs(lat - REBAT[0])).toBeLessThan(0.005);
    expect(Math.abs(lng - REBAT[1])).toBeLessThan(0.005);
    expect(u[1][11]).toBe('auto');                       // match_status
    expect(String(u[0])).toMatch(/company_id=\$2/);
    const det = JSON.parse(u[1][12]);
    expect(det.dur_min).toBeLessThanOrEqual(6);
    expect(det.signals.some((x) => x[0] === 'short_site')).toBe(true);
  });

  test('csak javaslat-állapotú testvér: a sofőr ott nyomta meg a „kész" gombot → ismert hely, a rövid állás „biztos"', async () => {
    const DONE_AT_SITE = new Date((T0 + 100 * 60) * 1000).toISOString();   // még állt Rebatnál
    route([
      { id: 1, kind: 'delivery', loc: 'Strada Uzinei, 555400 Copșa Mică', firma: 'Rebat', data: '2026-11-05', match_status: 'suggested', actual_lat: REBAT[0], actual_lng: REBAT[1], arrived_at: DONE_AT_SITE, done_at: DONE_AT_SITE },
      { id: 2, kind: 'pickup', loc: 'Arad', firma: 'Alfa', data: '2026-11-05', match_status: 'suggested', done_at: DONE2 },
      { id: 3, kind: 'delivery', loc: 'Strada Uzinei, 555400 Copșa Mică', firma: 'Rebat', data: '2026-11-05', match_status: null },
    ]);
    await runner.matchOrder(7, 'O1', { cacheOnly: true });
    const u = upd(3);
    expect(u).toBeTruthy();
    expect(Math.abs(u[1][2] - REBAT[0])).toBeLessThan(0.005);
    expect(u[1][11]).toBe('auto');
    expect(JSON.parse(u[1][12]).dur_min).toBeLessThanOrEqual(6);
  });

  test('csak javaslat (nem megerősített) testvér, a gombot menet közben nyomta → nem ismert hely', async () => {
    route([
      { id: 1, kind: 'delivery', loc: 'Strada Uzinei, 555400 Copșa Mică', firma: 'Rebat', data: '2026-11-05', match_status: 'suggested', actual_lat: REBAT[0], actual_lng: REBAT[1], done_at: DONE1 },
      { id: 2, kind: 'pickup', loc: 'Arad', firma: 'Alfa', data: '2026-11-05', match_status: 'confirmed', actual_lat: ARAD[0], actual_lng: ARAD[1], done_at: DONE2 },
      { id: 3, kind: 'delivery', loc: 'Strada Uzinei, 555400 Copșa Mică', firma: 'Rebat', data: '2026-11-05', match_status: null },
    ]);
    await runner.matchOrder(7, 'O1', { cacheOnly: true });
    const u = upd(3);
    expect(!u || u[1][11] !== 'auto').toBe(true);
  });
});
