// Regresszió-őr: vcalcPrefillFromOrder — a régi kód a NEM létező `vehicles.active`
// oszlopot használta ("column active does not exist") → az egész prefill „Eroare de
// server"-t adott, a UI-n a „Vallorsoft-fuvar" mód betöltése hasalt el. A fix az
// `activ` (RO) oszlopnév + try/catch fallback.

const pool = require('../../db');
jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../services/bnr', () => ({ fetchBnrEurRon: jest.fn().mockResolvedValue(null) }), { virtual: true });

const handlers = require('../../handlers/costCalculator');

function mockReq() {
  return { session: { user: { company_id: 42, pozicio: 'Admin' } }, ip: '127.0.0.1' };
}
function mockRes() {
  const r = { json: jest.fn(v => v), status: jest.fn().mockReturnThis() };
  return r;
}

describe('vcalcPrefillFromOrder — regresszió-őr a vehicles.activ oszlopnévre', () => {
  beforeEach(() => pool.query.mockReset());

  test('sikeres prefill — az active-trucks SELECT `activ` oszlopot használ', async () => {
    // 1) orders SELECT
    pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [{
      id: 'CMD-1', client: 'X', ref: 'R', loc_incarcare: 'A', loc_descarcare: 'B',
      data_incarcare: '2026-09-01', data_descarcare: '2026-09-03',
      pret: 1000, km: 500, email_sofer: null, rendszam_camion: null, rendszam_remorca: null,
      toll_cost: null,
    }] });
    // 2) _vehicleByPlate(camion) — null plate → nem hívja a pool-t; SKIP
    // 3) _vehicleByPlate(remorca) — null plate → SKIP
    // 4) _driverByEmail(email) — null email → SKIP
    // 5) active-trucks SELECT — `activ` oszlop
    pool.query.mockResolvedValueOnce({ rows: [{ n: 3 }] });
    // 6) companies BNR
    pool.query.mockResolvedValueOnce({ rows: [{ eur_ron_rate: 5.2 }] });

    const req = mockReq(), res = mockRes();
    await handlers.vcalcPrefillFromOrder(req, res, [{ order_id: 'CMD-1' }]);

    const call = res.json.mock.calls[0][0];
    expect(call.result.ok).toBe(true);
    expect(call.result.active_trucks).toBe(3);
    expect(call.result.trip_days).toBe(3);
    expect(call.result.bnr_eur_lei).toBe(5.2);

    // A vehicles-SELECT `activ` oszlopot használt, NEM `active`-ot
    const vehSql = pool.query.mock.calls.find(c => /FROM vehicles/i.test(c[0]));
    expect(vehSql[0]).toMatch(/activ/);
    expect(vehSql[0]).not.toMatch(/\bactive\b/);
  });

  test('active-trucks SELECT dobás → fallback 1 (a prefill nem hasal el)', async () => {
    pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [{
      id: 'CMD-2', client: 'Y', ref: '', loc_incarcare: '', loc_descarcare: '',
      data_incarcare: null, data_descarcare: null,
      pret: null, km: null, email_sofer: null, rendszam_camion: null, rendszam_remorca: null,
      toll_cost: null,
    }] });
    // active-trucks SELECT — DOB (pl. régi DB-n `activ` sem létezik)
    pool.query.mockRejectedValueOnce(new Error('column "activ" does not exist'));
    // BNR fallback
    pool.query.mockResolvedValueOnce({ rows: [] });

    const req = mockReq(), res = mockRes();
    await handlers.vcalcPrefillFromOrder(req, res, [{ order_id: 'CMD-2' }]);

    const call = res.json.mock.calls[0][0];
    expect(call.result.ok).toBe(true);
    expect(call.result.active_trucks).toBe(1);
    expect(call.result.bnr_eur_lei).toBe(5.0);
  });

  test('ismeretlen order → „Cursă necunoscută"', async () => {
    pool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const req = mockReq(), res = mockRes();
    await handlers.vcalcPrefillFromOrder(req, res, [{ order_id: 'CMD-999' }]);
    expect(res.json.mock.calls[0][0].result).toEqual({ ok: false, err: 'Cursă necunoscută' });
  });

  test('Sofer szerep → tiltva', async () => {
    const req = { session: { user: { company_id: 42, pozicio: 'Sofer' } } };
    const res = mockRes();
    await handlers.vcalcPrefillFromOrder(req, res, [{ order_id: 'CMD-1' }]);
    expect(res.json.mock.calls[0][0].result).toEqual({ ok: false, err: 'Acces interzis' });
  });
});
