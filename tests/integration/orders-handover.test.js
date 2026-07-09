// ============================================================
//  Orders (comCreate rész, addOrderLeg, deleteOrderLeg, getOrderById,
//  getTrackingLink) + Handover (orderHandover, driverHandoverRequest,
//  confirmHandover, rejectHandover, getPendingHandovers,
//  getWarehouseItems)
//
//  A push (services/push.js) és a pushTemplates (lib/pushTemplates.js)
//  MOCKOLVA — nem próbál valós Firebase kulcsot használni.
// ============================================================
jest.mock('../../db', () => require('../helpers/db-mock').pool);
jest.mock('../../services/push', () => ({
  sendPushToRole: jest.fn(async () => ({ sent: 0 })),
  sendPushToEmail: jest.fn(async () => ({ sent: 0 })),
  sendPushToUser: jest.fn(async () => ({ sent: 0 })),
}));
jest.mock('../../lib/pushTemplates', () => ({
  getTemplate: jest.fn(async () => ({ title_ro: 'T', title_hu: 'T', body_ro: 'B', body_hu: 'B' })),
  applyVars: (s, vars) => Object.keys(vars || {}).reduce((acc, k) => acc.replace('{{' + k + '}}', vars[k]), String(s)),
}));

const request = require('supertest');
const express = require('express');
const { pool, rows, reset } = require('../helpers/db-mock');
const { setUser, sessionMiddleware, fixtures } = require('../helpers/session-mock');

// pool.connect() a comCreate + applyHandover-hez — a client query-je a fő
// pool.query-re irányul (nincs külön mockolás, ugyanaz az FIFO stream).
const dbMock = require('../helpers/db-mock');
dbMock.pool.connect = jest.fn(() => Promise.resolve({
  query: (...a) => dbMock.pool.query(...a),
  release: () => {},
}));

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

beforeEach(() => reset());

// ═══ getOrderById ════════════════════════════════════════════
describe('getOrderById', () => {
  test('nem-Admin visszaad null', async () => {
    setUser(SOFER);
    const res = await call('getOrderById', ['CMD-1']);
    expect(res.body.result).toBeNull();
    expect(res.body.legs).toEqual([]);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('nem lét — result:null, legs:[]', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([]));
    const res = await call('getOrderById', ['CMD-X']);
    expect(res.body.result).toBeNull();
    // Nincs 2. hívás, mert az order nem lét
    expect(pool.query).toHaveBeenCalledTimes(1);
    // company_id-szűrt SELECT
    const [sql, params] = pool.query.mock.calls[0];
    expect(String(sql)).toMatch(/FROM orders WHERE id.*company_id/is);
    expect(params).toEqual(['CMD-X', CID]);
  });

  test('sikeres lekérés — order + legs', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([{ id: 'CMD-1', client: 'X', status: 'Alocat' }]))
      .mockResolvedValueOnce(rows([{ leg_number: 1 }, { leg_number: 2 }]));
    const res = await call('getOrderById', ['CMD-1']);
    expect(res.body.result.id).toBe('CMD-1');
    expect(res.body.legs).toHaveLength(2);
  });
});

// ═══ addOrderLeg ═════════════════════════════════════════════
describe('addOrderLeg', () => {
  test('orderId nélkül', async () => {
    setUser(ADMIN);
    const res = await call('addOrderLeg', ['', {}]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/transportului/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('idegen cég fuvarja → elutasít, semmi INSERT', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([])); // orders ownership üres
    const res = await call('addOrderLeg', ['CMD-B-CEG', { sofer_type: 'Intern' }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/gasit/i);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test('sikeres leg-felvétel — leg_number MAX+1', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([{ id: 'CMD-1' }])) // ownership OK
      .mockResolvedValueOnce(rows([{ next_num: 3 }])) // MAX+1
      .mockResolvedValueOnce({ rowCount: 1 })          // INSERT
      .mockResolvedValueOnce(rows([{ email_sofer: 'x@x.hu', nume_sofer: 'X' }])) // syncOrderTop... SELECT
      .mockResolvedValueOnce({ rowCount: 1 });         // syncOrderTop... UPDATE
    const res = await call('addOrderLeg', ['CMD-1', {
      sofer_type: 'Intern', email_sofer: 'sofer@ceg.hu',
      rendszam_camion: 'b123', rendszam_remorca: 'b999',
    }]);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.leg_number).toBe(3);
    // Rendszám uppercase
    const insertParams = pool.query.mock.calls[2][1];
    expect(insertParams[6]).toBe('B123');
    expect(insertParams[7]).toBe('B999');
  });
});

// ═══ deleteOrderLeg ══════════════════════════════════════════
describe('deleteOrderLeg', () => {
  test('ID nélkül elutasít', async () => {
    setUser(ADMIN);
    const res = await call('deleteOrderLeg', [null]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/tronsonului/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('nem lét vagy idegen cég → elutasít', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await call('deleteOrderLeg', [999]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/gasit|acces/i);
  });

  test('sikeres törlés — cross-tenant védett JOIN', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce({ rows: [{ order_id: 'CMD-1' }], rowCount: 1 })
      .mockResolvedValueOnce(rows([{ email_sofer: 'x@x.hu' }])) // syncOrderTop... SELECT
      .mockResolvedValueOnce({ rowCount: 1 });         // syncOrderTop... UPDATE
    const res = await call('deleteOrderLeg', [5]);
    expect(res.body.result.ok).toBe(true);
    const [sql] = pool.query.mock.calls[0];
    expect(String(sql)).toMatch(/DELETE FROM order_legs.*USING orders.*company_id/is);
  });
});

// ═══ getTrackingLink ═════════════════════════════════════════
describe('getTrackingLink', () => {
  test('tracking KIKAPCSOLVA a cégnél → elutasít', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([{ enabled: false }]));
    const res = await call('getTrackingLink', ['CMD-1']);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/urmarire|nu este abonat/i);
    // Nem futott le a 2. lekérdezés (SELECT orders)
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test('nem lét (feature ON) — „nu a fost gasit"', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([])) // feature-flag lookup üres = ON
      .mockResolvedValueOnce(rows([])); // orders üres
    const res = await call('getTrackingLink', ['CMD-X']);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/gasit/i);
  });

  test('meglévő token újrafelhasználva', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([])) // feature ON
      .mockResolvedValueOnce(rows([{ id: 'CMD-1', tracking_token: 'existing-token-hex' }]));
    const res = await call('getTrackingLink', ['CMD-1']);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.token).toBe('existing-token-hex');
    // Nincs 3. UPDATE — a meglévő tokent visszaadta
    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  test('nincs token → generál + tárol', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([])) // feature ON
      .mockResolvedValueOnce(rows([{ id: 'CMD-1', tracking_token: null }]))
      .mockResolvedValueOnce({ rowCount: 1 }); // UPDATE
    const res = await call('getTrackingLink', ['CMD-1']);
    expect(res.body.result.ok).toBe(true);
    expect(typeof res.body.result.token).toBe('string');
    expect(res.body.result.token.length).toBeGreaterThan(20); // 16 byte hex = 32 char
  });
});

// ═══ HANDOVER — Admin orderHandover ══════════════════════════
describe('orderHandover (Admin/Manager azonnali leadás)', () => {
  test('type nélkül', async () => {
    setUser(ADMIN);
    const res = await call('orderHandover', ['CMD-1', { location: 'X' }]);
    expect(res.body.result.err).toMatch(/parcheaza|intra in depozit/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('location nélkül', async () => {
    setUser(ADMIN);
    const res = await call('orderHandover', ['CMD-1', { type: 'trailer' }]);
    expect(res.body.result.err).toMatch(/Locul predarii/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('warehouse típusnál a méret+súly+lapszám kötelező', async () => {
    setUser(ADMIN);
    const res = await call('orderHandover', ['CMD-1', {
      type: 'warehouse', location: 'Cluj',
    }]);
    expect(res.body.result.err).toMatch(/bucati/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('Finalizat fuvar nem adható le', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([{ id: 'CMD-1', status: 'Finalizat' }]));
    const res = await call('orderHandover', ['CMD-1', {
      type: 'trailer', location: 'Cluj',
    }]);
    expect(res.body.result.err).toMatch(/inchis|sters/i);
  });

  test('sikeres trailer leadás → status:Parkolt', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([{ id: 'CMD-1', status: 'Alocat' }])) // orders SELECT
      .mockResolvedValueOnce({ rowCount: 1 })                            // BEGIN
      .mockResolvedValueOnce({ rowCount: 1 })                            // UPDATE orders
      .mockResolvedValueOnce({ rowCount: 1 });                           // COMMIT
    const res = await call('orderHandover', ['CMD-1', {
      type: 'trailer', location: 'Cluj', rendszam_remorca: 'B999',
    }]);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.status).toBe('Parkolt');
  });
});

// ═══ HANDOVER — Sofer driverHandoverRequest ══════════════════
describe('driverHandoverRequest (Sofer kérés)', () => {
  test('Admin NEM hívhatja (csak sofőr)', async () => {
    setUser(ADMIN);
    const res = await call('driverHandoverRequest', ['CMD-1', {
      type: 'trailer', location: 'X',
    }]);
    expect(res.body.result.err).toMatch(/interzis/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('type nélkül', async () => {
    setUser(SOFER);
    const res = await call('driverHandoverRequest', ['CMD-1', {}]);
    expect(res.body.result.err).toMatch(/Specifica/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('nem a saját fuvarja (rowCount=0)', async () => {
    setUser(SOFER);
    pool.query.mockResolvedValueOnce({ rowCount: 0 });
    const res = await call('driverHandoverRequest', ['CMD-1', {
      type: 'trailer', location: 'Cluj',
    }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/al tau|activ/i);
  });

  test('sikeres kérés — Fuggoben-re állítja + push best-effort', async () => {
    setUser({ ...SOFER, email: 'sofer1@ceg.hu' });
    pool.query.mockResolvedValueOnce({ rowCount: 1 });
    const res = await call('driverHandoverRequest', ['CMD-1', {
      type: 'warehouse', location: 'Depozit',
    }]);
    expect(res.body.result.ok).toBe(true);
    const [sql] = pool.query.mock.calls[0];
    expect(String(sql)).toMatch(/UPDATE orders SET.*handover_status = 'Fuggoben'/is);
  });
});

// ═══ HANDOVER — Admin confirmHandover ════════════════════════
describe('confirmHandover (Admin visszaigazolás)', () => {
  test('nem lét', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([]));
    const res = await call('confirmHandover', ['CMD-X', {}]);
    expect(res.body.result.err).toMatch(/gasit/i);
  });

  test('nincs várakozó kérés', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([{
      id: 'CMD-1', status: 'Alocat', handover_status: null,
      handover_payload: null,
    }]));
    const res = await call('confirmHandover', ['CMD-1', {}]);
    expect(res.body.result.err).toMatch(/cerere de predare/i);
  });

  test('időközben lezárt fuvar → elutasít', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([{
      id: 'CMD-1', status: 'Finalizat', handover_status: 'Fuggoben',
      handover_payload: '{"type":"trailer","location":"X"}',
    }]));
    const res = await call('confirmHandover', ['CMD-1', {}]);
    expect(res.body.result.err).toMatch(/inchis intre timp/i);
  });
});

// ═══ HANDOVER — Admin rejectHandover ═════════════════════════
describe('rejectHandover (Admin elutasítás)', () => {
  test('nincs várakozó kérés', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await call('rejectHandover', ['CMD-X']);
    expect(res.body.result.err).toMatch(/nu exista cerere/i);
  });

  test('sikeres elutasítás + push best-effort', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce({
      rows: [{ handover_by: 'sofer@ceg.hu' }], rowCount: 1,
    });
    const res = await call('rejectHandover', ['CMD-1']);
    expect(res.body.result.ok).toBe(true);
    const [sql, params] = pool.query.mock.calls[0];
    expect(String(sql)).toMatch(/UPDATE orders SET.*handover_status = NULL.*Fuggoben/is);
    expect(params).toEqual(['CMD-1', CID]);
  });
});

// ═══ getPendingHandovers ═════════════════════════════════════
describe('getPendingHandovers', () => {
  test('Sofer NEM látja (üres tömb)', async () => {
    setUser(SOFER);
    const res = await call('getPendingHandovers', []);
    expect(res.body.result).toEqual([]);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('Admin: Fuggoben-es fuvarok listája', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([
      { id: 'CMD-1', handover_type: 'trailer', handover_loc: 'Cluj' },
    ]));
    const res = await call('getPendingHandovers', []);
    expect(res.body.result).toHaveLength(1);
    const [sql, params] = pool.query.mock.calls[0];
    expect(String(sql)).toMatch(/handover_status = 'Fuggoben'/i);
    expect(params).toEqual([CID]);
  });
});

// ═══ getWarehouseItems ═══════════════════════════════════════
describe('getWarehouseItems', () => {
  test('feature KIKAPCSOLVA → üres tömb', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([{ enabled: false }]));
    const res = await call('getWarehouseItems', []);
    expect(res.body.result).toEqual([]);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test('feature ON (üres sor) — tétel-lista lekérdezve', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([])) // feature ON (üres = engedélyezett)
      .mockResolvedValueOnce(rows([
        { order_id: 'CMD-1', status: 'Raktarban', location: 'Depozit Cluj', doc_count: 2 },
      ]));
    const res = await call('getWarehouseItems', []);
    expect(res.body.result).toHaveLength(1);
    expect(res.body.result[0].status).toBe('Raktarban');
  });
});
