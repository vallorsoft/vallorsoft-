jest.mock('../../db', () => require('../helpers/db-mock').pool);
const sm = require('../../lib/stopMatch');
const ae = require('../../lib/stopAutoEvents');

const T = (d, h) => d + 'T' + h + ':00Z';

describe('3 független ellenőrzés — szavazatok', () => {
  test('agreeVotes: átfedő ablakok számolása', () => {
    const p = [{ from: 1000, to: 5000 }, { from: 9000, to: 9600 }, null];
    const v1 = [{ from: 1200, to: 4800 }, { from: 50000, to: 51000 }, { from: 1, to: 2 }];
    const v2 = [{ from: 900, to: 5100 }, null, null];
    expect(sm.agreeVotes(p, [v1, v2])).toEqual([3, 1, 0]);
  });
  test('matchWindows: párosítás + következtetett állás', () => {
    const cands = [{ from: 10, to: 20 }];
    const w = sm.matchWindows([{}, {}], [{ stopIdx: 0, candIdx: 0 }, { stopIdx: 1, candIdx: null }], cands, [{ stopIdx: 1, from: 30, to: 40 }]);
    expect(w).toEqual([{ from: 10, to: 20 }, { from: 30, to: 40 }]);
  });
  test('planAutoFill: 2-nél kevesebb egyező ellenőrzés → nem ajánlja fel', () => {
    const NOW = Date.parse('2026-11-05T12:00:00Z');
    const last = Date.parse('2026-11-05T11:00:00Z') / 1000;
    const base = { kind: 'pickup', match_status: 'auto', gps_arrived_at: T('2026-11-05', '08:00'), gps_left_at: T('2026-11-05', '09:00') };
    const p1 = ae.planAutoFill([{ id: 1, ...base, match_detail: { votes: 1 } }], last, NOW);
    expect(p1).toEqual([]);
    expect(p1.skips[0].reason).toBe('checks_disagree');
    const p2 = ae.planAutoFill([{ id: 1, ...base, match_detail: { votes: 2 } }], last, NOW);
    expect(p2.map((x) => x.id)).toEqual([1]);
    const p3 = ae.planAutoFill([{ id: 1, ...base, match_detail: {} }], last, NOW);   // régi sor: nem akasztja meg
    expect(p3.map((x) => x.id)).toEqual([1]);
  });
});

describe('végellenőrzés — verifyChain', () => {
  const auto = (o) => ({ auto_filled: 'both', auto_ack_at: null, match_status: 'suggested', ...o });
  test('rendben lévő lánc: nincs hiba', () => {
    const st = [
      auto({ id: 1, loc: 'A', done_at: T('2026-11-11', '09:00'), arrived_at: T('2026-11-11', '08:00'), gps_arrived_at: T('2026-11-11', '08:00'), gps_left_at: T('2026-11-11', '09:00'), data: '2026-11-11' }),
      auto({ id: 2, loc: 'B', done_at: T('2026-11-11', '14:00'), arrived_at: T('2026-11-11', '13:00'), gps_arrived_at: T('2026-11-11', '13:00'), gps_left_at: T('2026-11-11', '14:00'), data: '2026-11-11' }),
    ];
    expect(ae.verifyChain(st)).toEqual([]);
  });
  test('ismétlődő hely: a holnapi állomás mai beírása hibás; a sofőr gombja nem', () => {
    const st = [
      { id: 4, loc: 'A', done_at: T('2026-11-11', '09:00'), data: '2026-11-11' },
      { id: 5, loc: 'B', done_at: T('2026-11-11', '14:00'), data: '2026-11-11' },
      { id: 6, loc: 'A', done_at: null, data: '2026-11-12' },
      auto({ id: 7, loc: 'B', done_at: T('2026-11-11', '18:00'), arrived_at: T('2026-11-11', '17:00'), gps_arrived_at: T('2026-11-11', '17:00'), gps_left_at: T('2026-11-11', '18:00'), data: '2026-11-12' }),
    ];
    const bad = ae.verifyChain(st);
    expect(bad.map((b) => b.id)).toEqual([7]);
    expect(bad[0].reason).toBe('before_plan_day');
  });
  test('időrend: a korábbi állomás később lett kész → a beírt hibás', () => {
    const st = [
      { id: 1, loc: 'A', done_at: T('2026-11-11', '15:00') },
      auto({ id: 2, loc: 'B', done_at: T('2026-11-11', '10:00'), arrived_at: T('2026-11-11', '09:00'), gps_arrived_at: T('2026-11-11', '09:00'), gps_left_at: T('2026-11-11', '10:00') }),
    ];
    expect(ae.verifyChain(st).map((b) => b.reason)).toEqual(['order_time']);
  });
  test('a beírt idő eltér a GPS-állástól → hibás', () => {
    const st = [auto({ id: 1, loc: 'A', done_at: T('2026-11-11', '15:00'), arrived_at: T('2026-11-11', '08:00'), gps_arrived_at: T('2026-11-11', '08:00'), gps_left_at: T('2026-11-11', '09:00') })];
    expect(ae.verifyChain(st).map((b) => b.reason)).toEqual(['gps_mismatch']);
  });
  test('jóváhagyott / megerősített állomást nem jelöl', () => {
    const st = [
      { id: 1, loc: 'A', done_at: T('2026-11-11', '15:00') },
      auto({ id: 2, loc: 'B', auto_ack_at: T('2026-11-11', '16:00'), done_at: T('2026-11-11', '10:00') }),
      auto({ id: 3, loc: 'C', match_status: 'confirmed', done_at: T('2026-11-11', '10:30') }),
    ];
    expect(ae.verifyChain(st)).toEqual([]);
  });
});

describe('visszavont beírás nem jön vissza ugyanabból az állásból', () => {
  const NOW = Date.parse('2026-11-05T12:00:00Z');
  const last = Date.parse('2026-11-05T11:00:00Z') / 1000;
  const base = { id: 1, kind: 'pickup', match_status: 'auto', gps_arrived_at: T('2026-11-05', '08:00'), gps_left_at: T('2026-11-05', '09:00') };
  test('ugyanaz az állás → kihagyva', () => {
    const p = ae.planAutoFill([{ ...base, match_detail: { verify_fail: { from: T('2026-11-05', '08:00'), to: T('2026-11-05', '09:00'), reason: 'verify_order_time' } } }], last, NOW);
    expect(p).toEqual([]);
    expect(p.skips[0].reason).toBe('verify_order_time');
  });
  test('új, másik állás → beírható', () => {
    const p = ae.planAutoFill([{ ...base, match_detail: { verify_fail: { from: T('2026-11-04', '08:00'), to: T('2026-11-04', '09:00') } } }], last, NOW);
    expect(p.map((x) => x.id)).toEqual([1]);
  });
});

describe('lezárt fuvar — csak az óra javítható, a nap nem', () => {
  const st = (o) => ({ id: 1, auto_filled: 'both', auto_ack_action: null, match_status: 'suggested', actual_lat: 46.17, actual_lng: 21.31,
    arrived_at: T('2026-11-11', '08:00'), done_at: T('2026-11-11', '09:00'), ...o });
  test('ugyanaz a nap, más óra → javítás', () => {
    const r = ae.planClosedFix([st({ match_detail: { review: { from: T('2026-11-11', '10:00'), to: T('2026-11-11', '11:30'), lat: 46.1701, lng: 21.3101, votes: 3 } } })]);
    expect(r.fixes).toHaveLength(1);
    expect(r.fixes[0].done).toBe(T('2026-11-11', '11:30').replace('Z', '.000Z'));
    expect(r.fixes[0].arrive).toBe(T('2026-11-11', '10:00').replace('Z', '.000Z'));
  });
  test('más nap → nem javít, csak jelez', () => {
    const r = ae.planClosedFix([st({ match_detail: { review: { from: T('2026-11-12', '10:00'), to: T('2026-11-12', '11:00'), lat: 46.17, lng: 21.31, votes: 3 } } })]);
    expect(r.fixes).toHaveLength(0);
    expect(r.notes[0].reason).toBe('closed_date_differs');
  });
  test('más hely / kevés egyező ellenőrzés / sofőr javította / sofőr gombja → nem nyúl hozzá', () => {
    const rv = { from: T('2026-11-11', '10:00'), to: T('2026-11-11', '11:00'), votes: 3 };
    expect(ae.planClosedFix([st({ match_detail: { review: { ...rv, lat: 46.3, lng: 21.5 } } })]).fixes).toHaveLength(0);
    expect(ae.planClosedFix([st({ match_detail: { review: { ...rv, votes: 1 } } })]).fixes).toHaveLength(0);
    expect(ae.planClosedFix([st({ auto_ack_action: 'time', match_detail: { review: rv } })]).fixes).toHaveLength(0);
    expect(ae.planClosedFix([st({ auto_filled: null, match_detail: { review: rv } })]).fixes).toHaveLength(0);
  });
  test('kis eltérés (≤ 10 perc) → nincs javítás', () => {
    const r = ae.planClosedFix([st({ match_detail: { review: { from: T('2026-11-11', '08:05'), to: T('2026-11-11', '09:05'), votes: 2 } } })]);
    expect(r.fixes).toHaveLength(0);
  });
});
