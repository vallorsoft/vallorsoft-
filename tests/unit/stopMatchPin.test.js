jest.mock('../../db', () => require('../helpers/db-mock').pool);
describe('rögzített (már beírt) állomás GPS-állása', () => {
  const runner = require('../../lib/stopMatchRunner');
  const smx = require('../../lib/stopMatch');
  test('pinOf: csak beírt / megerősített, kész állomásra', () => {
    const base = { done_at: '2026-11-11T10:00:00Z', gps_arrived_at: '2026-11-11T08:00:00Z', gps_left_at: '2026-11-11T09:30:00Z' };
    expect(runner.pinOf({ ...base, match_status: 'suggested', auto_filled: 'both' })).toEqual({ from: Date.parse(base.gps_arrived_at) / 1000, to: Date.parse(base.gps_left_at) / 1000 });
    expect(runner.pinOf({ ...base, match_status: 'confirmed' })).not.toBeNull();
    expect(runner.pinOf({ ...base, match_status: 'suggested' })).toBeNull();      // a sofőr saját gombja, nem beírt
    expect(runner.pinOf({ ...base, done_at: null, match_status: 'confirmed' })).toBeNull();
  });
  test('scorePair: a rögzített állás nyer, a másik állás nem lehet az övé', () => {
    const stop = { loc: 'Arad', firma: 'X', data: '2026-11-11' };
    const pin = { from: 1000, to: 5000 };
    const c1 = { lat: 46.17, lng: 21.31, from: 1200, to: 4800, dur: 3600, dwell: 3600, day: '2026-11-11', maneuvers: 0 };
    const c2 = { ...c1, from: 90000, to: 93600 };
    const a = smx.scorePair(stop, c1, { pin }).score, b = smx.scorePair(stop, c2, { pin }).score;
    expect(a).toBeGreaterThan(200);
    expect(b).toBeLessThan(-200);
  });
});
