// ============================================================
//  getSoferConsumptionOverview — cross-sofőr fogyasztás-
//  összehasonlítás. Csak Admin/Manager hívhatja; sofőrök tiltva.
//  Minden belső sofőrre kiszámolja az e havi + előző havi
//  átlagfogyasztást (L/100km), majd a cég-átlagot + eltérést.
//  A > 2.5 L/100km eltérésű sofőrök `deviates: true`-t kapnak.
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
const ADMIN = { ...fixtures.admin, company_id: CID };
const MANAGER = { ...fixtures.manager, company_id: CID };
const SOFER = { ...fixtures.sofer, company_id: CID };

// Segéd: felállítja a 4 alap-lekérdezést (hónap-határok, sofőrök,
// menetlevelek, snapshotok, kiosztott járművek).
function mockChain({ sofers, fuvs, snaps, assigned, mCurr = '2026-07-01T00:00:00Z', mPrev = '2026-06-01T00:00:00Z' }) {
  pool.query
    .mockResolvedValueOnce(rows([{ m_curr: mCurr, m_prev: mPrev }]))
    .mockResolvedValueOnce(rows(sofers || []))
    .mockResolvedValueOnce(rows(fuvs || []))
    .mockResolvedValueOnce(rows(snaps || []))
    .mockResolvedValueOnce(rows(assigned || []));
}

beforeEach(() => reset());

describe('getSoferConsumptionOverview — szerep-kapu', () => {
  test('Sofer NEM hívhatja', async () => {
    setUser(SOFER);
    const res = await call('getSoferConsumptionOverview', []);
    expect(res.body.result.ok).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('Admin hívhatja', async () => {
    setUser(ADMIN);
    mockChain({ sofers: [], fuvs: [], snaps: [], assigned: [] });
    const res = await call('getSoferConsumptionOverview', []);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.sofers).toEqual([]);
    // Sofőrök nélkül csak a hónap-határ + users query fut (2 hívás)
  });

  test('Manager hívhatja', async () => {
    setUser(MANAGER);
    mockChain({ sofers: [], fuvs: [], snaps: [], assigned: [] });
    const res = await call('getSoferConsumptionOverview', []);
    expect(res.body.result.ok).toBe(true);
  });
});

describe('getSoferConsumptionOverview — cross-sofőr összehasonlítás', () => {
  test('két sofőr eltérő átlagfogyasztással → cég-átlag + deviates flag helyes', async () => {
    setUser(ADMIN);
    mockChain({
      sofers: [
        { id: 100, email: 'a@ceg.hu', nume: 'Alma' },
        { id: 101, email: 'b@ceg.hu', nume: 'Béla' },
      ],
      fuvs: [
        // Alma júl. menetlevél: (400+1500-350)*100/5000 = 31.0 L/100km
        { id: 1, email_sofer: 'a@ceg.hu', numar_camion: 'B111',
          indulas_dt: '2026-07-01T00:00:00Z', erkezes_dt: '2026-07-15T00:00:00Z',
          data_completare: '2026-07-15', km_inceput: 100000, km_sfarsit: 105000,
          cant_inceput: 400, cant_sfarsit: 350,
          alimentari: [{ litru: 1500 }] },
        // Béla júl. menetlevél: (400+1300-350)*100/5000 = 27.0 L/100km
        { id: 2, email_sofer: 'b@ceg.hu', numar_camion: 'B222',
          indulas_dt: '2026-07-01T00:00:00Z', erkezes_dt: '2026-07-15T00:00:00Z',
          data_completare: '2026-07-15', km_inceput: 200000, km_sfarsit: 205000,
          cant_inceput: 400, cant_sfarsit: 350,
          alimentari: [{ litru: 1300 }] },
      ],
      snaps: [], assigned: []
    });
    const res = await call('getSoferConsumptionOverview', []);
    expect(res.body.result.ok).toBe(true);
    const sofs = res.body.result.sofers;
    expect(sofs.length).toBe(2);
    // Cég-átlag = (31 + 27) / 2 = 29
    expect(Math.round(res.body.result.company_avg * 10) / 10).toBe(29);
    // Alma eltérés = |31 - 29| = 2 → nem deviates (< 2.5)
    // Béla eltérés = |27 - 29| = 2 → nem deviates
    const alma = sofs.find((s) => s.email === 'a@ceg.hu');
    const bela = sofs.find((s) => s.email === 'b@ceg.hu');
    expect(alma.deviates).toBe(false);
    expect(bela.deviates).toBe(false);
    expect(res.body.result.threshold).toBe(2.5);
  });

  test('km_curr / km_prev = menetlevelek total_km összege érkezés-hó horgony szerint', async () => {
    setUser(ADMIN);
    mockChain({
      sofers: [{ id: 100, email: 'a@ceg.hu', nume: 'Alma' }],
      fuvs: [
        // Múlt hó (jún.): 2 menetlevél összesen 3200 km
        { id: 1, email_sofer: 'a@ceg.hu', numar_camion: 'B111',
          indulas_dt: '2026-06-05T00:00:00Z', erkezes_dt: '2026-06-10T00:00:00Z',
          data_completare: '2026-06-10', total_km: 1500 },
        { id: 2, email_sofer: 'a@ceg.hu', numar_camion: 'B111',
          indulas_dt: '2026-06-15T00:00:00Z', erkezes_dt: '2026-06-20T00:00:00Z',
          data_completare: '2026-06-20', total_km: 1700 },
        // Jelen hó (júl.): 1 menetlevél 800 km
        { id: 3, email_sofer: 'a@ceg.hu', numar_camion: 'B111',
          indulas_dt: '2026-07-01T00:00:00Z', erkezes_dt: '2026-07-05T00:00:00Z',
          data_completare: '2026-07-05', total_km: 800 },
      ],
      snaps: [], assigned: []
    });
    const res = await call('getSoferConsumptionOverview', []);
    expect(res.body.result.ok).toBe(true);
    const alma = res.body.result.sofers.find((s) => s.email === 'a@ceg.hu');
    expect(alma.km_curr).toBe(800);
    expect(alma.km_prev).toBe(3200);
    expect(alma.km_prev_gps).toBe(0); // nincs snapshot / kiosztott jármű
  });

  test('km_prev_gps = kiosztott járművek prev / prev-prev hó-vég snapshot deltájának összege', async () => {
    setUser(ADMIN);
    mockChain({
      sofers: [{ id: 100, email: 'a@ceg.hu', nume: 'Alma' }],
      fuvs: [],
      snaps: [
        // prev-prev = 2026-05 → 100000 mileage a B111-en
        { rendszam: 'B111', year: 2026, month: 5, mileage: 100000, fuel_level: 400 },
        // prev = 2026-06 → 111188 mileage a B111-en → delta 11188
        { rendszam: 'B111', year: 2026, month: 6, mileage: 111188, fuel_level: 380 },
        // CJ36VSN: 50000 → 55000 → delta 5000
        { rendszam: 'CJ36VSN', year: 2026, month: 5, mileage: 50000, fuel_level: 300 },
        { rendszam: 'CJ36VSN', year: 2026, month: 6, mileage: 55000, fuel_level: 280 },
      ],
      assigned: [
        { email: 'a@ceg.hu', rendszam: 'B 111' },       // normalizálva B111
        { email: 'a@ceg.hu', rendszam: 'cj-36-vsn' },   // normalizálva CJ36VSN
      ]
    });
    const res = await call('getSoferConsumptionOverview', []);
    expect(res.body.result.ok).toBe(true);
    const alma = res.body.result.sofers.find((s) => s.email === 'a@ceg.hu');
    // 11188 + 5000 = 16188
    expect(alma.km_prev_gps).toBe(16188);
    // Nincs menetlevél → km_curr/km_prev = 0
    expect(alma.km_curr).toBe(0);
    expect(alma.km_prev).toBe(0);
  });

  test('km_prev_gps = 0 ha csak az egyik snapshot van meg (nincs delta)', async () => {
    setUser(ADMIN);
    mockChain({
      sofers: [{ id: 100, email: 'a@ceg.hu', nume: 'Alma' }],
      fuvs: [],
      snaps: [
        // Csak a prev van, prev-prev hiányzik
        { rendszam: 'B111', year: 2026, month: 6, mileage: 111188, fuel_level: 380 },
      ],
      assigned: [{ email: 'a@ceg.hu', rendszam: 'B111' }]
    });
    const res = await call('getSoferConsumptionOverview', []);
    expect(res.body.result.ok).toBe(true);
    const alma = res.body.result.sofers.find((s) => s.email === 'a@ceg.hu');
    expect(alma.km_prev_gps).toBe(0);
  });

  test('egy sofőr NAGY eltérése → deviates=true, kiemelten elöl a rendezésben', async () => {
    setUser(ADMIN);
    mockChain({
      sofers: [
        { id: 100, email: 'jo@ceg.hu', nume: 'Jó' },
        { id: 101, email: 'ki@ceg.hu', nume: 'Kilógó' },
      ],
      fuvs: [
        // Jó: 30.0 L/100km
        { id: 1, email_sofer: 'jo@ceg.hu', numar_camion: 'B111',
          indulas_dt: '2026-07-01T00:00:00Z', erkezes_dt: '2026-07-15T00:00:00Z',
          data_completare: '2026-07-15', km_inceput: 100000, km_sfarsit: 105000,
          cant_inceput: 400, cant_sfarsit: 350,
          alimentari: [{ litru: 1450 }] },  // (400+1450-350)*100/5000 = 30.0
        // Kilógó: 40.0 L/100km — messze eltér
        { id: 2, email_sofer: 'ki@ceg.hu', numar_camion: 'B222',
          indulas_dt: '2026-07-01T00:00:00Z', erkezes_dt: '2026-07-15T00:00:00Z',
          data_completare: '2026-07-15', km_inceput: 200000, km_sfarsit: 205000,
          cant_inceput: 400, cant_sfarsit: 350,
          alimentari: [{ litru: 1950 }] },  // (400+1950-350)*100/5000 = 40.0
      ],
      snaps: [], assigned: []
    });
    const res = await call('getSoferConsumptionOverview', []);
    expect(res.body.result.ok).toBe(true);
    // Cég-átlag = 35, Jó eltérés = 5, Kilógó eltérés = 5 → mindkettő deviates
    expect(Math.round(res.body.result.company_avg)).toBe(35);
    const sofs = res.body.result.sofers;
    // Rendezés: legnagyobb eltérésű elöl (mind a kettő 5)
    expect(sofs[0].deviates).toBe(true);
    expect(sofs[1].deviates).toBe(true);
  });
});
