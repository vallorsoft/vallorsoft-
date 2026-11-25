jest.mock('../../db', () => ({ query: jest.fn(async () => ({ rows: [] })) }));
const wt = require('../../lib/waybillTimeFix');

const base = { id: 7, order_id: 'CMD-1', kind: 'pickup', match_status: 'auto', match_score: 130,
  match_detail: { votes: 3, margin: 30 }, gps_arrived_at: '2026-11-20T06:10:00Z', gps_left_at: '2026-11-20T07:05:00Z' };
// 07:05 UTC = 09:05 Bukarest (téli idő)

describe('confidencePct', () => {
  test('biztos, 3/3 egyezés, nagy előny → ≥ 85', () => { expect(wt.confidencePct(base)).toBeGreaterThanOrEqual(85); });
  test('jóváhagyott → 100', () => { expect(wt.confidencePct({ ...base, match_status: 'confirmed', match_score: 10 })).toBe(100); });
  test('javaslat sosem éri el a küszöböt', () => { expect(wt.confidencePct({ ...base, match_status: 'suggested' })).toBeLessThan(85); });
  test('kézi ellenőrzésre vár → nem ír felül', () => { expect(wt.confidencePct({ ...base, needs_manual: 'true' })).toBeLessThan(85); });
  test('gyenge pontszám / kevés egyezés → < 85', () => {
    expect(wt.confidencePct({ ...base, match_score: 65, match_detail: { votes: 2, margin: 13 } })).toBeLessThan(85);
  });
  test('elvetett / GPS-idő nélkül → 0', () => {
    expect(wt.confidencePct({ ...base, match_status: 'rejected' })).toBe(0);
    expect(wt.confidencePct({ ...base, gps_arrived_at: null, gps_left_at: null })).toBe(0);
  });
  test('bukott újraellenőrzés → 0', () => { expect(wt.confidencePct({ ...base, match_detail: { votes: 3, verify_fail: {} } })).toBe(0); });
});

describe('planTimeFix', () => {
  const pt = (o) => ({ tip: 'Incarcare', loc: 'Arad', data: '2026-11-21', time: '15:30', stopId: 7, ...o });

  test('rossz idő → GPS-időre írva, a sofőr eredetije megmarad', () => {
    const r = wt.planTimeFix([pt()], [base]);
    expect(r.changes).toHaveLength(1);
    const q = r.puncte[0];
    expect(q.data).toBe('2026-11-20'); expect(q.time).toBe('09:05');
    expect(q.time_driver).toBe('15:30'); expect(q.data_driver).toBe('2026-11-21');
    expect(q.time_source).toBe('gps'); expect(q.time_conf).toBeGreaterThanOrEqual(85);
  });
  test('tűrésen belüli eltérés → változatlan', () => {
    const r = wt.planTimeFix([pt({ data: '2026-11-20', time: '09:15' })], [base]);
    expect(r.changes).toHaveLength(0);
  });
  test('85% alatt → változatlan', () => {
    const r = wt.planTimeFix([pt()], [{ ...base, match_status: 'suggested' }]);
    expect(r.changes).toHaveLength(0);
    expect(r.puncte[0].time).toBe('15:30');
  });
  test('Plecare / Sosire sosem változik', () => {
    const r = wt.planTimeFix([pt({ tip: 'Plecare' }), pt({ tip: 'Sosire' })], [base]);
    expect(r.changes).toHaveLength(0);
  });
  test('az iroda kézi átírását nem írja felül', () => {
    const r = wt.planTimeFix([pt({ time_source: 'manual' })], [base]);
    expect(r.changes).toHaveLength(0);
    const r2 = wt.planTimeFix([pt({ time_source: 'gps', time_gps: '09:05 2026-11-20', time: '11:00', data: '2026-11-20' })], [base]);
    expect(r2.changes).toHaveLength(0);
  });
  test('ismételt futás idempotens', () => {
    const r = wt.planTimeFix([pt()], [base]);
    const r2 = wt.planTimeFix(r.puncte, [base]);
    expect(r2.changes).toHaveLength(0);
  });
  test('régi pont (orderId+role) csak egyértelmű állomásnál', () => {
    const old = { tip: 'Incarcare', data: '2026-11-21', time: '15:30', orderId: 'CMD-1', role: 'loading' };
    expect(wt.planTimeFix([old], [base]).changes).toHaveLength(1);
    expect(wt.planTimeFix([old], [base, { ...base, id: 8 }]).changes).toHaveLength(0);
  });
  test('hiányzó óra → kitöltve a GPS-ből', () => {
    const r = wt.planTimeFix([pt({ time: '' })], [base]);
    expect(r.puncte[0].time).toBe('09:05');
  });
  test('rendszer által pótolt, sofőr által jóváhagyott gomb → a gomb ideje', () => {
    const s = { ...base, match_status: 'suggested', auto_filled: 'both', auto_ack_at: '2026-11-20T10:00:00Z', done_at: '2026-11-20T07:30:00Z' };
    const r = wt.planTimeFix([pt()], [s]);
    expect(r.puncte[0].time).toBe('09:30');
  });
});

describe('checkWaybill', () => {
  test('cégre szűrt, ment + audit', async () => {
    const calls = [];
    const pool = { query: jest.fn(async (sql, p) => {
      calls.push([sql, p]);
      if (/FROM fuvarlevelek WHERE id/.test(sql)) return { rows: [{ id: 5, puncte: [{ tip: 'Incarcare', data: '2026-11-21', time: '15:30', stopId: 7 }] }] };
      if (/FROM order_stops/.test(sql)) return { rows: [base] };
      return { rows: [] };
    }) };
    const r = await wt.checkWaybill(pool, 3, 5);
    expect(r.fixed).toBe(1);
    const upd = calls.find(([s]) => /UPDATE fuvarlevelek SET puncte/.test(s));
    expect(upd[1][1]).toBe(3);
    expect(/company_id = \$2/.test(upd[0])).toBe(true);
    expect(/route_odo_at = NULL/.test(upd[0])).toBe(true);
  });
});
