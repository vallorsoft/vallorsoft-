jest.mock('../../db', () => ({ query: jest.fn(async () => ({ rows: [] })) }));
const wt = require('../../lib/waybillTimeFix');

// 06:10–07:05 UTC = 08:10–09:05 Bukarest (téli idő); hely: 46.17, 21.31
const base = { id: 7, order_id: 'CMD-1', kind: 'pickup', match_status: 'auto', match_score: 130,
  match_detail: { votes: 3, margin: 30 }, gps_arrived_at: '2026-11-20T06:10:00Z', gps_left_at: '2026-11-20T07:05:00Z',
  actual_lat: 46.17, actual_lng: 21.31 };
const T = (iso) => Math.floor(Date.parse(iso) / 1000);
// a kamion pontsora: ott áll 06:10 – 07:05 között, utána elmegy
function trackAt(fromIso, toIso, lat = 46.17, lng = 21.31) {
  const out = [[T(fromIso) - 1800, lat + 0.2, lng]];
  for (let t = T(fromIso); t <= T(toIso); t += 300) out.push([t, lat, lng]);
  out.push([T(toIso) + 600, lat + 0.2, lng]);
  return out;
}
const goodTrack = trackAt('2026-11-20T06:10:00Z', '2026-11-20T07:05:00Z');
const pt = (o) => ({ tip: 'Incarcare', loc: 'Arad', data: '2026-11-21', time: '15:30', stopId: 7, ...o });

describe('confidencePct', () => {
  test('biztos, 3/3 egyezés, nagy előny → ≥ 85', () => { expect(wt.confidencePct(base)).toBeGreaterThanOrEqual(85); });
  test('jóváhagyott → 100', () => { expect(wt.confidencePct({ ...base, match_status: 'confirmed', match_score: 10 })).toBe(100); });
  test('javaslat sosem éri el a küszöböt', () => { expect(wt.confidencePct({ ...base, match_status: 'suggested' })).toBeLessThan(85); });
  test('kézi ellenőrzésre vár → nem ír felül', () => { expect(wt.confidencePct({ ...base, needs_manual: 'true' })).toBeLessThan(85); });
  test('gyenge pontszám / kis előny → < 85', () => {
    expect(wt.confidencePct({ ...base, match_score: 80, match_detail: { votes: 3, margin: 12 } })).toBeLessThan(85);
  });
  test('elvetett / GPS-idő nélkül / bukott újraellenőrzés → 0', () => {
    expect(wt.confidencePct({ ...base, match_status: 'rejected' })).toBe(0);
    expect(wt.confidencePct({ ...base, gps_arrived_at: null, gps_left_at: null })).toBe(0);
    expect(wt.confidencePct({ ...base, match_detail: { votes: 3, verify_fail: {} } })).toBe(0);
  });
});

describe('3 forduló', () => {
  test('mindhárom rendben', () => {
    const r = wt.rounds(base, goodTrack, null);
    expect(r).toMatchObject({ r1: true, r2: true, r3: true, passed: 3, ok: true });
  });
  test('2. forduló: korábbi kör ugyanoda tette (vote_hist), szavazat nélkül', () => {
    const s = { ...base, match_detail: { votes: 1, margin: 30, vote_hist: [
      { from: '2026-11-20T06:12:00Z', to: '2026-11-20T07:00:00Z' }, { from: '2026-11-20T06:10:00Z', to: '2026-11-20T07:05:00Z' }] } };
    expect(wt.votesAgree(s)).toBe(true);
    // csak a mostani kör van a történetben → nem független
    expect(wt.votesAgree({ ...base, match_detail: { votes: 1, vote_hist: [{ from: '2026-11-20T06:10:00Z', to: '2026-11-20T07:05:00Z' }] } })).toBe(false);
  });
  test('3. forduló: a kamion máskor indult el → nem egyezik', () => {
    const lateTrack = trackAt('2026-11-20T06:10:00Z', '2026-11-20T08:30:00Z');
    expect(wt.trackAgrees(base, lateTrack, null)).toBe(false);
    expect(wt.trackAgrees(base, trackAt('2026-11-20T06:10:00Z', '2026-11-20T07:05:00Z', 47.5, 19.0), null)).toBe(false);
  });
  test('csak a felismerés rendben (1 szavazat, nincs GPS-útvonal) → nem ír felül', () => {
    const r = wt.rounds({ ...base, match_detail: { votes: 1, margin: 30 } }, [], null);
    expect(r).toMatchObject({ r1: true, r2: false, r3: false, ok: false });
  });
  test('hiányzó szavazat-adat → a 2. forduló nem teljesül (nem feltételezzük)', () => {
    expect(wt.votesAgree({ ...base, match_detail: { margin: 30 } })).toBe(false);
  });
  test('az 1. forduló nélkül 2 másik sem elég', () => {
    const r = wt.rounds({ ...base, match_status: 'suggested' }, goodTrack, null);
    expect(r.r1).toBe(false); expect(r.r2).toBe(true); expect(r.r3).toBe(true); expect(r.ok).toBe(false);
  });
});

describe('planTimeFix', () => {
  test('rossz idő + 3 forduló rendben → GPS-időre írva, a sofőr eredetije megmarad', () => {
    const r = wt.planTimeFix([pt()], [base], goodTrack);
    expect(r.changes).toHaveLength(1);
    const q = r.puncte[0];
    expect(q.data).toBe('2026-11-20'); expect(q.time).toBe('09:05');
    expect(q.time_driver).toBe('15:30'); expect(q.data_driver).toBe('2026-11-21');
    expect(q.time_source).toBe('gps'); expect(q.time_conf).toBeGreaterThanOrEqual(85);
  });
  test('felismerés + GPS-útvonal (1 szavazat) = 2 forduló → átírja', () => {
    const s = { ...base, match_detail: { votes: 1, margin: 30 } };
    expect(wt.planTimeFix([pt()], [s], goodTrack).changes).toHaveLength(1);
  });
  test('nem éri el a 2 fordulót → változatlan, ok naplózva', () => {
    const s = { ...base, match_detail: { votes: 1, margin: 30 } };   // csak az 1. forduló
    const r = wt.planTimeFix([pt()], [s], []);
    expect(r.changes).toHaveLength(0);
    expect(r.skipped).toHaveLength(1);
    expect(r.puncte[0].time).toBe('15:30');
  });
  test('tűrésen belüli eltérés → változatlan', () => {
    expect(wt.planTimeFix([pt({ data: '2026-11-20', time: '09:15' })], [base], goodTrack).changes).toHaveLength(0);
  });
  test('Plecare / Sosire sosem változik', () => {
    expect(wt.planTimeFix([pt({ tip: 'Plecare' }), pt({ tip: 'Sosire' })], [base], goodTrack).changes).toHaveLength(0);
  });
  test('az iroda kézi átírását nem írja felül', () => {
    expect(wt.planTimeFix([pt({ time_source: 'manual' })], [base], goodTrack).changes).toHaveLength(0);
    const r2 = wt.planTimeFix([pt({ time_source: 'gps', time_gps: '09:05 2026-11-20', time: '11:00', data: '2026-11-20' })], [base], goodTrack);
    expect(r2.changes).toHaveLength(0);
  });
  test('ismételt futás idempotens', () => {
    const r = wt.planTimeFix([pt()], [base], goodTrack);
    expect(wt.planTimeFix(r.puncte, [base], goodTrack).changes).toHaveLength(0);
  });
  test('régi pont (orderId+role) csak egyértelmű állomásnál', () => {
    const old = { tip: 'Incarcare', data: '2026-11-21', time: '15:30', orderId: 'CMD-1', role: 'loading' };
    expect(wt.planTimeFix([old], [base], goodTrack).changes).toHaveLength(1);
    expect(wt.planTimeFix([old], [base, { ...base, id: 8 }], goodTrack).changes).toHaveLength(0);
  });
  test('hiányzó óra → kitöltve a GPS-ből', () => {
    expect(wt.planTimeFix([pt({ time: '' })], [base], goodTrack).puncte[0].time).toBe('09:05');
  });
  test('sofőr által jóváhagyott pótolt gomb → a gomb ideje (ember + GPS-útvonal)', () => {
    const s = { ...base, match_status: 'suggested', auto_filled: 'both', auto_ack_at: '2026-11-20T10:00:00Z', done_at: '2026-11-20T07:05:00Z' };
    expect(wt.planTimeFix([pt()], [s], goodTrack).puncte[0].time).toBe('09:05');
  });
});

describe('checkWaybill — kétszeri ellenőrzés', () => {
  function makePool({ claim = true, count = 1 } = {}) {
    const calls = [];
    const pool = { query: jest.fn(async (sql, p) => {
      calls.push([sql, p]);
      if (/SET time_check_count = time_check_count \+ 1/.test(sql)) {
        return { rows: claim ? [{ id: 5, numar_camion: 'B 104 VLR', time_check_count: count, time_check: null,
          puncte: [{ tip: 'Incarcare', data: '2026-11-21', time: '15:30', stopId: 7 }] }] : [] };
      }
      if (/FROM order_stops/.test(sql)) return { rows: [base] };
      if (/FROM gps_track_days/.test(sql)) return { rows: [{ points_json: JSON.stringify(goodTrack) }] };
      return { rows: [] };
    }) };
    return { pool, calls };
  }
  test('lefoglalja, cégre szűrt, ment + km-óra újraszámolás', async () => {
    const { pool, calls } = makePool();
    const r = await wt.checkWaybill(pool, 3, 5);
    expect(r).toMatchObject({ check: 1, fixed: 1 });
    const claim = calls[0];
    expect(claim[1]).toEqual([5, 3]);
    expect(claim[0]).toMatch(/time_check_count < 2/);
    expect(claim[0]).toMatch(/INTERVAL '24 hours'/);
    const upd = calls.find(([s]) => /SET puncte = \$3/.test(s));
    expect(upd[0]).toMatch(/company_id = \$2/);
    expect(upd[0]).toMatch(/route_odo_at = NULL/);
    expect(JSON.parse(upd[1][3]).checks[0].n).toBe(1);
  });
  test('ha nem esedékes (már 2× volt, vagy még nincs 24 óra) → semmit nem csinál', async () => {
    const { pool, calls } = makePool({ claim: false });
    expect(await wt.checkWaybill(pool, 3, 5)).toBeNull();
    expect(calls).toHaveLength(1);
  });
  test('pickQueue: csak 0× vagy 24 órája 1× ellenőrzött', async () => {
    const pool = { query: jest.fn(async () => ({ rows: [] })) };
    await wt.pickQueue(pool, 30);
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toMatch(/time_check_count < 2/);
    expect(sql).toMatch(/time_check_count = 0 OR time_check_at <= NOW\(\) - INTERVAL '24 hours'/);
  });
});
