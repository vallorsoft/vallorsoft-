// ============================================================
//  Unit-teszt: getMySoferOrders waybill_visible per-stop logika
//  (a Peto-eset — Finalizat + felrakó menetlevélen, lerakó nem →
//  fuvar MARAD a menetlevél-pickerben, amíg minden stop waybilled).
// ============================================================
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://x@x/x';
jest.mock('../../db', () => ({ query: jest.fn() }));
const pool = require('../../db');
const handlers = require('../../handlers/orders');

const SESSION = { user: { company_id: 42, email: 'sofer@x.ro', pozicio: 'Sofer' } };

function mockRes() {
  return { body: null, json(x) { this.body = x; return this; } };
}

describe('getMySoferOrders — waybill_visible per-stop', () => {
  beforeEach(() => { pool.query.mockReset(); });

  test('SQL a stops LATERAL JOIN-nal fut + wb_open_pickup/wb_open_delivery mezőket ad', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = mockRes();
    await handlers.getMySoferOrders({ session: SESSION }, res, []);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/LEFT JOIN LATERAL[\s\S]*FROM order_stops s/);
    expect(sql).toMatch(/wb_open_pickup/);
    expect(sql).toMatch(/wb_open_delivery/);
    expect(sql).toMatch(/stops_json/);
    expect(params).toEqual([42, 'sofer@x.ro']);
  });

  test('szerep nincs bejelentkezve → üres', async () => {
    const res = mockRes();
    await handlers.getMySoferOrders({ session: {} }, res, []);
    expect(res.body).toEqual({ result: [] });
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('DB-hiba → üres válasz, nincs stack-szivárgás', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'));
    const res = mockRes();
    await handlers.getMySoferOrders({ session: SESSION }, res, []);
    expect(res.body).toEqual({ result: [] });
  });
});
