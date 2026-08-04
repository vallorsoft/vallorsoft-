// ============================================================
//  Unit-tesztek: lib/orderStops.js — több felrakó/lerakó pont
//  (multi-drop) normalizálás + replace/upsert.
// ============================================================
const orderStops = require('../../lib/orderStops');

describe('lib/orderStops.normalizeStops', () => {
  test('nincs stops-tömb → top-szintű mezőkből 1 pickup + 1 delivery', () => {
    const n = orderStops.normalizeStops({
      loc_incarcare: 'Cluj',
      firma_incarcare: 'FirmA',
      data_incarcare: '2026-07-30',
      loc_descarcare: 'Buc',
      data_descarcare: '2026-07-31',
    });
    expect(n.pickups).toHaveLength(1);
    expect(n.deliveries).toHaveLength(1);
    expect(n.pickups[0]).toMatchObject({ kind: 'pickup', stop_index: 0, loc: 'Cluj', firma: 'FirmA', data: '2026-07-30' });
    expect(n.deliveries[0]).toMatchObject({ kind: 'delivery', stop_index: 0, loc: 'Buc', data: '2026-07-31' });
  });

  test('pickups[] + deliveries[] tömb — sorrend + tisztítás', () => {
    const n = orderStops.normalizeStops({
      pickups: [{ loc: 'A', firma: 'AF' }],
      deliveries: [{ loc: 'D1' }, { loc: 'D2', data: '2026-08-01T10:00' }, { loc: 'D3' }],
    });
    expect(n.pickups).toHaveLength(1);
    expect(n.deliveries).toHaveLength(3);
    // stop_index-ek 0..N-1
    expect(n.deliveries.map((s) => s.stop_index)).toEqual([0, 1, 2]);
    // datetime → date-only
    expect(n.deliveries[1].data).toBe('2026-08-01');
  });

  test('stops[] tömb kind mezővel — pickup/delivery elkülönítés', () => {
    const n = orderStops.normalizeStops({
      stops: [
        { kind: 'delivery', loc: 'D1' },
        { kind: 'pickup', loc: 'P1' },
        { kind: 'delivery', loc: 'D2' },
        { kind: 'invalid', loc: 'X' },   // kihagyva
      ],
    });
    expect(n.pickups.map((s) => s.loc)).toEqual(['P1']);
    expect(n.deliveries.map((s) => s.loc)).toEqual(['D1', 'D2']);
  });

  test('üres/hosszú stringek biztonságos szűrése (255 limit)', () => {
    const long = 'X'.repeat(1000);
    const n = orderStops.normalizeStops({
      pickups: [{ loc: long, firma: long, data: 'nem-iso' }],
    });
    expect(n.pickups[0].loc.length).toBe(255);
    expect(n.pickups[0].firma.length).toBe(255);
    expect(n.pickups[0].data).toBeNull();   // 'nem-iso' → nem ISO → null
  });

  test('teljesen üres sor kihagyva (nem generál üres stopot)', () => {
    const n = orderStops.normalizeStops({
      pickups: [{}, { loc: '', firma: '' }, { loc: 'X' }],
    });
    expect(n.pickups).toHaveLength(1);
    expect(n.pickups[0].loc).toBe('X');
  });

  test('tömbök limitelve (max 20/40 sor)', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ loc: 'L' + i }));
    const n = orderStops.normalizeStops({ pickups: many, deliveries: many });
    expect(n.pickups.length).toBeLessThanOrEqual(20);
    expect(n.deliveries.length).toBeLessThanOrEqual(20);
  });
});

describe('lib/orderStops.replaceStopsForOrder', () => {
  function mockDb() {
    const calls = [];
    return {
      calls,
      query: jest.fn(async (sql, params) => {
        calls.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
        if (/^SELECT id, kind, stop_index/.test(sql.trim())) {
          // Simulálunk 1 meglévő pickup stopot arrived_at-tel
          return { rows: [{ id: 100, kind: 'pickup', stop_index: 0,
                            arrived_at: 'ts1', done_at: null, waybilled_at: null }] };
        }
        return { rows: [], rowCount: 1 };
      }),
    };
  }

  test('törli a régi stopokat, beszúrja az újakat, megőrzi az arrived_at-et', async () => {
    const db = mockDb();
    const norm = { pickups: [{ kind: 'pickup', stop_index: 0, loc: 'X', firma: null, data: null, ref: null }],
                   deliveries: [{ kind: 'delivery', stop_index: 0, loc: 'Y', firma: null, data: null, ref: null }] };
    await orderStops.replaceStopsForOrder(db, 'CMD-1', 42, norm);
    // 1 SELECT + 1 DELETE + 2 INSERT
    expect(db.calls.length).toBe(4);
    expect(db.calls[0].sql).toMatch(/^SELECT id, kind, stop_index/);
    expect(db.calls[1].sql).toMatch(/^DELETE FROM order_stops/);
    expect(db.calls[2].sql).toMatch(/INSERT INTO order_stops/);
    // Az arrived_at 'ts1' átvitetődött a pickup#0-ra ($9)
    expect(db.calls[2].params[8]).toBe('ts1');
    // A delivery új stop, arrived_at NULL
    expect(db.calls[3].params[8]).toBeNull();
  });
});
