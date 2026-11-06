// lib/stopWaybill.js — a GPS szerinti cím rátétele a menetlevél pontjaira
jest.mock('../../db', () => require('../helpers/db-mock').pool);
const wb = require('../../lib/stopWaybill');

const STOP = { id: 11, order_id: 'O1', kind: 'pickup', actual_address: 'Str. Fabricii 7, Cluj-Napoca' };

describe('stopWaybill', () => {
  test('stopId alapján csak a saját pont változik, az eredeti megmarad', () => {
    const p = [{ tip: 'Plecare', loc: 'Garaj' }, { tip: 'Încărcare', loc: 'Cluj', stopId: '11', time: '08:00' }, { tip: 'Încărcare', loc: 'Turda', stopId: '12' }];
    const r = wb.rewritePuncte(p, STOP, false, false);
    expect(r.changed).toBe(1);
    expect(r.puncte[1]).toMatchObject({ loc: STOP.actual_address, loc_planned: 'Cluj', loc_source: 'gps', time: '08:00', stopId: '11' });
    expect(r.puncte[2].loc).toBe('Turda');
    expect(r.puncte[0].loc).toBe('Garaj');
  });

  test('régi pont (stopId nélkül) csak egyértelmű esetben', () => {
    const p = [{ tip: 'Încărcare', loc: 'Cluj', orderId: 'O1', role: 'loading' }];
    expect(wb.rewritePuncte(p, STOP, false, false).changed).toBe(0); // több felrakó → nem tippel
    expect(wb.rewritePuncte(p, STOP, true, false).changed).toBe(1);
    const delivery = [{ tip: 'Descărcare', loc: 'Turda', orderId: 'O1', role: 'unloading' }];
    expect(wb.rewritePuncte(delivery, STOP, true, false).changed).toBe(0);
  });

  test('ismételt rátétel idempotens, visszaállítás a tervezettet adja vissza', () => {
    const p = [{ tip: 'Încărcare', loc: 'Cluj', stopId: 11 }];
    const a = wb.rewritePuncte(p, STOP, false, false).puncte;
    expect(wb.rewritePuncte(a, STOP, false, false).changed).toBe(0);
    const b = wb.rewritePuncte(a, STOP, false, true);
    expect(b.changed).toBe(1);
    expect(b.puncte[0]).toEqual({ tip: 'Încărcare', loc: 'Cluj', stopId: 11 });
  });

  test('irodában kézzel átírt GPS-címhez nem nyúl', () => {
    const p = [{ tip: 'Încărcare', loc: 'Kézi cím', loc_planned: 'Cluj', stopId: 11 }];
    expect(wb.rewritePuncte(p, STOP, false, false).changed).toBe(0);
  });

  test('küszöb', () => {
    const s = { auto_apply: true, min_score: 80 };
    expect(wb.qualifies(s, 'auto', 85)).toBe(true);
    expect(wb.qualifies(s, 'auto', 79)).toBe(false);
    expect(wb.qualifies(s, 'unmatched', 99)).toBe(false);
    expect(wb.qualifies({ auto_apply: false, min_score: 10 }, 'auto', 99)).toBe(false);
  });
});

describe('stopWaybill — elárvult pontok (a fuvar szerkesztése után régi stopId)', () => {
  // A valós eset: MT-2026-0031 — egy fuvar 3 felrakóval (Arad, Cluj, Arad) és 3 lerakóval
  // (Copșa Mică ×3), a menetlevél pontjai a szerkesztés előtti azonosítókra mutatnak.
  const stops = [
    { id: 201, kind: 'pickup',   seq_index: 0, stop_index: 0, data: '2026-10-19', done_at: '2026-10-19T09:00:00Z' },
    { id: 202, kind: 'delivery', seq_index: 1, stop_index: 0, data: '2026-10-20', done_at: '2026-10-20T05:10:00Z' },
    { id: 203, kind: 'pickup',   seq_index: 2, stop_index: 1, data: '2026-10-20', done_at: '2026-10-20T13:00:00Z' },
    { id: 204, kind: 'delivery', seq_index: 3, stop_index: 1, data: '2026-10-21', done_at: '2026-10-21T05:00:00Z' },
    { id: 205, kind: 'pickup',   seq_index: 4, stop_index: 2, data: '2026-10-21', done_at: '2026-10-21T11:00:00Z' },
    { id: 206, kind: 'delivery', seq_index: 5, stop_index: 2, data: '2026-10-22', done_at: '2026-10-22T04:30:00Z' },
  ];
  const puncte = [
    { tip: 'Plecare', loc: 'Arcus-Garaj', data: '2026-10-19' },
    { tip: 'Descărcare', loc: 'Copșa Mică', data: '2026-10-19', orderId: 'O0', role: 'unloading', stopId: '90' },
    { tip: 'Încărcare', loc: 'Arad, RO', data: '2026-10-19', orderId: 'O1', role: 'loading', stopId: '101' },
    { tip: 'Descărcare', loc: 'Strada Uzinei, 555400 Copșa Mică', data: '2026-10-20', orderId: 'O1', role: 'unloading', stopId: '102' },
    { tip: 'Încărcare', loc: 'Calea Baciului 3-4, Cluj-Napoca', data: '2026-10-20', orderId: 'O1', role: 'loading', stopId: '103' },
    { tip: 'Descărcare', loc: 'Strada Uzinei, 555400 Copșa Mică', data: '2026-10-21', orderId: 'O1', role: 'unloading', stopId: '104' },
    { tip: 'Încărcare', loc: 'Arad, RO', data: '2026-10-21', orderId: 'O1', role: 'loading', stopId: '105' },
    { tip: 'Descărcare', loc: 'Strada Uzinei, 555400 Copșa Mică', data: '2026-10-22', orderId: 'O1', role: 'unloading', stopId: '106' },
    { tip: 'Sosire', loc: 'Arcus', data: '2026-10-22' },
  ];
  const stop = (id, addr) => ({ ...stops.find((x) => x.id === id), order_id: 'O1', actual_address: addr });

  test('minden állomás a saját pontját kapja (dátum szerint), a stopId kijavul', () => {
    let cur = puncte;
    const addr = {
      201: 'Arad (46.1, 21.3)', 202: 'Copșa Mică (46.11772, 24.23624)', 203: 'Cluj-Napoca (46.78, 23.55)',
      204: 'Copșa Mică (46.11772, 24.23625)', 205: 'Arad (46.1, 21.31)', 206: 'Copșa Mică (46.11773, 24.23624)',
    };
    for (const id of [201, 202, 203, 204, 205, 206]) {
      const st = stop(id, addr[id]);
      const r = wb.rewritePuncte(cur, st, false, false, wb.orphanIndexes(cur, st, stops));
      expect(r.changed).toBe(1);
      cur = r.puncte;
    }
    expect(cur.slice(2, 8).map((p) => p.loc)).toEqual([addr[201], addr[202], addr[203], addr[204], addr[205], addr[206]]);
    expect(cur.slice(2, 8).map((p) => String(p.stopId))).toEqual(['201', '202', '203', '204', '205', '206']);
    expect(cur[3].loc_planned).toBe('Strada Uzinei, 555400 Copșa Mică');
    // a másik fuvar pontja és a Plecare/Sosire érintetlen
    expect(cur[1]).toEqual(puncte[1]);
    expect(cur[0]).toEqual(puncte[0]);
    expect(cur[8]).toEqual(puncte[8]);
  });

  test('élő stopId-val kötött pontot nem vesz el más állomás', () => {
    const p = puncte.map((x) => (x.stopId === '104' ? { ...x, stopId: 204 } : x));
    const st = stop(202, 'X');
    const idx = wb.orphanIndexes(p, st, stops);
    expect([...idx]).toEqual([3]);   // csak a 2026-10-20-i lerakó
    expect(wb.orphanIndexes(p, stop(204, 'Y'), stops).size).toBe(0);   // a sajátját stopId-vel kapja meg
  });

  test('dátum nélkül sorrend szerint, ha a darabszám egyezik; különben nem tippel', () => {
    const nd = puncte.map((x) => ({ ...x, data: '' }));
    expect([...wb.orphanIndexes(nd, stop(204, 'Y'), stops)]).toEqual([5]);
    const fewer = nd.filter((_, i) => i !== 7);
    expect(wb.orphanIndexes(fewer, stop(204, 'Y'), stops).size).toBe(0);
  });

  test('a helyi nap is számít (éjfél utáni gombnyomás)', () => {
    const d = wb.stopDays({ done_at: '2026-10-21T22:30:00Z' });
    expect(d.has('2026-10-21')).toBe(true);
    expect(d.has('2026-10-22')).toBe(true);   // Bukarest: UTC+3
  });

  test('applyStop: a régi stopId-s pont is átíródik és a DB-be kerül', async () => {
    const calls = [];
    const db = { query: jest.fn(async (sql, params) => {
      calls.push([String(sql).replace(/\s+/g, ' '), params]);
      if (/FROM order_stops WHERE id=\$1/.test(sql)) return { rows: [{ id: 204, order_id: 'O1', kind: 'delivery', actual_address: 'Copșa Mică (46.11772, 24.23624)', match_status: 'auto' }] };
      if (/FROM order_stops WHERE order_id=\$1/.test(sql)) return { rows: stops };
      if (/FROM fuvarlevelek/.test(sql)) return { rows: [{ id: 'W1', puncte }] };
      return { rows: [], rowCount: 1 };
    }) };
    const r = await wb.applyStop(7, 204, { db });
    expect(r).toMatchObject({ ok: true, waybills: 1, points: 1 });
    const up = calls.find((c) => /UPDATE fuvarlevelek/.test(c[0]));
    const saved = JSON.parse(up[1][2]);
    expect(saved[5]).toMatchObject({ loc: 'Copșa Mică (46.11772, 24.23624)', stopId: 204, loc_source: 'gps' });
    expect(saved[3].loc).toBe('Strada Uzinei, 555400 Copșa Mică');
  });
});
