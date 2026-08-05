// ============================================================
//  Unit-teszt — handlers/statsV2.js  (Statisztika 2.0 alap PR #1)
//  A szerep-kapukat + mentett nézetek + KPI cél-értékek CRUD-ot
//  + tenant/tulajdon-védelmet + input-validációt teszteljük mock DB-vel.
// ============================================================
jest.mock('../../db', () => require('../helpers/db-mock').pool);
jest.mock('../../lib/audit', () => ({ fromReq: async () => {} }));

const { pool, rows, reset } = require('../helpers/db-mock');
const H = require('../../handlers/statsV2');

function call(fn, user, args) {
  return new Promise((resolve) => {
    const req = { session: { user } };
    const res = { json: (payload) => resolve(payload) };
    fn(req, res, args);
  });
}

const ADMIN   = { id: 1,  email: 'a@x', pozicio: 'Admin',   company_id: 1, nume: 'A' };
const MANAGER = { id: 2,  email: 'm@x', pozicio: 'Manager', company_id: 1, nume: 'M' };
const MGR_B   = { id: 22, email: 'm2@x', pozicio: 'Manager', company_id: 1, nume: 'M2' };
const OTHER   = { id: 99, email: 'o@x', pozicio: 'Admin',   company_id: 2, nume: 'O' };
const SOFER   = { id: 3,  email: 's@x', pozicio: 'Sofer',   company_id: 1 };

beforeEach(() => reset());

// ─────────── statsV2Init ───────────
describe('statsV2Init', () => {
  test('Sofer szerep tiltva', async () => {
    const r = await call(H.statsV2Init, SOFER);
    expect(r.result.ok).toBe(false);
  });

  test('Admin bypass — can_finance=true, tabs+goals visszaadva', async () => {
    pool.query.mockResolvedValueOnce(rows([{ metric_key: 'revenue', period: 'month', target_value: 100000, currency: 'EUR', note: null, updated_at: new Date() }]));
    const r = await call(H.statsV2Init, ADMIN);
    expect(r.result.ok).toBe(true);
    expect(r.result.can_finance).toBe(true);
    expect(r.result.is_admin).toBe(true);
    expect(Array.isArray(r.result.tabs)).toBe(true);
    expect(r.result.tabs.length).toBeGreaterThanOrEqual(5);
    expect(r.result.goals.length).toBe(1);
  });

  test('Manager pénzügy-jog nélkül: can_finance=false', async () => {
    pool.query.mockResolvedValueOnce(rows([]));      // user_permissions üres
    pool.query.mockResolvedValueOnce(rows([]));      // goals
    const r = await call(H.statsV2Init, MANAGER);
    expect(r.result.ok).toBe(true);
    expect(r.result.can_finance).toBe(false);
    expect(r.result.is_admin).toBe(false);
  });

  test('Manager pénzügy-joggal: can_finance=true', async () => {
    pool.query.mockResolvedValueOnce(rows([{ enabled: true }]));
    pool.query.mockResolvedValueOnce(rows([]));
    const r = await call(H.statsV2Init, MANAGER);
    expect(r.result.ok).toBe(true);
    expect(r.result.can_finance).toBe(true);
  });
});

// ─────────── statsViewList / Save / Delete ───────────
describe('statsView CRUD', () => {
  test('Sofer nem listázhat', async () => {
    const r = await call(H.statsViewList, SOFER);
    expect(r.result.ok).toBe(false);
  });

  test('Manager listáz — a saját + megosztottak, cégre szűrve', async () => {
    pool.query.mockResolvedValueOnce(rows([
      { id: 10, name: 'Havi', config: {}, is_shared: false, user_id: 2, owner_name: 'M', updated_at: new Date() },
      { id: 11, name: 'Cég',  config: {}, is_shared: true,  user_id: 1, owner_name: 'A', updated_at: new Date() },
    ]));
    const r = await call(H.statsViewList, MANAGER);
    expect(r.result.ok).toBe(true);
    expect(r.result.views).toHaveLength(2);
    const sql = pool.query.mock.calls[0][0];
    const args = pool.query.mock.calls[0][1];
    expect(sql).toMatch(/company_id\s*=\s*\$1/);
    expect(sql).toMatch(/user_id\s*=\s*\$2\s+OR\s+sv\.is_shared/i);
    expect(args).toEqual([1, 2]);
  });

  test('statsViewSave — új nézet létrehozása', async () => {
    pool.query.mockResolvedValueOnce(rows([{ id: 55 }]));
    const r = await call(H.statsViewSave, MANAGER, [{ name: 'X', config: { tab: 'overview' }, is_shared: false }]);
    expect(r.result.ok).toBe(true);
    expect(r.result.id).toBe(55);
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toMatch(/INSERT INTO stats_views/);
  });

  test('statsViewSave — üres név → hiba', async () => {
    const r = await call(H.statsViewSave, MANAGER, [{ name: '', config: {} }]);
    expect(r.result.ok).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('statsViewSave — túl nagy config → hiba', async () => {
    const bigCfg = { s: 'x'.repeat(40000) };
    const r = await call(H.statsViewSave, MANAGER, [{ name: 'X', config: bigCfg }]);
    expect(r.result.ok).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('statsViewSave update — saját nézet OK', async () => {
    pool.query.mockResolvedValueOnce(rows([{ user_id: 2, is_shared: false }]));
    pool.query.mockResolvedValueOnce(rows([]));  // update
    const r = await call(H.statsViewSave, MANAGER, [{ id: 10, name: 'Y', config: {} }]);
    expect(r.result.ok).toBe(true);
  });

  test('statsViewSave update — MÁS user nézete Manager elől tiltva', async () => {
    pool.query.mockResolvedValueOnce(rows([{ user_id: 999, is_shared: true }]));
    const r = await call(H.statsViewSave, MGR_B, [{ id: 10, name: 'Y', config: {} }]);
    expect(r.result.ok).toBe(false);
    expect(pool.query).toHaveBeenCalledTimes(1);   // az UPDATE-re már nem került sor
  });

  test('statsViewSave update — Admin írhatja a más által megosztottat', async () => {
    pool.query.mockResolvedValueOnce(rows([{ user_id: 22, is_shared: true }]));
    pool.query.mockResolvedValueOnce(rows([]));
    const r = await call(H.statsViewSave, ADMIN, [{ id: 10, name: 'Y', config: {} }]);
    expect(r.result.ok).toBe(true);
  });

  test('statsViewSave — cross-tenant tiltás (nincs sor)', async () => {
    pool.query.mockResolvedValueOnce(rows([]));    // WHERE id=X AND company_id=cégB → 0 sor
    const r = await call(H.statsViewSave, OTHER, [{ id: 10, name: 'Y', config: {} }]);
    expect(r.result.ok).toBe(false);
  });

  test('statsViewDelete — sikeres saját törlés', async () => {
    pool.query.mockResolvedValueOnce(rows([{ user_id: 2 }]));
    pool.query.mockResolvedValueOnce(rows([]));
    const r = await call(H.statsViewDelete, MANAGER, [10]);
    expect(r.result.ok).toBe(true);
  });

  test('statsViewDelete — más user nézete Manager elől tiltva', async () => {
    pool.query.mockResolvedValueOnce(rows([{ user_id: 999 }]));
    const r = await call(H.statsViewDelete, MGR_B, [10]);
    expect(r.result.ok).toBe(false);
  });
});

// ─────────── statsGoal Set / List / Delete ───────────
describe('statsGoal Set/List/Delete', () => {
  test('Manager NEM állíthat célt (Admin only)', async () => {
    const r = await call(H.statsGoalSet, MANAGER, [{ metric_key: 'revenue', period: 'month', target_value: 1000 }]);
    expect(r.result.ok).toBe(false);
  });

  test('Admin — érvénytelen metric_key elutasítva', async () => {
    const r = await call(H.statsGoalSet, ADMIN, [{ metric_key: 'nope', period: 'month', target_value: 1000 }]);
    expect(r.result.ok).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('Admin — érvénytelen period elutasítva', async () => {
    const r = await call(H.statsGoalSet, ADMIN, [{ metric_key: 'revenue', period: 'weekly', target_value: 1000 }]);
    expect(r.result.ok).toBe(false);
  });

  test('Admin — negatív target elutasítva', async () => {
    const r = await call(H.statsGoalSet, ADMIN, [{ metric_key: 'revenue', period: 'month', target_value: -1 }]);
    expect(r.result.ok).toBe(false);
  });

  test('Admin — érvényes cél upsert', async () => {
    pool.query.mockResolvedValueOnce(rows([{ id: 7 }]));
    const r = await call(H.statsGoalSet, ADMIN, [{ metric_key: 'revenue', period: 'month', target_value: 50000, currency: 'EUR' }]);
    expect(r.result.ok).toBe(true);
    expect(r.result.id).toBe(7);
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toMatch(/ON CONFLICT/);
    expect(sql).toMatch(/company_id/);
  });

  test('Admin — cél törlés', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const r = await call(H.statsGoalDelete, ADMIN, [7]);
    expect(r.result.ok).toBe(true);
  });

  test('Admin — nem létező cél törlésnél 0 sor → hiba', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const r = await call(H.statsGoalDelete, ADMIN, [999]);
    expect(r.result.ok).toBe(false);
  });

  test('statsGoalList — Manager is olvashat', async () => {
    pool.query.mockResolvedValueOnce(rows([{ id: 1, metric_key: 'revenue', period: 'month', target_value: 1000, currency: 'EUR', note: null, updated_at: new Date() }]));
    const r = await call(H.statsGoalList, MANAGER);
    expect(r.result.ok).toBe(true);
    expect(r.result.goals).toHaveLength(1);
    const args = pool.query.mock.calls[0][1];
    expect(args).toEqual([1]);   // cégre szűrve
  });
});
