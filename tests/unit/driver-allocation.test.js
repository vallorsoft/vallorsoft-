// ============================================================
//  _allocateDriver — kifizetés-allokáció (STRICT OLDEST-FIRST)
//  A felhasználó explicit kérésére (PR #491) a solo kifizetést
//  MINDIG a LEGRÉGEBBI kifizetetlen tételre allokáljuk, hó-határon
//  átnyúlva. A régi „saját-hó előbb" heurisztika törölve — így egy
//  szept.-i kifizetés először egy még nyitott aug.-i tartozást fedez.
//  A guided (kliens-vezetett) allokáció ettől független — ott a
//  felhasználó explicit alloc_ron-t ad meg.
// ============================================================
jest.mock('../../db', () => require('../helpers/db-mock').pool);
jest.mock('../../lib/audit', () => ({ record: jest.fn(), fromReq: jest.fn() }));
jest.mock('../../services/bnr', () => ({ fetchBnrEurRon: jest.fn() }));

const { pool, rows, reset } = require('../helpers/db-mock');
const fleet = require('../../handlers/fleetCompliance');
const _allocateDriver = fleet._allocateDriver;

// SQL-mintázat szerint válaszol (sorrend-független) — így az allokáció-motor
// belső lekérdezés-sorrendjétől független a teszt.
function mockDb({ earnings = [], groupItems = [], payments = [] }) {
  pool.query.mockImplementation((sql) => {
    if (/FROM driver_earnings/i.test(sql) && /ORDER BY earning_date ASC/i.test(sql)) return Promise.resolve(rows(earnings));
    if (/driver_payment_group_items/i.test(sql)) return Promise.resolve(rows(groupItems));
    if (/FROM driver_payments/i.test(sql) && /paid_at <= CURRENT_DATE/i.test(sql)) return Promise.resolve(rows(payments));
    return Promise.resolve(rows([]));
  });
}

beforeEach(() => reset());

describe('_allocateDriver — STRICT oldest-first solo allokáció', () => {
  // Aug. elmaradás + szept. tételek + 3 szept. solo kifizetés.
  const BNR = 5.24;
  const earnings = [
    { id: 1, earning_date: '2026-08-15', currency: 'RON', total_amount: 937, kind: 'other', label: 'Aug' },
    { id: 2, earning_date: '2026-09-01', currency: 'EUR', total_amount: 360, kind: 'diurna', label: 'Sep kicsi' },
    { id: 3, earning_date: '2026-09-12', currency: 'EUR', total_amount: 480, kind: 'salary', label: 'Salariu zilnic' },
  ];
  const payments = [
    { id: 10, paid_at: '2026-09-04', amount: 137,  currency: 'RON', amount_ron: 137,  group_id: null },
    { id: 11, paid_at: '2026-09-04', amount: 800,  currency: 'RON', amount_ron: 800,  group_id: null },
    { id: 12, paid_at: '2026-09-11', amount: 2500, currency: 'RON', amount_ron: 2500, group_id: null },
  ];

  test('a legelső kifizetés az AUGUSZTUSI tartozásra megy (a legrégebbi kifizetetlen)', async () => {
    mockDb({ earnings, payments });
    const { alloc } = await _allocateDriver(1, 'b@ceg.hu', BNR);
    // 137 + 800 = 937 RON → aug. (id=1) TELJESEN fedezve
    expect(alloc.get(1).fully).toBe(true);
    expect(alloc.get(1).settled_ron).toBeCloseTo(937, 1);
    // 2500 RON → id=2 (1886.4 RON, sep 1) teljes + id=3 (2515.2 RON, sep 12) részleges
    expect(alloc.get(2).fully).toBe(true);
    expect(alloc.get(2).settled_ron).toBeCloseTo(1886.4, 1);
    expect(alloc.get(3).fully).toBe(false);
    // p12 maradéka a szept. salariura: 2500 − 1886.4 = 613.6 RON
    expect(alloc.get(3).settled_ron).toBeCloseTo(613.6, 1);
  });

  test('paymentCovers: a p10+p11 aug.-i tételt fedez, a p12 szept.-eket', async () => {
    mockDb({ earnings, payments });
    const { paymentCovers } = await _allocateDriver(1, 'b@ceg.hu', BNR);
    // p10 (137) + p11 (800): az aug.-i id=1-et fedezik
    for (const pid of [10, 11]) {
      const cov = paymentCovers.get(pid) || [];
      expect(cov.length).toBeGreaterThan(0);
      cov.forEach(c => expect(c.earning_id).toBe(1));
      cov.forEach(c => expect(c.month).toBe('2026-08'));
    }
    // p12 (2500): id=2 + id=3, mindkét szept.-i
    const cov12 = paymentCovers.get(12) || [];
    const eids = cov12.map(c => c.earning_id).sort();
    expect(eids).toEqual([2, 3]);
  });

  test('teljes túlfizetés: minden tétel fedezve, a maradék elveszik', async () => {
    // Szept. tételek: 360 EUR + 480 EUR = 4401.6 RON + aug. 937 = 5338.6 RON.
    // 6000 RON kifizetés → mindent lefed
    const bigPay = [{ id: 20, paid_at: '2026-09-20', amount: 6000, currency: 'RON', amount_ron: 6000, group_id: null }];
    mockDb({ earnings, payments: bigPay });
    const { alloc, paymentCovers } = await _allocateDriver(1, 'b@ceg.hu', BNR);
    expect(alloc.get(1).fully).toBe(true);
    expect(alloc.get(2).fully).toBe(true);
    expect(alloc.get(3).fully).toBe(true);
    const cov = paymentCovers.get(20) || [];
    // Egyetlen kifizetés fedezi mind a hármat, oldest-first sorrendben
    expect(cov.length).toBe(3);
    expect(cov[0].earning_id).toBe(1);  // aug. elsőnek
    expect(cov[1].earning_id).toBe(2);  // sep 1 másodiknak
    expect(cov[2].earning_id).toBe(3);  // sep 12 utolsónak
  });

  test('csoportos (guided) tétel pre-elszámolva marad — a solo NEM nyúl hozzá', async () => {
    // id=1 augusztus egy csoportban van (alloc_ron NULL = teljes) → fully.
    const grp = [{ group_id: 5, earning_id: 1, alloc_ron: null }];
    const soloSep = [{ id: 30, paid_at: '2026-09-05', amount: 1886.4, currency: 'RON', amount_ron: 1886.4, group_id: null }];
    mockDb({ earnings, groupItems: grp, payments: soloSep });
    const { alloc } = await _allocateDriver(1, 'b@ceg.hu', BNR);
    expect(alloc.get(1).fully).toBe(true);              // csoport fedezi az augusztust
    // A solo 1886.4 RON az id=1-en már nem tud levonni (csoport fedezi), és
    // az id=2 is legrégebbi kifizetetlen → oda kerül. id=3 érintetlen.
    expect(alloc.get(2).fully).toBe(true);
    expect((alloc.get(3) || { settled_ron: 0 }).settled_ron).toBe(0);
  });
});
