// ============================================================
//  Unit-teszt — handlers/orderTemplates.js (ismétlődő fuvar-sablonok)
//  Szerep-kapu, input-validáció, company_id-szűrés és a registry-bekötés
//  mock DB-vel (éles DB nem kell). A valódi SQL-t a
//  tests/integration/order-templates-db.test.js fedi.
// ============================================================
jest.mock('../../db', () => require('../helpers/db-mock').pool);
jest.mock('../../lib/audit', () => ({ fromReq: async () => {} }));

const { pool, rows, reset } = require('../helpers/db-mock');
const H = require('../../handlers/orderTemplates');

function call(fn, user, args) {
  return new Promise((resolve) => {
    fn({ session: { user } }, { json: (p) => resolve(p.result) }, args);
  });
}

const ADMIN = { id: 1, email: 'a@x', pozicio: 'Admin', company_id: 7 };
const SOFER = { id: 3, email: 's@x', pozicio: 'Sofer', company_id: 7 };
const KONYV = { id: 4, email: 'k@x', pozicio: 'Konyvelo', company_id: 7 };

beforeEach(() => reset());

describe('szerep-kapu', () => {
  test.each(['orderTemplateList', 'orderTemplateBuild', 'orderTemplateSaveFromOrder',
             'orderTemplateUse', 'orderTemplateRename', 'orderTemplateDelete'])(
    '%s — Sofer és Könyvelő tiltva, DB-hívás nélkül', async (fn) => {
      for (const u of [SOFER, KONYV, null]) {
        const r = await call(H[fn], u, [1]);
        expect(r.ok).toBe(false);
      }
      expect(pool.query).not.toHaveBeenCalled();
    });
});

describe('validáció + tenant-szűrés', () => {
  test('mentés név nélkül → hiba, nincs DB-írás', async () => {
    const r = await call(H.orderTemplateSaveFromOrder, ADMIN, [{ order_id: 'CMD-1', name: '  ' }]);
    expect(r.ok).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('idegen / nem létező fuvarból nem ment (company_id a WHERE-ben)', async () => {
    pool.query.mockResolvedValueOnce(rows([]));           // orders SELECT → nincs
    const r = await call(H.orderTemplateSaveFromOrder, ADMIN, [{ order_id: 'CMD-X', name: 'A' }]);
    expect(r.ok).toBe(false);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/WHERE id = \$1 AND company_id = \$2/);
    expect(params).toEqual(['CMD-X', 7]);
    expect(pool.query).toHaveBeenCalledTimes(1);          // INSERT nem futott
  });

  test('use / delete / rename a cégre szűr', async () => {
    pool.query.mockResolvedValueOnce(rows([]));
    await call(H.orderTemplateUse, ADMIN, [5]);
    expect(pool.query.mock.calls[0][0]).toMatch(/id = \$1 AND company_id = \$2/);
    expect(pool.query.mock.calls[0][1]).toEqual([5, 7]);

    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const d = await call(H.orderTemplateDelete, ADMIN, [5]);
    expect(d.ok).toBe(false);
    expect(pool.query.mock.calls[1][1]).toEqual([5, 7]);
  });

  test('build: a sablon a fuvar-sorrendet tartja, dátumot nem ad', async () => {
    pool.query
      .mockResolvedValueOnce(rows([{ id: 'CMD-1', client: 'Alfa', load_type: 'FTL', pret: '900', km: '600',
        suly_kg: null, hossz_cm: null, szel_cm: null, mag_cm: null, rendszam_camion: 'B1', rendszam_remorca: null }]))
      .mockResolvedValueOnce(rows([
        { kind: 'pickup', loc: 'Cluj', firma: 'F1' },
        { kind: 'delivery', loc: 'Wien', firma: 'F2' },
        { kind: 'pickup', loc: 'Arad', firma: '' },
      ]));
    const r = await call(H.orderTemplateBuild, ADMIN, ['CMD-1']);
    expect(r.ok).toBe(true);
    expect(r.fields.stops.map((s) => s.loc)).toEqual(['Cluj', 'Wien', 'Arad']);
    expect(r.fields.stops.every((s) => !('data' in s))).toBe(true);
    expect(r.fields).toMatchObject({ client: 'Alfa', load_type: 'FTL', pret: 900, km: 600, rendszam_camion: 'B1' });
  });
});

describe('registry', () => {
  test('minden handler bekötve a /api/execute registry-be', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../routes/execute.js'), 'utf8');
    expect(src).toMatch(/require\('\.\.\/handlers\/orderTemplates'\)/);
  });
});
