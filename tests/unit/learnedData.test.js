// ============================================================
//  Unit-teszt — handlers/learnedData.js (🧠 Tanult adatok fül)
//  Szerep-kapu, company_id-szűrés, összegzés (sofőr-e-mail helyett név),
//  törlés-validáció + migráció-tolerancia, mock DB-vel.
// ============================================================
jest.mock('../../db', () => require('../helpers/db-mock').pool);
jest.mock('../../lib/audit', () => ({ fromReq: async () => {} }));

const { pool, rows, reset } = require('../helpers/db-mock');
const H = require('../../handlers/learnedData');

function call(fn, user, args) {
  return new Promise((resolve) => {
    fn({ session: { user } }, { json: (p) => resolve(p.result) }, args);
  });
}

const ADMIN = { id: 1, email: 'a@x', pozicio: 'Admin', company_id: 7 };
const MANAGER = { id: 2, email: 'm@x', pozicio: 'Manager', company_id: 7 };
const SOFER = { id: 3, email: 's@x', pozicio: 'Sofer', company_id: 7 };

beforeEach(() => reset());

test('Sofer / bejelentkezés nélkül tiltva, DB-hívás nélkül', async () => {
  for (const u of [SOFER, null]) {
    expect((await call(H.learnedDataList, u)).ok).toBe(false);
    expect((await call(H.learnedDataDelete, u, [{ source: 'memory', id: 1 }])).ok).toBe(false);
  }
  expect(pool.query).not.toHaveBeenCalled();
});

test('lista: cégre szűrt, sofőr-becenévnél a NÉV látszik, nem az e-mail', async () => {
  pool.query
    .mockResolvedValueOnce(rows([{ id: 5, template_key: 'dhl', template_label: 'DHL SRL', fields: { valuta: 'EUR', load_type: 'FTL' }, sample_count: 3, updated_at: null }]))
    .mockResolvedValueOnce(rows([
      { id: 9, kind: 'driver_alias', key_norm: 'imi', value: { email: 'GI@x.ro' }, hits: 2, updated_at: null },
      { id: 10, kind: 'mail_style', key_norm: 'user:1', value: { style: { accent: '#f00' } }, hits: 1, updated_at: null },
    ]))
    .mockResolvedValueOnce(rows([{ id: 1, email: 'gi@x.ro', nume: 'Gondos Imre' }]));
  const r = await call(H.learnedDataList, ADMIN);
  expect(r.ok).toBe(true);
  expect(r.orderScan[0]).toMatchObject({ id: 5, label: 'DHL SRL', count: 3 });
  expect(r.orderScan[0].summary).toContain('EUR');
  const alias = r.memory.find(m => m.kind === 'driver_alias');
  expect(alias.summary).toBe('Gondos Imre');
  expect(JSON.stringify(r.memory)).not.toContain('gi@x.ro');
  expect(r.memory.find(m => m.kind === 'mail_style').key).toBe('Gondos Imre');
  for (const c of pool.query.mock.calls) expect(c[1][0]).toBe(7);
});

test('lista: hiányzó táblák (migráció nélkül) → üres, nem hiba', async () => {
  pool.query.mockRejectedValue(new Error('relation does not exist'));
  const r = await call(H.learnedDataList, MANAGER);
  expect(r).toMatchObject({ ok: true, orderScan: [], memory: [] });
});

test('törlés: egy elem cégre szűrten; idegen/nem létező → hiba', async () => {
  pool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
  expect((await call(H.learnedDataDelete, ADMIN, [{ source: 'memory', id: 9 }])).ok).toBe(true);
  expect(pool.query.mock.calls[0][0]).toMatch(/company_id=\$2/);
  expect(pool.query.mock.calls[0][1]).toEqual([9, 7]);

  pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
  expect((await call(H.learnedDataDelete, ADMIN, [{ source: 'order_scan', id: 99 }])).ok).toBe(false);
});

test('törlés: teljes csoport csak fehérlistás kind-dal; rossz forrás elutasítva', async () => {
  pool.query.mockResolvedValueOnce({ rows: [], rowCount: 4 });
  const r = await call(H.learnedDataDelete, ADMIN, [{ source: 'memory', kind: 'mail_tpl' }]);
  expect(r).toMatchObject({ ok: true, deleted: 4 });
  expect(pool.query.mock.calls[0][1]).toEqual([7, 'mail_tpl']);

  expect((await call(H.learnedDataDelete, ADMIN, [{ source: 'memory', kind: 'x; DROP' }])).ok).toBe(false);
  expect((await call(H.learnedDataDelete, ADMIN, [{ source: 'users', id: 1 }])).ok).toBe(false);
  expect(pool.query).toHaveBeenCalledTimes(1);
});
