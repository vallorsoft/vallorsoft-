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
  function mockDb(prevRows) {
    const calls = [];
    return {
      calls,
      query: jest.fn(async (sql, params) => {
        calls.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
        if (/^SELECT id, kind, stop_index/.test(sql.trim())) {
          return { rows: prevRows || [{ id: 100, kind: 'pickup', stop_index: 0, loc: 'X', data: null }] };
        }
        return { rows: [], rowCount: 1 };
      }),
    };
  }
  const kinds = (db, re) => db.calls.filter((c) => re.test(c.sql));

  test('a meglévő állomás azonosítója megmarad (helyben frissül), az új beszúródik', async () => {
    const db = mockDb();
    const norm = { pickups: [{ kind: 'pickup', stop_index: 0, loc: 'X', firma: null, data: null, ref: null }],
                   deliveries: [{ kind: 'delivery', stop_index: 0, loc: 'Y', firma: null, data: null, ref: null }] };
    await orderStops.replaceStopsForOrder(db, 'CMD-1', 42, norm);
    expect(db.calls[0].sql).toMatch(/^SELECT id, kind, stop_index/);
    const up = kinds(db, /^UPDATE order_stops SET stop_index/);
    expect(up.length).toBe(1);
    expect(up[0].params[0]).toBe(100);            // ugyanaz az id
    expect(kinds(db, /^DELETE FROM order_stops/).length).toBe(0);
    const ins = kinds(db, /INSERT INTO order_stops/);
    expect(ins.length).toBe(1);
    expect(ins[0].params[2]).toBe('delivery');
    expect(ins[0].params[9]).toBeNull();          // új stop: arrived_at NULL
    expect(ins[0].params[4]).toBe(1);             // seq_index
  });

  test('beszúrt köztes állomás: a régiek a HELYÜK alapján tartják az azonosítót', async () => {
    const prev = [
      { id: 1, kind: 'pickup', stop_index: 0, loc: 'Arad', data: '2026-10-19' },
      { id: 2, kind: 'delivery', stop_index: 0, loc: 'Copsa Mica', data: '2026-10-20' },
      { id: 3, kind: 'pickup', stop_index: 1, loc: 'Cluj', data: '2026-10-20' },
    ];
    const db = mockDb(prev);
    const n = orderStops.normalizeStops({ stops: [
      { kind: 'pickup', loc: 'Arad', data: '2026-10-19' },
      { kind: 'pickup', loc: 'Deva', data: '2026-10-19' },        // új, középre
      { kind: 'delivery', loc: 'Copșa Mică', data: '2026-10-20' }, // ékezet-független
      { kind: 'pickup', loc: 'Cluj', data: '2026-10-20' },
    ] });
    await orderStops.replaceStopsForOrder(db, 'CMD-3', 42, n);
    const up = kinds(db, /^UPDATE order_stops SET stop_index/);
    const byId = Object.fromEntries(up.map((c) => [c.params[0], c.params]));
    expect(Object.keys(byId).map(Number).sort()).toEqual([1, 2, 3]);
    expect(byId[3][2]).toBe(2);      // Cluj új stop_index-e 2 (a Deva elé került)
    expect(byId[3][4]).toBe('Cluj');
    const ins = kinds(db, /INSERT INTO order_stops/);
    expect(ins.length).toBe(1);
    expect(ins[0].params[5]).toBe('Deva');
    expect(kinds(db, /^DELETE FROM order_stops/).length).toBe(0);
    // a helyük nem változott → nincs cím-felismerés-reset, de a fuvar újra sorba áll
    expect(kinds(db, /SET match_status = NULL/).length).toBe(0);
    expect(kinds(db, /UPDATE stop_match_state SET requeued = true/).length).toBe(1);
  });

  test('törölt állomás törlődik, átírt helyű állomás újra felismerésre kerül', async () => {
    const prev = [
      { id: 7, kind: 'delivery', stop_index: 0, loc: 'Copsa Mica', data: null },
      { id: 8, kind: 'delivery', stop_index: 1, loc: 'Medias', data: null },
    ];
    const db = mockDb(prev);
    const n = orderStops.normalizeStops({ stops: [{ kind: 'delivery', loc: 'Sibiu' }] });
    await orderStops.replaceStopsForOrder(db, 'CMD-4', 42, n);
    const up = kinds(db, /^UPDATE order_stops SET stop_index/);
    expect(up.length).toBe(1);
    expect(up[0].params[0]).toBe(7);               // sorszám alapján (0)
    const del = kinds(db, /^DELETE FROM order_stops/);
    expect(del[0].params[2]).toEqual([8]);
    const reset = kinds(db, /SET match_status = NULL/);
    expect(reset.length).toBe(1);
    expect(reset[0].params[1]).toEqual([7]);
  });

  test('pairStops: a kliens által küldött id elsőbbséget kap', () => {
    const prev = [{ id: 5, kind: 'pickup', stop_index: 0, loc: 'A' }, { id: 6, kind: 'pickup', stop_index: 1, loc: 'B' }];
    const r = orderStops.pairStops([{ id: 6, kind: 'pickup', stop_index: 0, loc: 'A' }], prev);
    expect(r.pairs.get(0).id).toBe(6);
    expect(r.unmatched.map((x) => x.id)).toEqual([5]);
  });

  test('stops[] ordered — interleaved sorrend megőrizve seq_index-ben', async () => {
    const db = mockDb();
    // A hívók (comCreate/comUpdate) mostantól normalizeStops-t hívnak: adjunk
    // egy INTERLEAVED bevitelt, és ellenőrizzük, hogy a seq_index a bevitel
    // sorrendjét tükrözi (nem a kind-alapú csoportosítást).
    const n = orderStops.normalizeStops({
      stops: [
        { kind: 'pickup',   loc: 'P1' },
        { kind: 'delivery', loc: 'D1' },
        { kind: 'pickup',   loc: 'P2' },
        { kind: 'delivery', loc: 'D2' },
      ],
    });
    expect(n.seq.map((s) => s.kind)).toEqual(['pickup', 'delivery', 'pickup', 'delivery']);
    expect(n.seq.map((s) => s.seq_index)).toEqual([0, 1, 2, 3]);
    // kind-en belüli stop_index továbbra is 0-alapú
    expect(n.pickups.map((s) => s.stop_index)).toEqual([0, 1]);
    expect(n.deliveries.map((s) => s.stop_index)).toEqual([0, 1]);

    await orderStops.replaceStopsForOrder(db, 'CMD-2', 42, n);
    // a meglévő pickup#0 (X) sorszám alapján helyben frissül (P1), a többi beszúródik
    const up = kinds(db, /^UPDATE order_stops SET stop_index/);
    expect(up.length).toBe(1);
    expect(up[0].params[0]).toBe(100);
    expect(up[0].params[3]).toBe(0);              // seq_index
    const ins = kinds(db, /INSERT INTO order_stops/);
    expect(ins.map((c) => c.params[4])).toEqual([1, 2, 3]);
    expect(ins.map((c) => c.params[2])).toEqual(['delivery', 'pickup', 'delivery']);
  });
});
