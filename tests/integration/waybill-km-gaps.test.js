// ============================================================
//  getWaybillKmGaps — km-folytonosság a menetlevelek között
// ============================================================
//  A sofőr kezdő km-e előtöltődik (GPS vagy előző zárás), de felülírható;
//  ha elgépeli, eddig senki nem szólt. Ez a handler járművenként kigyűjti
//  az adminnak, hol nem folytatja a kezdő km az előző záró km-et.
jest.mock('../../db', () => require('../helpers/db-mock').pool);
const { pool, reset: resetDb } = require('../helpers/db-mock');
const handlers = require('../../handlers/documents');

function call(user, args) {
  return new Promise((resolve) => {
    handlers.getWaybillKmGaps({ session: { user } }, { json: (p) => resolve(p) }, args);
  });
}
const ADMIN = { email: 'a@b.c', pozicio: 'Admin', company_id: 7 };

beforeEach(() => { resetDb(); });

describe('getWaybillKmGaps', () => {
  test('Sofer nem éri el', async () => {
    const r = await call({ ...ADMIN, pozicio: 'Sofer' });
    expect(r.result.ok).toBe(false);
    expect(r.result.err).toBe('Acces interzis');
  });

  test('bejelentkezés nélkül elutasít', async () => {
    const r = await new Promise((res) =>
      handlers.getWaybillKmGaps({ session: {} }, { json: (p) => res(p) }, null));
    expect(r.result.ok).toBe(false);
  });

  test('company_id nélkül üres lista (nem hasal el)', async () => {
    const r = await call({ ...ADMIN, company_id: null });
    expect(r.result).toEqual({ ok: true, gaps: [], count: 0 });
  });

  test('a lekérdezés cégre szűrt és paraméteres', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await call(ADMIN);
    const [sql, params] = pool.query.mock.calls[0];
    expect(params[0]).toBe(7);                       // company_id
    expect(sql).toMatch(/f\.company_id = \$1/);
    expect(sql).not.toMatch(/company_id = 7/);       // nincs string-összefűzés
  });

  test('hiány és átfedés megkülönböztetve', async () => {
    pool.query.mockResolvedValueOnce({ rows: [
      { id: 'W3', numar_fisa: 'MT-3', nume_sofer: 'Peto', email_sofer: 'p@x.hu',
        plate_raw: 'B104VLR', eff_date: '2026-09-10', km_inc: '2340', prev_km_sf: '2000',
        prev_id: 'W2', prev_fisa: 'MT-2', prev_date: '2026-09-05', diff: '340' },
      { id: 'W4', numar_fisa: 'MT-4', nume_sofer: 'Peto', email_sofer: 'p@x.hu',
        plate_raw: 'B104VLR', eff_date: '2026-09-12', km_inc: '2850', prev_km_sf: '2900',
        prev_id: 'W3', prev_fisa: 'MT-3', prev_date: '2026-09-10', diff: '-50' },
    ] });
    const r = await call(ADMIN);
    expect(r.result.ok).toBe(true);
    expect(r.result.count).toBe(2);
    expect(r.result.gaps[0]).toMatchObject({ kind: 'gap', diff: 340, plate: 'B104VLR', prev_fisa: 'MT-2' });
    expect(r.result.gaps[1]).toMatchObject({ kind: 'overlap', diff: -50 });
    // A numerikus mezők SZÁMKÉNT jönnek vissza (a pg stringet ad NUMERIC-re).
    expect(typeof r.result.gaps[0].km_inceput).toBe('number');
    expect(typeof r.result.gaps[0].prev_km_sfarsit).toBe('number');
  });

  test('tűréshatár: alap 1 km, felülírható, korlátos', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    await call(ADMIN);
    expect(pool.query.mock.calls[0][1][1]).toBe(1);          // alap
    resetDb(); pool.query.mockResolvedValue({ rows: [] });
    await call(ADMIN, [{ tolerance_km: 25 }]);
    expect(pool.query.mock.calls[0][1][1]).toBe(25);
    resetDb(); pool.query.mockResolvedValue({ rows: [] });
    await call(ADMIN, [{ tolerance_km: -5 }]);
    expect(pool.query.mock.calls[0][1][1]).toBe(1);          // negatív → alap
    resetDb(); pool.query.mockResolvedValue({ rows: [] });
    await call(ADMIN, [{ tolerance_km: 99999 }]);
    expect(pool.query.mock.calls[0][1][1]).toBe(1000);       // felső korlát
  });

  test('DB-hiba: generikus üzenet, nincs stack-szivárgás', async () => {
    pool.query.mockRejectedValueOnce(new Error('relation "fuvarlevelek" does not exist'));
    const r = await call(ADMIN);
    expect(r.result.ok).toBe(false);
    expect(r.result.err).toBe('Eroare de server');
  });

  test('a rendszám normalizálva párosít (B 104 VLR ≡ B104VLR)', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await call(ADMIN);
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toMatch(/REGEXP_REPLACE\(COALESCE\(f\.numar_camion,''\), '\[\^A-Za-z0-9\]', '', 'g'\)/);
    expect(sql).toMatch(/PARTITION BY plate ORDER BY eff_date/);
  });
});
