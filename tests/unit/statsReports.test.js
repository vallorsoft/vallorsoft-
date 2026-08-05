// ============================================================
//  Unit-teszt — handlers/statsReports.js
//  A CRUD kapuk + input-validáció + tenant-védelem mock DB-vel.
// ============================================================
jest.mock('../../db', () => require('../helpers/db-mock').pool);
jest.mock('../../lib/audit', () => ({ fromReq: async () => {} }));

const { pool, rows, reset } = require('../helpers/db-mock');
const H = require('../../handlers/statsReports');

function call(fn, user, args) {
  return new Promise((resolve) => {
    const req = { session: { user } };
    const res = { json: (payload) => resolve(payload) };
    fn(req, res, args);
  });
}

const ADMIN   = { id: 1, email: 'a@x', pozicio: 'Admin',   company_id: 1 };
const MANAGER = { id: 2, email: 'm@x', pozicio: 'Manager', company_id: 1 };
const SOFER   = { id: 3, email: 's@x', pozicio: 'Sofer',   company_id: 1 };

beforeEach(() => reset());

describe('statsReportScheduleList', () => {
  test('Sofer tiltva', async () => {
    const r = await call(H.statsReportScheduleList, SOFER);
    expect(r.result.ok).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('Manager listáz — company_id-szűrt', async () => {
    pool.query.mockResolvedValueOnce(rows([
      { id: 5, name: 'Havi', schedule: 'monthly', recipients: ['a@x'], enabled: true, last_run_at: null, view_id: null, user_id: 1, view_name: null, created_at: new Date(), updated_at: new Date() },
    ]));
    const r = await call(H.statsReportScheduleList, MANAGER);
    expect(r.result.ok).toBe(true);
    expect(r.result.schedules).toHaveLength(1);
    expect(pool.query.mock.calls[0][1]).toEqual([1]);
  });
});

describe('statsReportScheduleSave — create', () => {
  test('Manager nem hozhat létre (Admin only)', async () => {
    const r = await call(H.statsReportScheduleSave, MANAGER, [{ name: 'x', schedule: 'monthly', recipients: ['a@x'], enabled: true }]);
    expect(r.result.ok).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('üres név → hiba', async () => {
    const r = await call(H.statsReportScheduleSave, ADMIN, [{ name: '', schedule: 'monthly', recipients: ['a@x'] }]);
    expect(r.result.ok).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('érvénytelen frekvencia → hiba', async () => {
    const r = await call(H.statsReportScheduleSave, ADMIN, [{ name: 'x', schedule: 'nope', recipients: ['a@x'] }]);
    expect(r.result.ok).toBe(false);
  });

  test('címzett nélkül → hiba', async () => {
    const r = await call(H.statsReportScheduleSave, ADMIN, [{ name: 'x', schedule: 'monthly', recipients: [] }]);
    expect(r.result.ok).toBe(false);
    const r2 = await call(H.statsReportScheduleSave, ADMIN, [{ name: 'x', schedule: 'monthly', recipients: ['nem-email'] }]);
    expect(r2.result.ok).toBe(false);
  });

  test('sikeres létrehozás', async () => {
    pool.query.mockResolvedValueOnce(rows([{ id: 42 }]));
    const r = await call(H.statsReportScheduleSave, ADMIN, [{
      name: 'Havi vezetőségi', schedule: 'monthly',
      recipients: 'a@x.com, b@y.com',    // string is elfogadott, split-elődik
      enabled: true,
    }]);
    expect(r.result.ok).toBe(true);
    expect(r.result.id).toBe(42);
    const params = pool.query.mock.calls[0][1];
    expect(params[0]).toBe(1);     // company_id
    // recipients JSON-array 2 e-mail
    const recJson = JSON.parse(params[5]);
    expect(recJson).toEqual(['a@x.com', 'b@y.com']);
    expect(params[6]).toBe(true);  // enabled
  });

  test('cross-tenant view_id: 0 sor → hiba', async () => {
    pool.query.mockResolvedValueOnce(rows([]));   // stats_views lookup
    const r = await call(H.statsReportScheduleSave, ADMIN, [{
      name: 'X', view_id: 99, schedule: 'monthly',
      recipients: ['a@x.com'], enabled: false,
    }]);
    expect(r.result.ok).toBe(false);
  });
});

describe('statsReportScheduleSave — update', () => {
  test('cross-tenant védelem — nincs sor', async () => {
    pool.query.mockResolvedValueOnce(rows([]));   // lookup üres
    const r = await call(H.statsReportScheduleSave, ADMIN, [{
      id: 88, name: 'X', schedule: 'monthly', recipients: ['a@x.com'],
    }]);
    expect(r.result.ok).toBe(false);
  });

  test('sikeres update', async () => {
    pool.query.mockResolvedValueOnce(rows([{}]));      // lookup rowCount=1
    pool.query.mockResolvedValueOnce(rows([]));        // update
    const r = await call(H.statsReportScheduleSave, ADMIN, [{
      id: 88, name: 'X', schedule: 'weekly', recipients: ['a@x.com'], enabled: true,
    }]);
    expect(r.result.ok).toBe(true);
  });
});

describe('statsReportScheduleDelete', () => {
  test('Manager tiltva', async () => {
    const r = await call(H.statsReportScheduleDelete, MANAGER, [10]);
    expect(r.result.ok).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('nem létező → hiba', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const r = await call(H.statsReportScheduleDelete, ADMIN, [999]);
    expect(r.result.ok).toBe(false);
  });

  test('sikeres törlés', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const r = await call(H.statsReportScheduleDelete, ADMIN, [10]);
    expect(r.result.ok).toBe(true);
  });
});
