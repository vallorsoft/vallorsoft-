// lib/stopMatch.js + handlers/stopMatch.js — tényleges fel-/lerakási hely a GPS-ből
jest.mock('../../db', () => require('../helpers/db-mock').pool);
jest.mock('../../lib/featureEnabled', () => ({ featureEnabled: jest.fn() }));
jest.mock('../../lib/audit', () => ({ fromReq: jest.fn() }));
jest.mock('../../lib/stopMatchRunner', () => ({ matchOrder: jest.fn(), learnPlace: jest.fn(), reversePlace: jest.fn(),
  formatAddress: (...a) => jest.requireActual('../../lib/stopMatchRunner').formatAddress(...a) }));

const sm = require('../../lib/stopMatch');
const { pool, rows, reset } = require('../helpers/db-mock');
const { featureEnabled } = require('../../lib/featureEnabled');
const runner = require('../../lib/stopMatchRunner');
const h = require('../../handlers/stopMatch');

// Szintetikus nap: menet → állás A (Cluj, 50 perc) → menet → rövid tankolás → menet → állás B (Turda, 40 perc)
const T0 = Date.parse('2026-10-06T06:00:00Z') / 1000;
function drive(pts, t, from, to, mins) {
  for (let i = 1; i <= mins; i++) {
    const f = i / mins;
    pts.push([t + i * 60, from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f, 70, 1, null, null, null, 90]);
  }
  return t + mins * 60;
}
function stand(pts, t, at, mins, ign) {
  for (let i = 1; i <= mins; i++) pts.push([t + i * 60, at[0] + (i % 2) * 0.00002, at[1], 0, ign == null ? 0 : ign, null, null, null, null]);
  return t + mins * 60;
}
const CLUJ = [46.7712, 23.6236], TURDA = [46.5667, 23.7833], MID = [46.65, 23.70], START = [46.90, 23.40];
function day() {
  const p = [[T0, START[0], START[1], 0, 1, null, null, null, null]];
  let t = T0;
  t = drive(p, t, START, CLUJ, 40);
  t = stand(p, t, CLUJ, 50);          // felrakó
  t = drive(p, t, CLUJ, MID, 20);
  t = stand(p, t, MID, 8);            // rövid (nem jelölt)
  t = drive(p, t, MID, TURDA, 20);
  t = stand(p, t, TURDA, 40);         // lerakó
  t = drive(p, t, TURDA, START, 30);
  return p;
}

describe('stopMatch motor', () => {
  test('jelöltek: csak a min. 20 perces állások', () => {
    const c = sm.buildCandidates(day(), {});
    expect(c.length).toBe(2);
    expect(Math.abs(c[0].lat - CLUJ[0])).toBeLessThan(0.01);
    expect(Math.abs(c[1].lat - TURDA[0])).toBeLessThan(0.01);
  });

  test('sorrendtartó párosítás + a késői gomb nem rontja el', () => {
    const cands = sm.buildCandidates(day(), {});
    const stops = [
      { kind: 'pickup', loc: 'Cluj-Napoca', firma: 'Alfa SRL', data: '2026-10-06', done_at: new Date((T0 + 4 * 3600) * 1000).toISOString() },
      { kind: 'delivery', loc: 'Turda', firma: 'Beta SRL', data: '2026-10-06', done_at: null },
    ];
    const expect_ = [
      { cityGeo: { lat: CLUJ[0], lng: CLUJ[1] }, memory: [] },
      { cityGeo: { lat: TURDA[0], lng: TURDA[1] }, memory: [] },
    ];
    const r = sm.align(stops, cands, expect_);
    expect(r[0].candIdx).toBe(0);
    expect(r[1].candIdx).toBe(1);
    expect(['auto', 'suggested']).toContain(r[0].status);
  });

  test('a gombnyomás UTÁN kezdődő állás nem lehet a megálló', () => {
    const cands = sm.buildCandidates(day(), {});
    const done = new Date((T0 - 2 * 3600) * 1000).toISOString(); // 04:00 — jóval a Cluj-állás előtt
    const sc = sm.scorePair({ loc: 'Cluj', data: '2026-10-06', done_at: done }, cands[0], { cityGeo: { lat: CLUJ[0], lng: CLUJ[1] } });
    expect(sc.signals.find((s) => s[0] === 'after_button')).toBeTruthy();
  });

  test('távoli település → nincs hozzárendelés', () => {
    const cands = sm.buildCandidates(day(), {});
    const r = sm.align([{ kind: 'pickup', loc: 'Constanta' }], cands, [{ cityGeo: { lat: 44.17, lng: 28.63 } }]);
    expect(r[0].candIdx).toBeNull();
    expect(r[0].status).toBe('unmatched');
  });

  test('helymemória és tankolás jelek', () => {
    const cands = sm.buildCandidates(day(), { refuels: [{ t: T0 + 45 * 60, lat: CLUJ[0], lng: CLUJ[1] }] });
    const sc = sm.scorePair({ loc: 'Cluj' }, cands[0], { memory: [{ lat: CLUJ[0], lng: CLUJ[1], radius_m: 250 }] });
    const keys = sc.signals.map((s) => s[0]);
    expect(keys).toContain('memory');
    expect(keys).toContain('refuel');
  });

  test('savedFor: a tervezett pontos cím közelében lévő mentett hely az állomásé', () => {
    const rows = [{ label: 'Rampa', lat: 46.1801, lng: 21.3101, radius_m: 100 }, { label: 'Depo', lat: 46.19, lng: 21.33 }];
    const r = sm.savedFor({ loc: 'Policlinica AS, Strada Făt Frumos, Arad', firma: 'Vesna GC' }, rows, null, { lat: 46.18, lng: 21.31 });
    expect(r.memory.map((m) => m.label)).toEqual(['Rampa']);
    expect(r.saved.map((m) => m.label)).toEqual(['Depo']);   // település nélkül is a környékbeli mentett hely
  });

  test('cityQuery / norm', () => {
    expect(sm.cityQuery('Str. Fabricii 12, Arad, Romania')).toBe('Arad');
    // a címkiegészítő „Hely neve, Utca, Település, Irsz., Ország" formája: nem a hely neve a település
    expect(sm.cityQuery('Policlinica AS, Strada Făt Frumos, Arad, 310364, RO')).toBe('Arad');
    expect(sm.cityQuery('Kaufland, Calea Victoriei 10, București, RO')).toBe('București');
    expect(sm.cityQuery('310364 Arad, RO')).toBe('Arad');
    expect(sm.cityQuery('DN1 km 12, Bod, Brașov')).toBe('Bod');
    expect(sm.cityQuery('Copșa Mică')).toBe('Copșa Mică');
    expect(sm.cityQuery('Arad, Strada X 2')).toBe('Arad');
    expect(sm.norm('Brașov')).toBe('brasov');
  });
});

function call(fn, user, arg) {
  return new Promise((resolve) => {
    h[fn]({ session: { user }, headers: {}, socket: {} }, { json: (b) => resolve(b.result) }, [arg || {}]);
  });
}
const ADMIN = { pozicio: 'Admin', company_id: 7, email: 'a@x.ro' };

describe('handlers/stopMatch', () => {
  beforeEach(() => { reset(); featureEnabled.mockReset().mockResolvedValue(true); runner.matchOrder.mockReset().mockResolvedValue({ ok: true }); });

  test('sofőr nem érheti el', async () => {
    for (const fn of ['stopMatchList', 'stopMatchDecide', 'stopMatchRerun', 'stopMatchBackfill', 'stopMatchProbe']) {
      const r = await call(fn, { pozicio: 'Sofer', company_id: 7 });
      expect(r.ok).toBe(false);
    }
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('kikapcsolt funkció', async () => {
    featureEnabled.mockResolvedValue(false);
    const r = await call('stopMatchList', ADMIN);
    expect(r.ok).toBe(false);
  });

  test('lista cégre szűrt', async () => {
    pool.query.mockResolvedValueOnce(rows([{ id: 1 }])).mockResolvedValueOnce(rows([{ st: 'auto', n: 1 }])).mockResolvedValueOnce(rows([{ n: 0 }]));
    const r = await call('stopMatchList', ADMIN, { status: 'auto' });
    expect(r.ok).toBe(true);
    expect(pool.query.mock.calls[0][1][0]).toBe(7);
    expect(pool.query.mock.calls[0][0]).toMatch(/s\.company_id = \$1/);
  });

  test('elfogadás tanul + idegen pont nem található', async () => {
    pool.query.mockResolvedValueOnce(rows([])); // nincs ilyen pont a cégnél
    let r = await call('stopMatchDecide', ADMIN, { stop_id: 5, action: 'confirm' });
    expect(r.ok).toBe(false);
    pool.query.mockResolvedValueOnce(rows([{ id: 5, order_id: 'O1', actual_lat: 46.7, actual_lng: 23.6 }])).mockResolvedValueOnce(rows([]));
    r = await call('stopMatchDecide', ADMIN, { stop_id: 5, action: 'confirm' });
    expect(r.ok).toBe(true);
    expect(runner.learnPlace).toHaveBeenCalled();
  });

  test('újrafuttatás azonnal válaszol (háttérben fut)', async () => {
    let release;
    runner.matchOrder.mockReturnValue(new Promise((r) => { release = r; }));
    pool.query.mockResolvedValueOnce(rows([{ id: 'O1' }]));
    const r = await call('stopMatchRerun', ADMIN, { order_id: 'O1' });
    expect(r.ok).toBe(true);
    expect(r.running).toBe(true);
    release({ ok: true });
  });

  test('visszamenőleges futtatás: érvénytelen időszak', async () => {
    const r = await call('stopMatchBackfill', ADMIN, { from: '2026-10-10', to: '2026-10-01' });
    expect(r.ok).toBe(false);
  });
});

describe('handlers/stopMatch — menetlevél-beállítás', () => {
  beforeEach(() => { reset(); featureEnabled.mockReset().mockResolvedValue(true); });
  test('a beállítást csak Admin mentheti', async () => {
    const r = await call('stopMatchSettingsSave', { pozicio: 'Manager', company_id: 7, email: 'm@x.ro' }, { auto_apply: true, min_score: 80 });
    expect(r.ok).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });
  test('küszöb korlátok közé szorítva', async () => {
    pool.query.mockResolvedValue(rows([]));
    const r = await call('stopMatchSettingsSave', ADMIN, { auto_apply: false, min_score: 5 });
    expect(r.ok).toBe(true);
    expect(r.settings.min_score).toBe(30);
  });
});

describe('stopMatch — azonos nevű település, késés, tanulás', () => {
  // A valódi állás Malackyban (SK); a geokódoló a tervezett „Malacky"-t Bulgáriába tette
  const SK = { lat: 48.4361, lng: 17.0219 }, BG = { lat: 42.7, lng: 25.3 };
  const cand = { from: T0, to: T0 + 3600, dur: 3600, dwell: 3600, lat: SK.lat, lng: SK.lng, day: '2026-10-07',
    maneuvers: 4, night: 0, road_m: 90, refuel: false, place: { city: 'Malacky', country: 'SK', category: 'landuse', type: 'industrial' } };

  test('névegyezésnél a távoli (rossz országba geokódolt) település nem büntet', () => {
    const r = sm.scorePair({ loc: 'Malacky', data: '2026-10-06' }, cand, { cityGeo: BG });
    const keys = r.signals.map((x) => x[0]);
    expect(keys).toContain('homonym');
    expect(keys).toContain('city_name');
    expect(keys).not.toContain('city_dist');
    expect(r.score).toBeGreaterThanOrEqual(sm.SUGGEST_SCORE);
    const a = sm.align([{ kind: 'delivery', loc: 'Malacky', data: '2026-10-06' }], [cand], [{ cityGeo: BG }]);
    expect(a[0].candIdx).toBe(0);
  });

  test('névegyezésnél a 2 nappal későbbi lerakás sem büntet', () => {
    const late = { ...cand, day: '2026-10-08' };
    const withName = sm.scorePair({ loc: 'Malacky', data: '2026-10-06' }, late, {});
    expect(withName.signals.find((x) => x[0] === 'date')[1]).toBeGreaterThan(0);
    const noName = sm.scorePair({ loc: 'Senec', data: '2026-10-06' }, late, {});
    expect(noName.signals.find((x) => x[0] === 'date')[1]).toBeLessThan(0);
  });

  test('ugyanannál a cégnél elvetett hely erős mínuszt kap', () => {
    const r = sm.scorePair({ loc: 'Malacky', firma: 'Alfa Logistic SRL' }, cand,
      { badPlaces: [{ lat: SK.lat, lng: SK.lng, firma_norm: 'alfa logistic', hits: 1 }] });
    expect(r.signals.find((x) => x[0] === 'rejected_before')).toBeTruthy();
  });

  test('tanult súlyok: kevés adat semleges, sok elvetés csökkenti a jelet', () => {
    expect(sm.weightsFromFeedback([{ signal: 'offroad', accepted: 1, rejected: 1 }]).offroad).toBeUndefined();
    const w = sm.weightsFromFeedback([{ signal: 'offroad', accepted: 0, rejected: 20 }, { signal: 'memory', accepted: 30, rejected: 0 }]);
    expect(w.offroad).toBe(0.5);
    expect(w.memory).toBe(1.5);
    const base = sm.scorePair({ loc: 'X' }, cand, {}).signals.find((x) => x[0] === 'offroad')[1];
    const learned = sm.scorePair({ loc: 'X' }, cand, { weights: w }).signals.find((x) => x[0] === 'offroad')[1];
    expect(learned).toBeLessThan(base);
  });
});

describe('handlers/stopMatch — tanulás a döntésből', () => {
  beforeEach(() => {
    reset(); featureEnabled.mockReset().mockResolvedValue(true);
    runner.recordFeedback = jest.fn(); runner.recordBadPlace = jest.fn(); runner.requeueOpen = jest.fn();
  });
  test('elvetés: negatív visszajelzés + elvetett hely + a többi fuvar újraszámolása', async () => {
    pool.query.mockResolvedValueOnce(rows([{ id: 5, order_id: 'O1', firma: 'Alfa', actual_lat: 46.7, actual_lng: 23.6,
      match_status: 'auto', match_detail: { signals: [['offroad', 10], ['refuel', -20]] } }])).mockResolvedValue(rows([]));
    const r = await call('stopMatchDecide', ADMIN, { stop_id: 5, action: 'reject' });
    expect(r.ok).toBe(true);
    expect(runner.recordFeedback).toHaveBeenCalledWith(7, [['offroad', 10], ['refuel', -20]], false);
    expect(runner.recordBadPlace).toHaveBeenCalledWith(7, 46.7, 23.6, 'Alfa');
    expect(runner.requeueOpen).toHaveBeenCalledWith(7, 'O1');
  });
  test('másik jelölt választása: a régi hely elvetve, az új elfogadva', async () => {
    const picked = { lat: 48.43, lng: 17.02, score: 70, address: 'Malacky', signals: [['city_name', 20]] };
    pool.query.mockResolvedValueOnce(rows([{ id: 6, order_id: 'O2', firma: 'Beta', actual_lat: 42.7, actual_lng: 25.3,
      match_status: 'suggested', match_detail: { signals: [['offroad', 5]], candidates: [picked] } }])).mockResolvedValue(rows([]));
    const r = await call('stopMatchDecide', ADMIN, { stop_id: 6, action: 'pick', cand_idx: 0 });
    expect(r.ok).toBe(true);
    expect(runner.recordFeedback).toHaveBeenCalledWith(7, [['offroad', 5]], false);
    expect(runner.recordFeedback).toHaveBeenCalledWith(7, [['city_name', 20]], true);
    expect(runner.recordBadPlace).toHaveBeenCalledWith(7, 42.7, 25.3, 'Beta');
  });
});

describe('handlers/stopMatch — térképes kiválasztás', () => {
  beforeEach(() => {
    reset(); featureEnabled.mockReset().mockResolvedValue(true);
    runner.recordFeedback = jest.fn(); runner.recordBadPlace = jest.fn(); runner.requeueOpen = jest.fn();
    runner.reversePlace.mockReset().mockResolvedValue({ address: 'Str. X 1, Malacky, SK', city: 'Malacky', country: 'SK' });
    runner.learnPlace.mockReset();
  });
  test('érvénytelen koordináta elutasítva', async () => {
    pool.query.mockResolvedValueOnce(rows([{ id: 9, order_id: 'O9', match_status: 'rejected' }]));
    const r = await call('stopMatchDecide', ADMIN, { stop_id: 9, action: 'map', lat: 'x', lng: 200 });
    expect(r.ok).toBe(false);
  });
  test('térképi pont mentése: cím reverse-geokódból, elfogadva, tanul', async () => {
    pool.query.mockResolvedValueOnce(rows([{ id: 9, order_id: 'O9', firma: 'Beta', match_status: 'rejected', actual_lat: 42.7, actual_lng: 25.3 }]))
      .mockResolvedValue(rows([]));
    const r = await call('stopMatchDecide', ADMIN, { stop_id: 9, action: 'map', lat: 48.4361, lng: 17.0219, from: '2026-10-07T08:00:00Z', to: '2026-10-07T09:00:00Z' });
    expect(r.ok).toBe(true);
    const upd = pool.query.mock.calls.find((c) => /match_source='map'/.test(c[0]));
    expect(upd[1].slice(0, 5)).toEqual([9, 7, 48.4361, 17.0219, 'Str. X 1, Malacky, SK (48.43610, 17.02190)']);
    expect(runner.learnPlace).toHaveBeenCalled();
    expect(runner.requeueOpen).toHaveBeenCalledWith(7, 'O9');   // már elvetett pontnál nincs dupla negatív visszajelzés
    expect(runner.recordFeedback).not.toHaveBeenCalled();
  });
  test('napi útvonal: idegen pont nem található', async () => {
    pool.query.mockResolvedValueOnce(rows([]));
    const r = await call('stopMatchTrack', ADMIN, { stop_id: 99 });
    expect(r.ok).toBe(false);
    expect(pool.query.mock.calls[0][1]).toEqual([99, 7]);
  });
});


describe('stopMatch — pihenő / szünet után a valódi rakodóhely', () => {
  const MISK = [48.1035, 20.7784];
  const PARK = [48.0800, 20.7400];   // parkoló a város szélén (~3,8 km)
  const CUST = [48.1200, 20.8000];   // a valódi lerakó (~2,4 km a központtól)
  const T = Date.parse('2026-10-06T15:00:00Z') / 1000;
  function nightThenShortUnload(ign) {
    const p = [[T, 47.9, 20.4, 0, 1, null, null, null, null]];
    let t = T;
    t = drive(p, t, [47.9, 20.4], PARK, 180);   // érkezés 18:00Z (21:00 RO)
    t = stand(p, t, PARK, 600);                 // 10 óra napi pihenő
    t = drive(p, t, PARK, CUST, 12);
    t = stand(p, t, CUST, 2, ign);              // 2 perces lerakás
    t = drive(p, t, CUST, [48.3, 21.2], 40);
    return p;
  }
  const exp = [{ cityGeo: { lat: MISK[0], lng: MISK[1] }, memory: [] }];
  const stop = [{ kind: 'delivery', loc: 'Miskolc', firma: 'Gamma Kft', data: '2026-10-06' }];

  test('éjszakai pihenő a város szélén, reggel 2 perc lerakás → a 2 perces hely', () => {
    const cands = sm.buildCandidates(nightThenShortUnload(), {});
    const rest = cands.find((c) => c.rest === 'daily');
    const hop = cands.find((c) => c.hop);
    expect(rest).toBeTruthy(); expect(hop).toBeTruthy();
    expect(Math.abs(hop.lat - CUST[0])).toBeLessThan(0.005);
    const r = sm.align(stop, cands, exp);
    expect(cands[r[0].candIdx]).toBe(hop);
    expect(r[0].status).not.toBe('auto');           // rövid, pihenő utáni hely → az iroda nézze át
    const restSig = sm.scorePair(stop[0], rest, exp[0]).signals.map((x) => x[0]);
    expect(restSig).toContain('rest_then_moved');
  });

  test('forgalmi megállás az úton (lámpa) nem lesz jelölt', () => {
    const pts = nightThenShortUnload(1);
    const road = [[[CUST[0] - 0.01, CUST[1]], [CUST[0] + 0.01, CUST[1]]]];
    const cands = sm.buildCandidates(pts, { roadLines: road });
    expect(cands.some((c) => c.hop)).toBe(false);
  });

  test('a cégnél éjszakázott (utána nem állt meg a közelben) → a pihenő hely marad, büntetés nélkül', () => {
    const p = [[T, 47.9, 20.4, 0, 1, null, null, null, null]];
    let t = drive(p, T, [47.9, 20.4], CUST, 180);
    t = stand(p, t, CUST, 600);
    drive(p, t, CUST, [48.6, 21.6], 60);
    const cands = sm.buildCandidates(p, {});
    for (const c of cands) c.place = { city: 'Miskolc' };   // élesben a reverse-geokód adja
    const r = sm.align(stop, cands, exp);
    expect(r[0].candIdx).not.toBeNull();
    expect(r[0].signals.map((x) => x[0])).not.toContain('rest_then_moved');
  });

  test('45 perces szünet a város szélén, utána 5 km-re 1 óra lerakás → a lerakó', () => {
    const p = [[T, 47.9, 20.4, 0, 1, null, null, null, null]];
    let t = drive(p, T, [47.9, 20.4], PARK, 120);
    t = stand(p, t, PARK, 45);
    t = drive(p, t, PARK, CUST, 10);
    t = stand(p, t, CUST, 60);
    drive(p, t, CUST, [48.3, 21.2], 40);
    const road = [[[PARK[0] - 0.01, PARK[1]], [PARK[0] + 0.01, PARK[1]]]];   // a parkoló az út mellett
    const cands = sm.buildCandidates(p, { roadLines: road });
    const brk = cands.find((c) => c.rest === 'break');
    expect(brk).toBeTruthy();
    const r = sm.align(stop, cands, exp);
    expect(Math.abs(cands[r[0].candIdx].lat - CUST[0])).toBeLessThan(0.005);
    expect(sm.scorePair(stop[0], brk, exp[0]).signals.map((x) => x[0])).toContain('break_then_moved');
  });
});

describe('lib/placeName stripPlaceName', () => {
  const { stripPlaceName } = require('../../lib/placeName');
  test('a hely / cég neve kikerül a címből', () => {
    expect(stripPlaceName('Policlinica AS, Strada Făt Frumos, Arad, 310364, RO')).toBe('Strada Făt Frumos, Arad, 310364, RO');
    expect(stripPlaceName('Kaufland, Calea Victoriei 10, București, RO')).toBe('Calea Victoriei 10, București, RO');
  });
  test('település vagy utca elöl → változatlan', () => {
    expect(stripPlaceName('Arad, Strada X 2, RO')).toBe('Arad, Strada X 2, RO');
    expect(stripPlaceName('Strada X 2, Arad, RO')).toBe('Strada X 2, Arad, RO');
    expect(stripPlaceName('Copșa Mică')).toBe('Copșa Mică');
    expect(stripPlaceName('Depozit, Arad')).toBe('Depozit, Arad');
  });
});
