// ============================================================
//  VALÓDI DB — ismétlődő fuvar-sablonok teljes útja:
//  fuvarból mentés (interleaved állomás-sorrend, dátum nélkül) → lista →
//  használat (számláló) → átnevezés (névütközés) → törlés, és a
//  cégek közötti izoláció. Csak DATABASE_URL mellett fut; enélkül skip.
// ============================================================
const { loadSchema, truncateAll, hasDb } = require('../helpers/real-db');

const pool = require('../../db');
const H = require('../../handlers/orderTemplates');

function call(fn, user, args) {
  return new Promise((resolve) => {
    fn({ session: { user }, headers: {} }, { json: (p) => resolve(p.result) }, args);
  });
}

const d = hasDb() ? describe : describe.skip;

d('Fuvar-sablonok (valódi DB)', () => {
  jest.setTimeout(40000);
  let cidA, cidB;
  const ADMIN_A = { id: 1, email: 'a@a.ro', pozicio: 'Admin' };
  const ADMIN_B = { id: 2, email: 'b@b.ro', pozicio: 'Admin' };

  beforeAll(async () => { await loadSchema(pool); });
  afterAll(async () => { await pool.end(); });

  beforeEach(async () => {
    await truncateAll(pool);
    await pool.query('DELETE FROM order_templates');
    cidA = (await pool.query("INSERT INTO companies (nev) VALUES ('A SRL') RETURNING id")).rows[0].id;
    cidB = (await pool.query("INSERT INTO companies (nev) VALUES ('B SRL') RETURNING id")).rows[0].id;
    ADMIN_A.company_id = cidA; ADMIN_B.company_id = cidB;
    await pool.query(
      `INSERT INTO orders (id, company_id, client, status, load_type, pret, km, suly_kg, rendszam_camion,
                           loc_incarcare, loc_descarcare, data_incarcare, data_descarcare, ref)
       VALUES ('CMD-T1', $1, 'Client Alfa', 'Finalizat', 'LTL', 900, 600, 5000, 'B104VLR',
               'Cluj', 'Wien', CURRENT_DATE, CURRENT_DATE + 1, 'REF-123')`, [cidA]);
    // Interleaved állomások: fel → le → fel → le
    await pool.query('DELETE FROM order_stops WHERE order_id = $1', ['CMD-T1']);
    const stops = [['pickup', 0, 'Cluj', 0], ['delivery', 0, 'Budapest', 1], ['pickup', 1, 'Győr', 2], ['delivery', 1, 'Wien', 3]];
    for (const [kind, si, loc, seq] of stops) {
      await pool.query(
        `INSERT INTO order_stops (order_id, company_id, kind, stop_index, loc, firma, data, seq_index)
         VALUES ('CMD-T1', $1, $2, $3, $4, $5, CURRENT_DATE, $6)`, [cidA, kind, si, loc, 'Firma ' + loc, seq]);
    }
  });

  test('teljes életciklus + interleaved sorrend, dátum/ref nélkül', async () => {
    const s = await call(H.orderTemplateSaveFromOrder, ADMIN_A, [{ order_id: 'CMD-T1', name: 'Alfa Cluj-Wien' }]);
    expect(s.ok).toBe(true);

    const dup = await call(H.orderTemplateSaveFromOrder, ADMIN_A, [{ order_id: 'CMD-T1', name: 'alfa cluj-wien' }]);
    expect(dup.ok).toBe(false);                       // kis/nagybetű-független névütközés

    const l = await call(H.orderTemplateList, ADMIN_A, []);
    expect(l.items).toHaveLength(1);
    expect(l.items[0]).toMatchObject({ name: 'Alfa Cluj-Wien', client: 'Client Alfa', route: 'Cluj → Wien', stops_count: 4 });

    const u = await call(H.orderTemplateUse, ADMIN_A, [s.id]);
    expect(u.ok).toBe(true);
    expect(u.fields.stops.map((x) => x.kind + ':' + x.loc))
      .toEqual(['pickup:Cluj', 'delivery:Budapest', 'pickup:Győr', 'delivery:Wien']);
    expect(u.fields).toMatchObject({ load_type: 'LTL', pret: 900, km: 600, suly_kg: 5000, rendszam_camion: 'B104VLR' });
    expect(JSON.stringify(u.fields)).not.toMatch(/REF-123|data_incarcare/);
    const cnt = (await pool.query('SELECT use_count FROM order_templates WHERE id=$1', [s.id])).rows[0].use_count;
    expect(cnt).toBe(1);

    expect((await call(H.orderTemplateRename, ADMIN_A, [{ id: s.id, name: 'Új név' }])).ok).toBe(true);
    expect((await call(H.orderTemplateDelete, ADMIN_A, [s.id])).ok).toBe(true);
    expect((await call(H.orderTemplateList, ADMIN_A, [])).items).toHaveLength(0);
  });

  test('cégek közötti izoláció', async () => {
    // B cég nem menthet A cég fuvarából
    const x = await call(H.orderTemplateSaveFromOrder, ADMIN_B, [{ order_id: 'CMD-T1', name: 'Lopott' }]);
    expect(x.ok).toBe(false);
    expect((await call(H.orderTemplateBuild, ADMIN_B, ['CMD-T1'])).ok).toBe(false);

    const s = await call(H.orderTemplateSaveFromOrder, ADMIN_A, [{ order_id: 'CMD-T1', name: 'A sablon' }]);
    expect((await call(H.orderTemplateList, ADMIN_B, [])).items).toHaveLength(0);
    expect((await call(H.orderTemplateUse, ADMIN_B, [s.id])).ok).toBe(false);
    expect((await call(H.orderTemplateRename, ADMIN_B, [{ id: s.id, name: 'X' }])).ok).toBe(false);
    expect((await call(H.orderTemplateDelete, ADMIN_B, [s.id])).ok).toBe(false);
    expect((await call(H.orderTemplateList, ADMIN_A, [])).items).toHaveLength(1);
  });
});
