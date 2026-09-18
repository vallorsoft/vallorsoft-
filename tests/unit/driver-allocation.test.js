// ============================================================
//  _allocateDriver — kifizetés-allokáció (SAME-MONTH-FIRST)
//  Regresszió-védelem a felhasználói hibára: a szeptemberi solo
//  kifizetést NEM viheti el az augusztusi (korábbi havi) elmaradás —
//  a kifizetés ELŐSZÖR a saját hónapja tételeit fedezi, és csak a
//  maradéka csordul át a régebbi hónapokra (legrégebbi elöl).
//  Emellett a payment-enkénti FEDEZET (paymentCovers) is helyes.
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

describe('_allocateDriver — same-month-first solo allokáció', () => {
  // A felhasználó valós esete: aug. elmaradás + szept. tételek + 3 szept. solo kifizetés.
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

  test('szeptemberi kifizetés a SZEPTEMBERI tételekre megy (nem az augusztusira)', async () => {
    mockDb({ earnings, payments });
    const { alloc } = await _allocateDriver(1, 'b@ceg.hu', BNR);
    // Augusztus (id=1) érintetlen — a szept. pénzt nem viszi el
    expect((alloc.get(1) || { settled_ron: 0 }).settled_ron).toBe(0);
    // Szept. kicsi (id=2, 360 EUR = 1886.4 RON) teljesen fedezve
    expect(alloc.get(2).fully).toBe(true);
    expect(alloc.get(2).settled_ron).toBeCloseTo(1886.4, 1);
    // Salariu (id=3, 480 EUR = 2515.2 RON) a maradékból: 3437 − 1886.4 = 1550.6
    // (a RÉGI, globális FIFO ezt tévesen 613.6-ra vitte → most 1550.6)
    expect(alloc.get(3).settled_ron).toBeCloseTo(1550.6, 1);
    expect(alloc.get(3).fully).toBe(false);
  });

  test('a régi bug (613.6 RON a Salariun) NEM fordul elő', async () => {
    mockDb({ earnings, payments });
    const { alloc } = await _allocateDriver(1, 'b@ceg.hu', BNR);
    expect(alloc.get(3).settled_ron).not.toBeCloseTo(613.6, 1);
  });

  test('paymentCovers: minden szept. kifizetés SZEPTEMBERI tételt fedez', async () => {
    mockDb({ earnings, payments });
    const { paymentCovers } = await _allocateDriver(1, 'b@ceg.hu', BNR);
    // p10 + p11 a szept. kicsire (id=2, 2026-09)
    for (const pid of [10, 11]) {
      const cov = paymentCovers.get(pid) || [];
      expect(cov.length).toBeGreaterThan(0);
      cov.forEach(c => expect(c.month).toBe('2026-09'));
    }
    // p12 (2500) fedezi id=2 maradékát + id=3-at, mind szeptember
    const cov12 = paymentCovers.get(12) || [];
    const eids = cov12.map(c => c.earning_id).sort();
    expect(eids).toEqual([2, 3]);
    cov12.forEach(c => expect(c.month).toBe('2026-09'));
    // Egyetlen kifizetés SEM fedez augusztusi (id=1) tételt
    for (const pid of [10, 11, 12]) {
      (paymentCovers.get(pid) || []).forEach(c => expect(c.earning_id).not.toBe(1));
    }
  });

  test('túlfizetés ÁTCSORDUL a régebbi (augusztusi) elmaradásra', async () => {
    // Szept. tételek: 360 EUR + 480 EUR = 4401.6 RON. Kifizetés 6000 RON (szept).
    const bigPay = [{ id: 20, paid_at: '2026-09-20', amount: 6000, currency: 'RON', amount_ron: 6000, group_id: null }];
    mockDb({ earnings, payments: bigPay });
    const { alloc, paymentCovers } = await _allocateDriver(1, 'b@ceg.hu', BNR);
    // Szept. tételek teljesen fedezve
    expect(alloc.get(2).fully).toBe(true);
    expect(alloc.get(3).fully).toBe(true);
    // A maradék (6000 − 4401.6 = 1598.4) az augusztusira csordul (937 → fully)
    expect(alloc.get(1).fully).toBe(true);
    // A kifizetés fedezete tartalmaz augusztusi tételt is (átcsordulás)
    const cov = paymentCovers.get(20) || [];
    expect(cov.some(c => c.earning_id === 1 && c.month === '2026-08')).toBe(true);
  });

  test('csoportos (guided) tétel pre-elszámolva marad — a solo NEM nyúl hozzá', async () => {
    // id=1 augusztus egy csoportban van (alloc_ron NULL = teljes) → fully.
    const grp = [{ group_id: 5, earning_id: 1, alloc_ron: null }];
    const soloSep = [{ id: 30, paid_at: '2026-09-05', amount: 1886.4, currency: 'RON', amount_ron: 1886.4, group_id: null }];
    mockDb({ earnings, groupItems: grp, payments: soloSep });
    const { alloc } = await _allocateDriver(1, 'b@ceg.hu', BNR);
    expect(alloc.get(1).fully).toBe(true);              // csoport fedezi az augusztust
    expect(alloc.get(2).fully).toBe(true);              // a szept. solo a szept. kicsit fedezi
    expect((alloc.get(3) || { settled_ron: 0 }).settled_ron).toBe(0); // salariura már nem jut
  });
});
