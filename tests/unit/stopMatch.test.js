// lib/stopMatch.js + handlers/stopMatch.js — tényleges fel-/lerakási hely a GPS-ből
jest.mock('../../db', () => require('../helpers/db-mock').pool);
jest.mock('../../lib/featureEnabled', () => ({ featureEnabled: jest.fn() }));
jest.mock('../../lib/audit', () => ({ fromReq: jest.fn() }));
jest.mock('../../lib/stopMatchRunner', () => ({ matchOrder: jest.fn(), learnPlace: jest.fn(), reversePlace: jest.fn() }));

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

  test('cityQuery / norm', () => {
    expect(sm.cityQuery('Str. Fabricii 12, Arad, Romania')).toBe('Arad');
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
