// ⚖️ Tengelyterhelés-kalkulátor — a számoló motor (public/axle-load.js) tesztje
const AL = require('../../public/axle-load.js');

const CFG = { steer0: 6, drive0: 4, trailer0: 5, wheelbase: 4, fifthOffset: 0.5,
  kingpinFront: 1.5, kingpinAxle: 8, bedLength: 13.6,
  limSteer: 8, limDrive: 11.5, limTrailer: 24, limGross: 40, minDrivePct: 25 };

describe('axle-load compute', () => {
  test('üres szerelvény = az üres tengelyterhelések', () => {
    const r = AL.compute(CFG, []);
    expect(r.ok).toBe(true);
    expect(r.steer).toBeCloseTo(6); expect(r.drive).toBeCloseTo(4); expect(r.trailer).toBeCloseTo(5);
    expect(r.gross).toBeCloseTo(15); expect(r.cargo).toBe(0);
  });

  test('pontosan a királycsap fölötti súly teljesen a vontatóra megy', () => {
    // súlypont = 1.5 m (királycsap) → d = 0
    const r = AL.compute(CFG, [{ weight: 8, start: 1, length: 1 }]);
    expect(r.kingpin).toBeCloseTo(8); expect(r.trailer).toBeCloseTo(5);
    expect(r.steer).toBeCloseTo(6 + 8 * 0.5 / 4);   // 7.0
    expect(r.drive).toBeCloseTo(4 + 8 * 3.5 / 4);   // 11.0
  });

  test('a pótkocsi-tengelyek fölötti súly teljesen a pótkocsira megy', () => {
    // súlypont = 9.5 m → d = 8 = kingpinAxle
    const r = AL.compute(CFG, [{ weight: 10, start: 9, length: 1 }]);
    expect(r.kingpin).toBeCloseTo(0); expect(r.trailer).toBeCloseTo(15);
    expect(r.steer).toBeCloseTo(6); expect(r.drive).toBeCloseTo(4);
  });

  test('a tömeg megmarad (össztömeg = üres + rakomány)', () => {
    const items = [{ weight: 3, start: 0, length: 2.4 }, { weight: 9, start: 2.4, length: 4 }, { weight: 5, start: 6.4, length: 3 }, { weight: 3, start: 9.4, length: 4.2 }];
    const r = AL.compute(CFG, items);
    expect(r.gross).toBeCloseTo(15 + 20);
    expect(r.steer + r.drive + r.trailer).toBeCloseTo(r.gross);
  });

  test('túlterhelt hajtott tengely → over', () => {
    const r = AL.compute(CFG, [{ weight: 10, start: 0, length: 2 }]);
    const drive = r.checks.find((c) => c.key === 'drive');
    expect(drive.status).toBe('over'); expect(r.status).toBe('over');
  });

  test('hátra pakolt rakomány → hajtott tengely arány a minimum alatt', () => {
    const r = AL.compute(CFG, [{ weight: 18, start: 11, length: 2.6 }]);
    const pct = r.checks.find((c) => c.key === 'drivePct');
    expect(pct.status).toBe('over');
    expect(r.warnings.some((w) => w.key === 'behindAxle')).toBe(true);
  });

  test('kilógó blokk figyelmeztet', () => {
    const r = AL.compute(CFG, [{ weight: 1, start: 13, length: 2 }]);
    expect(r.warnings).toContainEqual({ key: 'outside', idx: 0 });
  });

  test('hibás geometria → ok:false', () => {
    expect(AL.compute({ ...CFG, wheelbase: 0 }, []).ok).toBe(false);
  });

  test('szöveges / vesszős számok és üres súly', () => {
    const r = AL.compute({ ...CFG, steer0: '6,0' }, [{ weight: '', start: 0, length: 1 }, { weight: '2,5', start: '1', length: '1' }]);
    expect(r.steer).toBeGreaterThan(6); expect(r.cargo).toBeCloseTo(2.5);
  });

  test('sávkiosztás: átfedő blokkok külön sorba', () => {
    const lanes = AL.assignLanes([{ idx: 0, start: 0, length: 3 }, { idx: 1, start: 1, length: 2 }, { idx: 2, start: 3, length: 1 }]);
    expect(lanes.count).toBe(2); expect(lanes.laneOf[1]).toBe(1); expect(lanes.laneOf[2]).toBe(0);
  });
});
