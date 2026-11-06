// Elvetett tényleges cím → új találat (az elvetett hely nélkül) + ráírás a menetlevélre
jest.mock('../../db', () => require('../helpers/db-mock').pool);
jest.mock('../../lib/mapsProvider', () => ({ geocode: jest.fn() }));
jest.mock('../../lib/stopWaybill', () => ({
  getSettings: jest.fn().mockResolvedValue({ auto_apply: false, min_score: 80, auto_events: false }),
  qualifies: jest.fn().mockReturnValue(false),
  applyStop: jest.fn().mockResolvedValue({ ok: true, points: 1, waybills: 1 }),
}));
jest.mock('../../lib/stopAutoEvents', () => ({ applyAutoEvents: jest.fn().mockResolvedValue({ filled: 0 }) }));

const { pool, rows, reset } = require('../helpers/db-mock');
const maps = require('../../lib/mapsProvider');
const wb = require('../../lib/stopWaybill');
const runner = require('../../lib/stopMatchRunner');

const T0 = Date.parse('2026-10-06T06:00:00Z') / 1000;
function drive(p, t, a, b, mins) {
  for (let i = 1; i <= mins; i++) { const f = i / mins; p.push([t + i * 60, a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, 70, 1, null, null, null, 90]); }
  return t + mins * 60;
}
function stand(p, t, at, mins) {
  for (let i = 1; i <= mins; i++) p.push([t + i * 60, at[0] + (i % 2) * 0.00002, at[1], 0, 0, null, null, null, null]);
  return t + mins * 60;
}
// Két hosszú állás Kolozsváron belül (A = rossz, ezt vetette el az iroda; B = a valódi), majd lerakás Tordán
const START = [46.90, 23.40], A = [46.7712, 23.6236], B = [46.7500, 23.5600], TURDA = [46.5667, 23.7833];
function day() {
  const p = [[T0, START[0], START[1], 0, 1, null, null, null, null]];
  let t = T0;
  t = drive(p, t, START, A, 40); t = stand(p, t, A, 50);
  t = drive(p, t, A, B, 15); t = stand(p, t, B, 60);
  t = drive(p, t, B, TURDA, 30); t = stand(p, t, TURDA, 45);
  drive(p, t, TURDA, START, 30);
  return p;
}

function route(stops) {
  pool.query.mockImplementation(async (sql) => {
    const q = String(sql);
    if (/FROM orders WHERE id=\$1/.test(q)) return rows([{ id: 'O1', status: 'Finalizat', rendszam_camion: 'B1X', data_incarcare: '2026-10-06', data_descarcare: '2026-10-06' }]);
    if (/FROM order_stops WHERE order_id=\$1/.test(q)) return rows(stops);
    if (/FROM gps_track_days/.test(q)) return rows([{ day: '2026-10-06', points_json: JSON.stringify(day()), segments: [], complete: true }]);
    if (/^\s*UPDATE/.test(q)) return { rows: [], rowCount: 1 };
    return rows([]);
  });
}
const updates = () => pool.query.mock.calls.filter((c) => /UPDATE order_stops SET actual_lat/.test(String(c[0])));

describe('rejectedPoints / nearAny', () => {
  test('az elvetett állapotú pont és a korábban elvetettek összegyűlnek, ismétlés nélkül', () => {
    const pts = runner.rejectedPoints({ match_status: 'rejected', actual_lat: 46.1, actual_lng: 23.1,
      match_detail: { rejected_pts: [{ lat: 46.5, lng: 23.5 }, { lat: 46.1, lng: 23.1 }, { lat: 'x' }] } });
    expect(pts).toEqual([{ lat: 46.5, lng: 23.5 }, { lat: 46.1, lng: 23.1 }]);
    expect(runner.rejectedPoints({ match_status: 'suggested', actual_lat: 46.1, actual_lng: 23.1 })).toEqual([]);
  });
  test('~200 m-en belül közelinek számít', () => {
    expect(runner.nearAny({ lat: 46.1005, lng: 23.1 }, [{ lat: 46.1, lng: 23.1 }])).toBe(true);
    expect(runner.nearAny({ lat: 46.12, lng: 23.1 }, [{ lat: 46.1, lng: 23.1 }])).toBe(false);
  });
});

describe('matchOrder — elvetett állomás új találatot kap', () => {
  beforeEach(() => {
    reset(); wb.applyStop.mockClear();
    maps.geocode.mockImplementation(async (cid, text) => (/turda/i.test(text) ? { lat: TURDA[0], lng: TURDA[1] } : /cluj/i.test(text) ? { lat: 46.77, lng: 23.59 } : null));
  });

  test('az elvetett hely helyett a következő jelölt kerül rá, „javaslat"-ként, és a menetlevélre is', async () => {
    route([
      { id: 1, kind: 'pickup', loc: 'Cluj-Napoca', data: '2026-10-06', match_status: 'rejected', actual_lat: A[0], actual_lng: A[1], match_detail: {} },
      { id: 2, kind: 'delivery', loc: 'Turda', data: '2026-10-06', match_status: 'confirmed', actual_lat: TURDA[0], actual_lng: TURDA[1] },
    ]);
    const r = await runner.matchOrder(7, 'O1', { cacheOnly: true });
    expect(r.retried).toBe(1);
    const up = updates().find((c) => c[1][0] === 1);
    expect(up).toBeTruthy();
    expect(String(up[0])).toMatch(/match_source='retry', match_status='suggested'/);
    expect(String(up[0])).toMatch(/company_id=\$2 AND match_status='rejected'/);
    const [, , lat, lng, addr] = up[1];
    expect(runner.nearAny({ lat, lng }, [{ lat: A[0], lng: A[1] }])).toBe(false);
    expect(addr).toContain(Number(lat).toFixed(5) + ', ' + Number(lng).toFixed(5));
    const det = JSON.parse(up[1][10]);
    expect(det.rejected_pts).toEqual([{ lat: A[0], lng: A[1] }]);
    expect(wb.applyStop).toHaveBeenCalledWith(7, 1);
  });

  test('a fuvar másik állomásának helyét nem adjuk az elvetettnek; ha nincs más, az elvetés marad', async () => {
    route([
      { id: 1, kind: 'pickup', loc: 'Cluj-Napoca', data: '2026-10-06', match_status: 'rejected', actual_lat: A[0], actual_lng: A[1],
        match_detail: { rejected_pts: [{ lat: B[0], lng: B[1] }] } },
      { id: 2, kind: 'delivery', loc: 'Turda', data: '2026-10-06', match_status: 'confirmed', actual_lat: TURDA[0], actual_lng: TURDA[1] },
    ]);
    const r = await runner.matchOrder(7, 'O1', { cacheOnly: true });
    expect(r.retried).toBe(0);
    expect(updates().find((c) => c[1][0] === 1)).toBeFalsy();
    expect(wb.applyStop).not.toHaveBeenCalled();
    const keep = pool.query.mock.calls.find((c) => /jsonb_build_object\('rejected_pts'/.test(String(c[0])));
    expect(JSON.parse(keep[1][3])).toEqual([{ lat: B[0], lng: B[1] }, { lat: A[0], lng: A[1] }]);
  });

  test('a korábban elvetett helyre a következő körben sem tesszük vissza', async () => {
    route([
      { id: 1, kind: 'pickup', loc: 'Cluj-Napoca', data: '2026-10-06', match_status: 'suggested', match_source: 'retry',
        actual_lat: B[0], actual_lng: B[1], waybill_apply: true, match_detail: { rejected_pts: [{ lat: A[0], lng: A[1] }] } },
      { id: 2, kind: 'delivery', loc: 'Turda', data: '2026-10-06', match_status: 'confirmed', actual_lat: TURDA[0], actual_lng: TURDA[1] },
    ]);
    await runner.matchOrder(7, 'O1', { cacheOnly: true });
    const up = updates().find((c) => c[1][0] === 1);
    expect(up).toBeTruthy();
    expect(up[1][2] == null || !runner.nearAny({ lat: up[1][2], lng: up[1][3] }, [{ lat: A[0], lng: A[1] }])).toBe(true);
    expect(up[1][11]).not.toBe('auto');   // már tévedett itt egyszer → kézi megerősítés
    expect(JSON.parse(up[1][12]).rejected_pts).toEqual([{ lat: A[0], lng: A[1] }]);
  });
});
