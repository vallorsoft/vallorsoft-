// ============================================================
//  getMySoferStats — sofőr havi mini-statisztika + előző havi
//                    + hónap-határon átívelő menetlevél bontás
//
//  A handler:
//    (1) Egy SELECT-tel lekéri a Finalizat + Alocat/In Curs fuvarok
//        jelen + előző havi számát (ordR).
//    (2) A menetleveleket a jelen + előző hó ablakban nyersen lekéri.
//    (3) A hónap-határokat SQL-ből lekéri (m_curr / m_prev).
//    (4) A GPS hó-végi snapshotokat is lekéri az előző hóra.
//    (5) JS-ben minden menetlevélt hozzárendel a jelen/előző havi
//        aggregátorhoz — átívelő menetlevélt szétbont a snapshot
//        (KM) + napok szerinti arány (DIURNA + TANKOLT) alapján.
//
//  Ellenőrizzük: szerep-kapu, JS-alapú aggregáció helyessége
//  (nem-átívelő, átívelő + snapshot, átívelő snapshot NÉLKÜL).
// ============================================================
jest.mock('../../db', () => require('../helpers/db-mock').pool);

const request = require('supertest');
const express = require('express');
const { pool, rows, reset } = require('../helpers/db-mock');
const { setUser, sessionMiddleware, fixtures } = require('../helpers/session-mock');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(sessionMiddleware);
app.use(require('../../routes/execute'));

function call(fn, args) {
  return request(app).post('/api/execute').send({ functionName: fn, arguments: args });
}

const CID = 1;
const SOFER = { ...fixtures.sofer, company_id: CID };
const ADMIN = { ...fixtures.admin, company_id: CID };

// Segéd: felállítja az 5-6 alap-lekérdezést a chain-ben (orders, fuvarlevelek,
// hónap-határok, snapshotok, kiosztott járművek, és opcionálisan a manager
// notification dedup-lookupot). A snap-sorok most (rendszam, year, month,
// mileage, fuel_level) formátumúak — a handler kiválogatja őket prev/prev-prev
// hónapra. Az `assigned` a sofőr kiosztott járműveinek rendszám-listája.
// A `notifExists` (default true) → a dedup-lekérdezés talál/nem talál sort;
// ha nem talál, a handler beszúrási hívást tesz — ezt is mockolnunk kell.
function mockChain({ ord, fuvs, snaps, assigned, mCurr = '2026-07-01T00:00:00Z', mPrev = '2026-06-01T00:00:00Z', notifExists = true }) {
  pool.query
    .mockResolvedValueOnce(rows([ord]))
    .mockResolvedValueOnce(rows(fuvs || []))
    .mockResolvedValueOnce(rows([{ m_curr: mCurr, m_prev: mPrev }]))
    .mockResolvedValueOnce(rows(snaps || []))
    .mockResolvedValueOnce(rows((assigned || []).map((r) => ({ rendszam: r }))));
  // Ha manager_warn_diff triggerelne (nagy avg_diff), a handler dedup-lookupot
  // + esetleges INSERT-et is végez. A tesztek nagy részében nem triggerelünk,
  // ezért ezt csak akkor kell mockolni, ha az adott teszt tényleg trigger-t
  // vár — mockResolvedValue-t használunk fallbackre (végtelen üres válasz).
  pool.query.mockResolvedValue(rows(notifExists ? [{ id: 1 }] : []));
}

beforeEach(() => reset());

describe('getMySoferStats — szerep + válasz-alak', () => {
  test('nem-sofőr elutasítva', async () => {
    setUser(ADMIN);
    const res = await call('getMySoferStats', []);
    expect(res.body.result.ok).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('sofőr üres adattal — 0-k mindenütt', async () => {
    setUser(SOFER);
    mockChain({
      ord: { lezart: 0, lezart_prev: 0, aktiv: 0 },
      fuvs: [], snaps: []
    });
    const res = await call('getMySoferStats', []);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.lezart).toBe(0);
    expect(res.body.result.lezart_prev).toBe(0);
    expect(res.body.result.km).toBe(0);
    expect(res.body.result.km_prev).toBe(0);
    expect(res.body.result.diurna_ext).toBe(0);
    expect(res.body.result.diurna_ext_prev).toBe(0);
    expect(res.body.result.tankolt_l).toBe(0);
    expect(res.body.result.tankolt_l_prev).toBe(0);
    expect(res.body.result.menetlevelek).toBe(0);
  });
});

describe('getMySoferStats — nem-átívelő menetlevelek', () => {
  test('egy júliusi + egy júniusi menetlevél helyesen szétválasztva', async () => {
    setUser(SOFER);
    mockChain({
      ord: { lezart: 3, lezart_prev: 2, aktiv: 1 },
      fuvs: [
        // Júliusi menetlevél
        { id: 1, numar_camion: 'B111', indulas_dt: '2026-07-05T08:00:00Z',
          erkezes_dt: '2026-07-06T18:00:00Z', data_completare: '2026-07-06',
          km_inceput: 100000, km_sfarsit: 100500, total_km: 500,
          diurna_externa: 50, diurna_interna: 0,
          alimentari: [{ litru: '200' }, { litru: 100 }] },
        // Júniusi menetlevél
        { id: 2, numar_camion: 'B222', indulas_dt: '2026-06-10T08:00:00Z',
          erkezes_dt: '2026-06-11T18:00:00Z', data_completare: '2026-06-11',
          km_inceput: 50000, km_sfarsit: 50300, total_km: 300,
          diurna_externa: 30, diurna_interna: 10,
          alimentari: [{ litru: 150 }] },
      ],
      snaps: []
    });
    const res = await call('getMySoferStats', []);
    expect(res.body.result.ok).toBe(true);
    // Jelen (júl.)
    expect(res.body.result.km).toBe(500);
    expect(res.body.result.diurna_ext).toBe(50);
    expect(res.body.result.diurna_int).toBe(0);
    expect(res.body.result.tankolt_l).toBe(300);
    expect(res.body.result.menetlevelek).toBe(1);
    // Előző (jún.)
    expect(res.body.result.km_prev).toBe(300);
    expect(res.body.result.diurna_ext_prev).toBe(30);
    expect(res.body.result.diurna_int_prev).toBe(10);
    expect(res.body.result.tankolt_l_prev).toBe(150);
  });
});

describe('getMySoferStats — átívelő menetlevél SPLIT snapshot alapján', () => {
  test('jún. 28 → júl. 3 átívelő: km snapshot alapján, diurna+fuel napok szerint arány', async () => {
    setUser(SOFER);
    mockChain({
      ord: { lezart: 5, lezart_prev: 4, aktiv: 2 },
      fuvs: [
        // Átívelő: jún. 28 → júl. 3 (6 nap: 28,29,30 jún + 1,2,3 júl → 3-3 nap)
        // km_inceput=99800, km_sfarsit=100500 → total 700 km
        // Snapshot jún. 30 mileage=100000 → jún. portion = 200 km, júl. portion = 500 km
        { id: 1, numar_camion: 'B 111 ABC', indulas_dt: '2026-06-28T08:00:00Z',
          erkezes_dt: '2026-07-03T18:00:00Z', data_completare: '2026-07-03',
          km_inceput: 99800, km_sfarsit: 100500, total_km: 700,
          diurna_externa: 60, diurna_interna: 0,
          alimentari: [{ litru: 400 }, { litru: 300 }] }, // total 700 L
      ],
      snaps: [{ rendszam: 'b111abc', year: 2026, month: 6, mileage: 100000 }]  // normalizáláson át illeszkedik
    });
    const res = await call('getMySoferStats', []);
    expect(res.body.result.ok).toBe(true);
    // KM: snapshot-alapú
    expect(res.body.result.km).toBe(500);       // jul portion = 100500 - 100000
    expect(res.body.result.km_prev).toBe(200);  // jun portion = 100000 - 99800
    // DIURNA + FUEL: 3/3 napok arányos → fele-fele
    expect(res.body.result.diurna_ext).toBe(30);      // 60 * 3/6
    expect(res.body.result.diurna_ext_prev).toBe(30);
    expect(res.body.result.tankolt_l).toBe(350);       // 700 * 3/6
    expect(res.body.result.tankolt_l_prev).toBe(350);
    // Menetlevél-számláló csak érkezés-hónapban (júl.) számol
    expect(res.body.result.menetlevelek).toBe(1);
  });

  test('átívelő menetlevél snapshot NÉLKÜL: km is arányos a napok szerint', async () => {
    setUser(SOFER);
    mockChain({
      ord: { lezart: 1, lezart_prev: 1, aktiv: 0 },
      fuvs: [
        // Átívelő, snapshot HIÁNYZIK → km-t is napokra arányosan bontjuk
        { id: 1, numar_camion: 'B999', indulas_dt: '2026-06-29T08:00:00Z',
          erkezes_dt: '2026-07-02T18:00:00Z', data_completare: '2026-07-02',
          km_inceput: 100, km_sfarsit: 500, total_km: 400,
          diurna_externa: 40, diurna_interna: 0,
          alimentari: [] },
      ],
      snaps: [] // nincs snapshot
    });
    // 4 nap: 29,30 (jún) + 1,2 (júl) → 2-2 nap → 50-50 %
    const res = await call('getMySoferStats', []);
    expect(res.body.result.km).toBe(200);       // 400 * 2/4
    expect(res.body.result.km_prev).toBe(200);
    expect(res.body.result.diurna_ext).toBe(20);
    expect(res.body.result.diurna_ext_prev).toBe(20);
  });
});

describe('getMySoferStats — PER-TÉTEL DÁTUM az alimentari-nál', () => {
  test('átívelő menetlevél: alimentari tétel-dátum szerint sorolódik (nem napok szerinti arány)', async () => {
    setUser(SOFER);
    mockChain({
      ord: { lezart: 1, lezart_prev: 1, aktiv: 0 },
      fuvs: [
        // Átívelő jún. 28 → júl. 3. Két tankolás: 400 L jún. 29-én, 300 L júl. 2-án.
        // Per-tétel dátum szerint jún = 400, júl = 300 (NEM 350-350 mint a napi arány).
        { id: 1, numar_camion: 'B111', indulas_dt: '2026-06-28T08:00:00Z',
          erkezes_dt: '2026-07-03T18:00:00Z', data_completare: '2026-07-03',
          km_inceput: 99800, km_sfarsit: 100500, total_km: 700,
          diurna_externa: 60, diurna_interna: 0,
          alimentari: [
            { litru: 400, data: '2026-06-29' },
            { litru: 300, data: '2026-07-02' },
          ] },
      ],
      snaps: [{ rendszam: 'B111', year: 2026, month: 6, mileage: 100000 }]
    });
    const res = await call('getMySoferStats', []);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.tankolt_l).toBe(300);       // per-tétel: júl. 2 (300)
    expect(res.body.result.tankolt_l_prev).toBe(400);  // per-tétel: jún. 29 (400)
    // A diurna továbbra is napok szerinti arányos, nem tétel-alapú:
    expect(res.body.result.diurna_ext).toBe(30);
    expect(res.body.result.diurna_ext_prev).toBe(30);
  });

  test('átívelő menetlevél: dátum nélküli tétel a napok szerint fallbackel', async () => {
    setUser(SOFER);
    mockChain({
      ord: { lezart: 1, lezart_prev: 1, aktiv: 0 },
      fuvs: [
        // Átívelő 6 nap (3+3). Egy dátumozott + egy dátum nélküli tétel.
        // Dátumozott 200 L a júliusi napon; dátum nélküli 600 L napok szerint arány (300-300).
        { id: 1, numar_camion: 'B111', indulas_dt: '2026-06-28T08:00:00Z',
          erkezes_dt: '2026-07-03T18:00:00Z', data_completare: '2026-07-03',
          km_inceput: 99800, km_sfarsit: 100500, total_km: 700,
          diurna_externa: 60, diurna_interna: 0,
          alimentari: [
            { litru: 200, data: '2026-07-01' },
            { litru: 600 },   // dátum nélküli (régi menetlevél)
          ] },
      ],
      snaps: []
    });
    const res = await call('getMySoferStats', []);
    // júl = 200 (dátumozott) + 600 * 3/6 (fallback) = 500
    // jún = 0 (dátumozott) + 600 * 3/6 (fallback) = 300
    expect(res.body.result.tankolt_l).toBe(500);
    expect(res.body.result.tankolt_l_prev).toBe(300);
  });

  test('nem-átívelő menetlevél: dátumozott tétel átkerülhet MÁS hónapba', async () => {
    setUser(SOFER);
    mockChain({
      ord: { lezart: 1, lezart_prev: 0, aktiv: 0 },
      fuvs: [
        // Júliusi menetlevél (nem átívelő), de egy tétel jún. 30-i dátummal.
        // Az admin/sofőr utólag beírta a júniusi tankolást — a per-tétel dátum
        // szerint a JÚNIUSI kosárba kerül, NEM a júliusiba.
        { id: 1, numar_camion: 'B111', indulas_dt: '2026-07-05T08:00:00Z',
          erkezes_dt: '2026-07-06T18:00:00Z', data_completare: '2026-07-06',
          km_inceput: 100000, km_sfarsit: 100500, total_km: 500,
          diurna_externa: 40, diurna_interna: 0,
          alimentari: [
            { litru: 150, data: '2026-07-05' },  // júl.
            { litru: 100, data: '2026-06-30' },  // jún. (utólag beírt)
          ] },
      ],
      snaps: []
    });
    const res = await call('getMySoferStats', []);
    expect(res.body.result.tankolt_l).toBe(150);
    expect(res.body.result.tankolt_l_prev).toBe(100);
  });
});

describe('getMySoferStats — külön „teljes hó" (GPS) + „leadott" (menetlevél)', () => {
  test('Peto-eset: nincs júniusi menetlevél, DE két snapshot → km_prev_gps a teljes, km_prev = 0', async () => {
    setUser({ ...SOFER, email: 'peto@example.com' });
    mockChain({
      ord: { lezart: 0, lezart_prev: 0, aktiv: 0 },
      fuvs: [],  // nulla menetlevél
      snaps: [
        // Prev-prev (máj. 31.) + prev (jún. 30.) snapshot ugyanarra a járműre
        { rendszam: 'B104VLR', year: 2026, month: 5, mileage: 567539 },
        { rendszam: 'B104VLR', year: 2026, month: 6, mileage: 578727 },
      ],
      assigned: ['B104VLR']  // sofőr kiosztott járműve
    });
    const res = await call('getMySoferStats', []);
    expect(res.body.result.ok).toBe(true);
    // km_prev (leadott menetlevél): 0 (nincs waybill)
    expect(res.body.result.km_prev).toBe(0);
    // km_prev_gps (teljes hónap): 578727 - 567539 = 11 188
    expect(res.body.result.km_prev_gps).toBe(11188);
  });

  test('menetlevél-alapú km_prev + GPS-delta KETTŐ mezőben ELKÜLÖNÍTVE', async () => {
    setUser(SOFER);
    mockChain({
      ord: { lezart: 3, lezart_prev: 3, aktiv: 0 },
      fuvs: [
        // Júniusi menetlevél 15 000 km-rel — több mint amit a GPS-delta mutat
        { id: 1, numar_camion: 'B104VLR', indulas_dt: '2026-06-05T00:00:00Z',
          erkezes_dt: '2026-06-25T00:00:00Z', data_completare: '2026-06-25',
          km_inceput: 0, km_sfarsit: 0, total_km: 15000,
          diurna_externa: 20, diurna_interna: 0, alimentari: [] },
      ],
      snaps: [
        { rendszam: 'B104VLR', year: 2026, month: 5, mileage: 100000 },
        { rendszam: 'B104VLR', year: 2026, month: 6, mileage: 108000 },  // delta = 8000
      ],
      assigned: ['B104VLR']
    });
    const res = await call('getMySoferStats', []);
    // Külön mezőn: menetlevél 15000, GPS-teljes 8000
    expect(res.body.result.km_prev).toBe(15000);
    expect(res.body.result.km_prev_gps).toBe(8000);
  });

  test('több kiosztott jármű: snapshot deltáik összegződnek a km_prev_gps-ben', async () => {
    setUser({ ...SOFER, email: 'multi@example.com' });
    mockChain({
      ord: { lezart: 0, lezart_prev: 0, aktiv: 0 },
      fuvs: [],
      snaps: [
        { rendszam: 'B111', year: 2026, month: 5, mileage: 1000 },
        { rendszam: 'B111', year: 2026, month: 6, mileage: 6000 },  // delta = 5000
        { rendszam: 'B222', year: 2026, month: 5, mileage: 10000 },
        { rendszam: 'B222', year: 2026, month: 6, mileage: 13000 }, // delta = 3000
      ],
      assigned: ['B111', 'B222']
    });
    const res = await call('getMySoferStats', []);
    expect(res.body.result.km_prev_gps).toBe(8000);  // 5000 + 3000
    expect(res.body.result.km_prev).toBe(0);         // nincs menetlevél
  });

  test('nincs prev-prev snapshot (csak prev-month-end) → km_prev_gps = 0', async () => {
    setUser(SOFER);
    mockChain({
      ord: { lezart: 0, lezart_prev: 0, aktiv: 0 },
      fuvs: [],
      snaps: [
        // Csak a prev (jún.) snapshot, prev-prev (máj.) HIÁNYZIK
        { rendszam: 'B104VLR', year: 2026, month: 6, mileage: 578727 },
      ],
      assigned: ['B104VLR']
    });
    const res = await call('getMySoferStats', []);
    // Delta nem kalkulálható → km_prev_gps = 0
    expect(res.body.result.km_prev_gps).toBe(0);
    expect(res.body.result.km_prev).toBe(0);
  });
});

describe('getMySoferStats — átlagos fogyasztás + figyelmeztetések', () => {
  test('normál tartomány: van menetlevél, avg számítható, nincs warn', async () => {
    setUser(SOFER);
    mockChain({
      ord: { lezart: 5, lezart_prev: 5, aktiv: 0 },
      fuvs: [
        // Menetlevél az előző hóra (jún.)
        { id: 1, numar_camion: 'B111', indulas_dt: '2026-06-01T00:00:00Z',
          erkezes_dt: '2026-06-30T00:00:00Z', data_completare: '2026-06-30',
          km_inceput: 100000, km_sfarsit: 110000, total_km: 10000,
          cant_inceput: 500, cant_sfarsit: 400,
          diurna_externa: 30, diurna_interna: 0,
          alimentari: [{ litru: 3100 }] },
        // Menetlevél a jelen hóra (júl. eddig)
        { id: 2, numar_camion: 'B111', indulas_dt: '2026-07-01T00:00:00Z',
          erkezes_dt: '2026-07-15T00:00:00Z', data_completare: '2026-07-15',
          km_inceput: 110000, km_sfarsit: 115000, total_km: 5000,
          cant_inceput: 400, cant_sfarsit: 350,
          diurna_externa: 15, diurna_interna: 0,
          alimentari: [{ litru: 1450 }] },
      ],
      snaps: [], assigned: []  // menetlevél-fallback módban
    });
    const res = await call('getMySoferStats', []);
    expect(res.body.result.ok).toBe(true);
    // Jún: (500 + 3100 - 400) × 100 / 10000 = 32.0 L/100km — normál
    expect(Math.round(res.body.result.avg_prev * 10) / 10).toBe(32.0);
    // Júl: (400 + 1450 - 350) × 100 / 5000 = 30.0 L/100km — normál
    expect(Math.round(res.body.result.avg_curr * 10) / 10).toBe(30.0);
    expect(res.body.result.warn_range).toBe(false);
    expect(res.body.result.warn_diff).toBe(false);
    expect(res.body.result.manager_warn_diff).toBe(false);
  });

  test('tartományon KÍVÜL érték (Peto-eset): warn_range = true', async () => {
    setUser({ ...SOFER, email: 'peto@example.com' });
    mockChain({
      ord: { lezart: 0, lezart_prev: 0, aktiv: 0 },
      fuvs: [],  // nincs menetlevél
      // GPS snapshotok VAN — máj. 31 tank 710 L km 567539; jún. 30 tank 280 L km 578727
      snaps: [
        { rendszam: 'B104VLR', year: 2026, month: 5, mileage: 567539, fuel_level: 710 },
        { rendszam: 'B104VLR', year: 2026, month: 6, mileage: 578727, fuel_level: 280 },
      ],
      assigned: ['B104VLR']
    });
    // Nincs júniusi menetlevél → tanked = 0
    // fls a fenti prev-hónapos szűrésen nem talál semmit → avg_prev = null
    // A calcAvg üres fls-nél null-t ad → avg_prev = null → warn_range = false
    // Peto valós helyzete: nincs waybill, snapshot van, avg NEM kalkulálható
    // → nem figyelmeztet, csak „—"-t mutat. Ez OK: a warn a rossz értékre való,
    // nem a hiányzó adatra.
    const res = await call('getMySoferStats', []);
    expect(res.body.result.avg_prev).toBeNull();
    expect(res.body.result.warn_range).toBe(false);
  });

  test('nagy hó-közti eltérés (> 4.5): warn_diff = true (sofőr)', async () => {
    setUser(SOFER);
    mockChain({
      ord: { lezart: 3, lezart_prev: 3, aktiv: 0 },
      fuvs: [
        // Jún: 32.0 L/100km
        { id: 1, numar_camion: 'B111', indulas_dt: '2026-06-01T00:00:00Z',
          erkezes_dt: '2026-06-30T00:00:00Z', data_completare: '2026-06-30',
          km_inceput: 100000, km_sfarsit: 110000, total_km: 10000,
          cant_inceput: 500, cant_sfarsit: 400,
          diurna_externa: 30, diurna_interna: 0,
          alimentari: [{ litru: 3100 }] },
        // Júl: 25.0 L/100km — 7.0 eltérés
        { id: 2, numar_camion: 'B111', indulas_dt: '2026-07-01T00:00:00Z',
          erkezes_dt: '2026-07-15T00:00:00Z', data_completare: '2026-07-15',
          km_inceput: 110000, km_sfarsit: 115000, total_km: 5000,
          cant_inceput: 400, cant_sfarsit: 350,
          diurna_externa: 15, diurna_interna: 0,
          alimentari: [{ litru: 1200 }] },  // (400+1200-350)*100/5000 = 25.0
      ],
      snaps: [], assigned: []
    });
    const res = await call('getMySoferStats', []);
    expect(Math.round(res.body.result.avg_prev * 10) / 10).toBe(32.0);
    expect(Math.round(res.body.result.avg_curr * 10) / 10).toBe(25.0);
    // diff = 7.0 → sofőr warn (>4.5) ÉS manager warn (>2.5)
    expect(res.body.result.warn_diff).toBe(true);
    expect(res.body.result.manager_warn_diff).toBe(true);
  });

  test('közepes hó-közti eltérés (>2.5 de ≤4.5): CSAK manager warn', async () => {
    setUser(SOFER);
    mockChain({
      ord: { lezart: 3, lezart_prev: 3, aktiv: 0 },
      fuvs: [
        // Jún: 32.0 L/100km
        { id: 1, numar_camion: 'B111', indulas_dt: '2026-06-01T00:00:00Z',
          erkezes_dt: '2026-06-30T00:00:00Z', data_completare: '2026-06-30',
          km_inceput: 100000, km_sfarsit: 110000, total_km: 10000,
          cant_inceput: 500, cant_sfarsit: 400,
          diurna_externa: 30, diurna_interna: 0,
          alimentari: [{ litru: 3100 }] },
        // Júl: 28.5 L/100km — 3.5 eltérés (jún 32 vs 28.5 = 3.5)
        { id: 2, numar_camion: 'B111', indulas_dt: '2026-07-01T00:00:00Z',
          erkezes_dt: '2026-07-15T00:00:00Z', data_completare: '2026-07-15',
          km_inceput: 110000, km_sfarsit: 115000, total_km: 5000,
          cant_inceput: 400, cant_sfarsit: 350,
          diurna_externa: 15, diurna_interna: 0,
          alimentari: [{ litru: 1375 }] },  // (400+1375-350)*100/5000 = 28.5
      ],
      snaps: [], assigned: []
    });
    const res = await call('getMySoferStats', []);
    // diff = 3.5 → sofőr NEM warn (nem > 4.5), manager warn (> 2.5)
    expect(res.body.result.warn_diff).toBe(false);
    expect(res.body.result.manager_warn_diff).toBe(true);
  });
});

describe('getMySoferStats — vegyes eset', () => {
  test('átívelő + tisztán júliusi menetlevél EGYÜTT', async () => {
    setUser(SOFER);
    mockChain({
      ord: { lezart: 2, lezart_prev: 0, aktiv: 0 },
      fuvs: [
        // Átívelő jún. 28 → júl. 3, km-jel 700 (200 jún + 500 júl a snapshoton át)
        { id: 1, numar_camion: 'B111', indulas_dt: '2026-06-28T08:00:00Z',
          erkezes_dt: '2026-07-03T18:00:00Z', data_completare: '2026-07-03',
          km_inceput: 99800, km_sfarsit: 100500, total_km: 700,
          diurna_externa: 60, diurna_interna: 0,
          alimentari: [{ litru: 700 }] },
        // Tisztán júliusi menetlevél
        { id: 2, numar_camion: 'B111', indulas_dt: '2026-07-05T08:00:00Z',
          erkezes_dt: '2026-07-06T18:00:00Z', data_completare: '2026-07-06',
          km_inceput: 100500, km_sfarsit: 100700, total_km: 200,
          diurna_externa: 20, diurna_interna: 0,
          alimentari: [{ litru: 150 }] },
      ],
      snaps: [{ rendszam: 'B111', year: 2026, month: 6, mileage: 100000 }]
    });
    const res = await call('getMySoferStats', []);
    // Júl. = 500 (átívelő júl. része) + 200 (tiszta júliusi) = 700
    expect(res.body.result.km).toBe(700);
    // Jún. = 200 (átívelő jún. része)
    expect(res.body.result.km_prev).toBe(200);
    // Diurna júl. = 30 (átívelő fele) + 20 (tiszta) = 50; jún. = 30
    expect(res.body.result.diurna_ext).toBe(50);
    expect(res.body.result.diurna_ext_prev).toBe(30);
    // Fuel júl. = 350 (átívelő fele) + 150 = 500; jún. = 350
    expect(res.body.result.tankolt_l).toBe(500);
    expect(res.body.result.tankolt_l_prev).toBe(350);
    // Menetlevél-számláló csak jelen hó (2 érkezik júl.-ban)
    expect(res.body.result.menetlevelek).toBe(2);
  });
});
