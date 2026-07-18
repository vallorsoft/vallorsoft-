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

// Segéd: felállítja a 4 alap-lekérdezést (orders, fuvarlevelek, hónap-határok, snapshotok).
// Az fuvarlevelek + snapshots két utolsó paraméterrel testre szabhatók.
function mockChain({ ord, fuvs, snaps, mCurr = '2026-07-01T00:00:00Z', mPrev = '2026-06-01T00:00:00Z' }) {
  pool.query
    .mockResolvedValueOnce(rows([ord]))
    .mockResolvedValueOnce(rows(fuvs || []))
    .mockResolvedValueOnce(rows([{ m_curr: mCurr, m_prev: mPrev }]))
    .mockResolvedValueOnce(rows(snaps || []));
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
      snaps: [{ rendszam: 'b111abc', mileage: 100000 }]  // normalizáláson át illeszkedik
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
      snaps: [{ rendszam: 'B111', mileage: 100000 }]
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
