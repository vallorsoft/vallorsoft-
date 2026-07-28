// ============================================================
//  Unit-teszt — lib/tripCrossings.js + handlers.previewTripDiurna
//
//  A menetlevélről ELTŰNT a kézi határátlépés-bevitel: a diurna
//  KIZÁRÓLAG a sofőr főoldali két gombjából (`border_crossings`,
//  GPS) számolódik, a Plecare→Sosire dátum-ablakban.
//
//  Itt azt védjük, hogy:
//   1. az ablak a NAPOKAT fedi (nem a pontos órát),
//   2. az ablak előtti utolsó átlépés SEED-ként bekerül a számításba,
//      de a menetlevél naplójába NEM,
//   3. az 'Iesire'/'Intrare' → 'OUT'/'IN' fordítás helyes,
//   4. a sofőr NEM kap extern/intern napszámot (pénzügyi adat),
//      az Admin/Manager igen.
// ============================================================
jest.mock('../../db', () => require('../helpers/db-mock').pool);

const { fetchTripCrossings } = require('../../lib/tripCrossings');
const { calculateDiurna } = require('../../lib/diurna');

// Mini pool-mock: a két lekérdezést (ablak / seed) a WHERE-záradék
// alapján különböztetjük meg (`created_at <` = seed).
function makePool(rowsInWindow, seedRow) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (/created_at < \$2/.test(sql)) return { rows: seedRow ? [seedRow] : [] };
      return { rows: rowsInWindow };
    },
  };
}
const xing = (tip, iso, locatie) => ({
  tip, tara: 'RO', locatie: locatie || null, created_at: new Date(iso),
});

describe('fetchTripCrossings — az ablak és a seed', () => {
  test('az ablak a NAPOKAT fedi: az indulás napjának reggeli átlépése is beleesik', async () => {
    // Plecare 12:00 (ez az alapérték, ha a sofőr nem adott órát), de a
    // határon már 06:00-kor átment → naptári nap alapján bele KELL esnie.
    const pool = makePool([xing('Iesire', '2026-03-02T06:00:00Z')], null);
    const r = await fetchTripCrossings(pool, 'sofer@x.ro', '2026-03-02T12:00', '2026-03-05T12:00');

    expect(r.inWindow).toHaveLength(1);
    // az ablak alsó határa az indulás napjának 00:00-ja, nem a 12:00
    const from = pool.calls[0].params[1];
    expect(from.getHours()).toBe(0);
    expect(from.getMinutes()).toBe(0);
    // a felső határ az érkezés napjának vége
    const to = pool.calls[0].params[2];
    expect(to.getHours()).toBe(23);
  });

  test('irány-fordítás: Iesire→OUT, Intrare→IN', async () => {
    const pool = makePool([
      xing('Iesire', '2026-03-02T08:00:00Z', 'Nadlac'),
      xing('Intrare', '2026-03-04T20:00:00Z', 'Bors'),
    ], null);
    const r = await fetchTripCrossings(pool, 'sofer@x.ro', '2026-03-02T06:00', '2026-03-05T18:00');

    expect(r.inWindow.map(c => c.direction)).toEqual(['OUT', 'IN']);
    expect(r.inWindow[0].locatie).toBe('Nadlac');
    expect(r.inWindow[0].source).toBe('gps');     // gombból, nem kézi bevitel
  });

  test('az ablak ELŐTTI utolsó átlépés seed-ként számít, de a naplóba nem kerül', async () => {
    // A sofőr az ELŐZŐ menetlevélen lépett ki, és ezen a menetlevélen
    // végig kint volt (nincs átlépés az ablakban).
    const pool = makePool([], xing('Iesire', '2026-02-27T10:00:00Z'));
    const r = await fetchTripCrossings(pool, 'sofer@x.ro', '2026-03-02T06:00', '2026-03-04T18:00');

    expect(r.inWindow).toHaveLength(0);           // a menetlevél naplója üres
    expect(r.forCalc).toHaveLength(1);            // de a számítás tud a kint-létről
    expect(r.forCalc[0].direction).toBe('OUT');
  });

  test('a seed nélkül INTERN lenne, seeddel EXTERN — ez a lényeg', async () => {
    const dep = '2026-03-02T06:00', arr = '2026-03-04T18:00';
    const seedPool = makePool([], xing('Iesire', '2026-02-27T10:00:00Z'));
    const bare = await fetchTripCrossings(seedPool, 'sofer@x.ro', dep, arr);

    const withSeed = calculateDiurna(dep, arr, bare.forCalc);
    const without = calculateDiurna(dep, arr, bare.inWindow);

    expect(withSeed.externDays).toBeGreaterThan(0);
    expect(without.externDays).toBe(0);           // a régi (hibás) eredmény
    expect(withSeed.externDays + withSeed.internDays)
      .toBe(without.externDays + without.internDays);   // a napok száma ugyanaz
  });

  test('hiányzó dátum / fordított ablak → üres (nincs lekérdezés)', async () => {
    const pool = makePool([xing('Iesire', '2026-03-02T08:00:00Z')], null);
    expect((await fetchTripCrossings(pool, 'a@b.ro', null, '2026-03-05T12:00')).inWindow).toHaveLength(0);
    expect((await fetchTripCrossings(pool, 'a@b.ro', '2026-03-05T12:00', '2026-03-02T12:00')).inWindow).toHaveLength(0);
    expect(pool.calls).toHaveLength(0);
  });

  test('a lekérdezés a BEJELENTKEZETT sofőr e-mailjére szűr (nincs idegen adat)', async () => {
    const pool = makePool([], null);
    await fetchTripCrossings(pool, 'Sofer@X.ro', '2026-03-02T06:00', '2026-03-04T18:00');
    pool.calls.forEach(c => {
      expect(c.sql).toMatch(/LOWER\(email_sofer\) = LOWER\(\$1\)/);
      expect(c.params[0]).toBe('Sofer@X.ro');
    });
  });
});

describe('previewTripDiurna handler — szerep-függő válasz', () => {
  const { pool, reset } = require('../helpers/db-mock');
  const handlers = require('../../handlers/documents');

  function call(user, args) {
    return new Promise((resolve) => {
      handlers.previewTripDiurna({ session: { user } }, { json: (p) => resolve(p.result) }, args);
    });
  }

  beforeEach(() => {
    reset();
    // ablak-lekérdezés → két átlépés; seed-lekérdezés → nincs korábbi
    pool.query.mockImplementation(async (sql) => (/created_at < \$2/.test(sql)
      ? { rows: [] }
      : { rows: [xing('Iesire', '2026-03-02T08:00:00Z'), xing('Intrare', '2026-03-04T20:00:00Z')] }));
  });

  const ARGS = [{ indulasDt: '2026-03-02T06:00', erkezesDt: '2026-03-05T18:00' }];

  test('sofőr: megkapja a naplót és a napok számát, de NEM a diurna napszámot', async () => {
    const r = await call({ email: 's@x.ro', pozicio: 'Sofer', company_id: 1 }, ARGS);
    expect(r.ok).toBe(true);
    expect(r.crossings).toHaveLength(2);
    expect(r.days).toBeGreaterThan(0);
    expect(r.externDays).toBeUndefined();
    expect(r.internDays).toBeUndefined();
  });

  test('Admin: megkapja az extern/intern bontást is', async () => {
    const r = await call({ email: 's@x.ro', pozicio: 'Admin', company_id: 1 }, ARGS);
    expect(r.externDays).toBeGreaterThanOrEqual(0);
    expect(r.internDays).toBeGreaterThanOrEqual(0);
    expect(r.externDays + r.internDays).toBe(r.days);
  });

  test('hiányzó dátum → ready:false (nincs hiba)', async () => {
    const r = await call({ email: 's@x.ro', pozicio: 'Sofer', company_id: 1 }, [{}]);
    expect(r.ok).toBe(true);
    expect(r.ready).toBe(false);
  });

  test('bejelentkezés nélkül → elutasít', async () => {
    const r = await call(null, ARGS);
    expect(r.ok).toBe(false);
  });
});
