// lib/gpsTrack.js — GPS útvonal-előzmény: idő, tisztítás, menet/állás, illesztés, letöltés
jest.mock('../../db', () => require('../helpers/db-mock').pool);
jest.mock('../../services/cargotrack', () => ({ getCoordinates: jest.fn() }));
const ct = require('../../services/cargotrack');
const gt = require('../../lib/gpsTrack');

describe('idő (Europe/Bucharest)', () => {
  test('nap kezdete nyáron UTC+3, télen UTC+2', () => {
    expect(new Date(gt.dayStartMs('2026-07-15')).toISOString()).toBe('2026-07-14T21:00:00.000Z');
    expect(new Date(gt.dayStartMs('2026-01-15')).toISOString()).toBe('2026-01-14T22:00:00.000Z');
  });
  test('localDay + addDays', () => {
    expect(gt.localDay(Date.parse('2026-07-14T21:30:00Z'))).toBe('2026-07-15');
    expect(gt.addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(gt.isDay('2026-13-01')).toBe(false);
  });
});

describe('pontok', () => {
  test('normalizeItem: CargoTrack v2 rekord → tömör pont', () => {
    const p = gt.normalizeItem({ datetime: '2026-07-15T08:00:00Z', ignition_status: 'on',
      position: { latitude: 45.123456, longitude: 25.654321, speed: 82, direction: 271 },
      inputs: { calculated_inputs: { mileage: 123456.78, fuel_consumption: 5000.123, fuel_level: 660.04 } } });
    expect(p).toEqual([Date.parse('2026-07-15T08:00:00Z') / 1000, 45.12346, 25.65432, 82, 1, 123456.8, 5000.12, 660, 271]);
    expect(gt.normalizeItem({ datetime: '2026-07-15T08:00:00Z', position: { latitude: 0, longitude: 0 } })).toBeNull();
  });
  test('cleanPoints: rendez, duplikátumot és GPS-ugrást szűr', () => {
    const pts = [[200, 45.01, 25, 50], [100, 45, 25, 50], [100, 45, 25, 50], [150, 46, 25, 50]];
    const c = gt.cleanPoints(pts);
    expect(c.map((p) => p[0])).toEqual([100, 200]);   // a 150-es ~111 km/50 mp → ugrás
  });
  test('normalizeItem: eltérő mezőnevek (can_*, raw_inputs)', () => {
    const p = gt.normalizeItem({ datetime: '2026-07-15T08:00:00Z', position: { latitude: 45, longitude: 25, speed: 0, course: 90 },
      inputs: { calculated_inputs: { can_mileage: 1000.04 }, raw_inputs: { total_fuel_used: 77, can_fuel_level: 512.3 } } });
    expect(p.slice(5)).toEqual([1000, 77, 512.3, 90]);
  });
  test('cleanPoints: azonos időpontnál a teljesebb rekord marad', () => {
    const c = gt.cleanPoints([[100, 45, 25, 0, 1, 1000, 5], [100, 45, 25, 0, 1, 1000, 5, 600, 90]]);
    expect(c).toHaveLength(1);
    expect(c[0][7]).toBe(600);
    expect(gt.needsUpgrade([[1, 45, 25, 0, 1, 1, 1]])).toBe(true);
    expect(gt.needsUpgrade(c)).toBe(false);
  });
  test('polyline6 kódolás', () => {
    expect(gt.encodePolyline([[38.5, -120.2], [40.7, -120.95]], 5)).toBe('_p~iF~ps|U_ulLnnqC');
  });
});

describe('menetek és állások', () => {
  // 0-600 mp áll, 600-1800 mozog ~10 km, 1800-2700 áll, 2700-3600 mozog
  function track() {
    const pts = [];
    for (let t = 0; t <= 600; t += 60) pts.push([t, 45.0, 25.0, 0, 0, 1000, 10]);
    for (let t = 660; t <= 1800; t += 60) pts.push([t, 45.0 + (t - 600) / 1200 * 0.09, 25.0, 60, 1, 1000 + (t - 600) / 120, 10 + (t - 600) / 400]);
    for (let t = 1860; t <= 2700; t += 60) pts.push([t, 45.09, 25.0, 0, 0, 1010, 13]);
    for (let t = 2760; t <= 3600; t += 60) pts.push([t, 45.09, 25.0 + (t - 2700) / 900 * 0.05, 50, 1, 1010 + (t - 2700) / 225, 13 + (t - 2700) / 900]);
    return pts;
  }
  test('két állás + két menet, km-óra szerinti km', () => {
    const tl = gt.buildTimeline(track(), 3600);
    expect(tl.stops.length).toBe(2);
    expect(tl.trips.length).toBe(2);
    expect(tl.trips[0].km_odo).toBeCloseTo(10, 0);
    expect(tl.trips[0].km_gps).toBeGreaterThan(9.5);
    expect(tl.trips[1].km_odo).toBeCloseTo(4, 0);
  });
  test('odoDelta/fuelDelta korláttal', () => {
    const pts = track();
    expect(gt.odoDelta(pts, 0, pts.length - 1)).toBeCloseTo(14, 0);
    expect(gt.fuelDelta(pts, 0, pts.length - 1)).toBeCloseTo(4, 0);
    expect(gt.odoDelta([[0, 0, 0, 0, 0, 0], [1, 0, 0, 0, 0, 9000]], 0, 1)).toBeNull();
    expect(gt.odoDelta([[0, 0, 0, 0, 0, 0], [1, 0, 0, 0, 0, 9000]], 0, 1, 50000)).toBe(9000);
  });
});

describe('tartály-szint fogyasztás + legközelebbi pont', () => {
  test('fogyasztás = kezdő − záró + tankolás; zaj nem tankolás', () => {
    const pts = [];
    // 300 L → 280 L menet közben (zajjal), tankolás +300 L, majd 580 L → 575 L
    for (let i = 0; i <= 40; i++) pts.push([i * 60, 45, 25 + i * 0.02, 90, 1, null, null, 300 - i * 0.5 + (i % 2 ? 3 : -3)]);
    for (let i = 1; i <= 5; i++) pts.push([2400 + i * 60, 45, 25.8, 0, 0, null, null, 280 + i * 60]);
    for (let i = 1; i <= 10; i++) pts.push([2700 + i * 60, 45, 25.8 + i * 0.02, 90, 1, null, null, 580 - i * 0.5]);
    const r = gt.levelFuel(pts);
    expect(r.refuels).toHaveLength(1);
    expect(r.refuels[0].liters).toBeGreaterThan(270);
    expect(r.losses).toHaveLength(0);
    expect(r.used).toBeGreaterThan(15);
    expect(r.used).toBeLessThan(40);
    expect(gt.levelFuel([[0, 45, 25, 0, 0, null, null]])).toBeNull();
  });
  test('levelFuel: hirtelen leszívás = veszteség (nem fogyasztás)', () => {
    const pts = []; let t = 0;
    for (let i = 0; i < 60; i++) { pts.push([t, 45, 25, 0, 0, 1000, null, 400, 0]); t += 60; }
    for (let i = 0; i < 10; i++) { pts.push([t, 45, 25, 0, 0, 1000, null, 400 - 6 * (i + 1), 0]); t += 60; }
    for (let i = 0; i < 30; i++) { pts.push([t, 45, 25, 0, 0, 1000, null, 340, 0]); t += 60; }
    for (let i = 0; i < 100; i++) { pts.push([t, 45 + i * 0.009, 25, 60, 1, 1000 + i, null, 340 - 0.3 * i, 0]); t += 60; }
    const r = gt.levelFuel(pts);
    expect(r.losses).toHaveLength(1);
    expect(r.losses[0].liters).toBeCloseTo(60, 0);
    expect(r.lost).toBeCloseTo(60, 0);
    expect(r.used).toBeLessThan(35);
    expect(r.refuels).toHaveLength(0);
  });
  test('levelFuel: normál menet-fogyasztás nem veszteség', () => {
    const pts = []; let t = 0;
    for (let i = 0; i < 200; i++) { pts.push([t, 45 + i * 0.015, 25, 90, 1, 1000 + i, null, 500 - 0.5 * i, 0]); t += 60; }
    expect(gt.levelFuel(pts).losses).toHaveLength(0);
  });
  test('nearestPoint', () => {
    const pts = [[0, 45, 25], [1, 45.01, 25], [2, 45.02, 25]];
    const n = gt.nearestPoint(pts, 45.011, 25);
    expect(n.i).toBe(1);
    expect(n.dist_m).toBeLessThan(200);
  });
});

describe('matchPoints (OSRM)', () => {
  const line = (n) => Array.from({ length: n }, (_, i) => [i * 30, 45 + i * 0.003, 25, 60]);
  test('elfogadott illesztés: úton mért km, polyline6 darabok', async () => {
    // az úton mért táv ~3%-kal több a pontok közti légvonalnál
    const get = jest.fn(async (url) => {
      const n = url.split('/driving/')[1].split('?')[0].split(';').length;
      return { code: 'Ok', matchings: [{ distance: (n - 1) * 0.003 * 111195 * 1.03, geometry: 'abc' }] };
    });
    const r = await gt.matchPoints(line(100), { get, pauseMs: 0 });
    expect(get).toHaveBeenCalledTimes(2);                  // 100 pont → 90 + 11 (átfedéssel)
    expect(get.mock.calls[0][0]).toContain('/match/v1/driving/');
    expect(r.source).toBe('osrm');
    expect(r.km_road).toBeCloseTo(r.km_raw * 1.03, 0);
    expect(r.segments.every((s) => s.k === 'm')).toBe(true);
  });
  test('sikertelen / irreális illesztés → nyers pont-sor', async () => {
    const get = jest.fn(async () => ({ code: 'NoMatch' }));
    const r = await gt.matchPoints(line(10), { get, pauseMs: 0 });
    expect(r.source).toBe('raw');
    expect(r.segments[0].k).toBe('r');
    expect(r.km_road).toBeCloseTo(r.km_raw, 1);
  });
  test('adathiány elmozdulással → útvonal-áthidalás (g)', async () => {
    const pts = [[0, 45, 25, 60], [30, 45.003, 25, 60], [4000, 45.3, 25, 60], [4030, 45.303, 25, 60]];
    const get = jest.fn(async (url) => url.includes('/route/')
      ? { code: 'Ok', routes: [{ distance: 40000, geometry: 'gap' }] }
      : { code: 'Ok', matchings: [{ distance: 340, geometry: 'm' }] });
    const r = await gt.matchPoints(pts, { get, pauseMs: 0 });
    expect(r.segments.map((s) => s.k)).toEqual(['m', 'g', 'm']);
    expect(r.km_road).toBeCloseTo(40.68, 1);
  });
});

describe('fetchRange (CargoTrack)', () => {
  beforeEach(() => ct.getCoordinates.mockReset());
  test('3 órás ablakok, normalizált pontok', async () => {
    ct.getCoordinates.mockImplementation(async (k, id, from) => ({
      items: [{ datetime: from, position: { latitude: 45, longitude: 25, speed: 10 } }], continuation_token: null }));
    const pts = await gt.fetchRange('k', 'o1', 0, 6 * 3600 * 1000, { pauseMs: 0 });
    expect(ct.getCoordinates).toHaveBeenCalledTimes(2);
    expect(pts).toHaveLength(2);
  });
  test('1000-es limit token nélkül → kettébontás', async () => {
    let n = 0;
    ct.getCoordinates.mockImplementation(async () => {
      n++;
      return { items: n === 1 ? new Array(1000).fill({ datetime: '2026-01-01T00:00:00Z', position: { latitude: 45, longitude: 25 } }) : [], continuation_token: null };
    });
    await gt.fetchRange('k', 'o1', 0, 3600 * 1000, { pauseMs: 0 });
    expect(ct.getCoordinates).toHaveBeenCalledTimes(3);
  });
  test('lapozó-token követése', async () => {
    ct.getCoordinates
      .mockResolvedValueOnce({ items: [{ datetime: '2026-01-01T00:00:00Z', position: { latitude: 45, longitude: 25 } }], continuation_token: 'x' })
      .mockResolvedValueOnce({ items: [{ datetime: '2026-01-01T00:01:00Z', position: { latitude: 45, longitude: 25.001 } }], continuation_token: null });
    const pts = await gt.fetchRange('k', 'o1', 0, 3600 * 1000, { pauseMs: 0 });
    expect(ct.getCoordinates.mock.calls[1][4]).toBe('x');
    expect(pts).toHaveLength(2);
  });
});
