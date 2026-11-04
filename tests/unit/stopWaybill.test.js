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
