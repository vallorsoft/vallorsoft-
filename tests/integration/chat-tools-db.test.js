// ============================================================
//  VALÓDI DB integráció — AI-chat 2.0 képesség-katalógus (lib/chatTools).
//   - minden OLVASÓ képesség lefut a valódi sémán (SQL-drift őr)
//   - írás → ✅ végrehajtás → visszavonás a valódi táblákon
//   - cross-tenant: idegen cég fuvarja/sofőrje nem oldható fel
//   - tanulás: nem értett mondat naplója
//  Csak DATABASE_URL mellett fut (CI Postgres service); enélkül skip.
// ============================================================
const { loadSchema, truncateAll, hasDb } = require('../helpers/real-db');

jest.mock('../../lib/geminiJson', () => ({ extractJson: async () => { throw Object.assign(new Error('no ai in test'), { code: 'NO_KEY' }); } }));
jest.mock('../../lib/vehiclePositions', () => ({ getPositions: async () => ({ ok: true, positions: [] }), getReadingsForPlate: async () => ({ ok: true, available: false }) }));
jest.mock('../../services/bnr', () => ({ fetchBnrEurRon: async () => 5 }));

const pool = require('../../db');
const tools = require('../../lib/chatTools');
const router = require('../../lib/chatRouter');
const ops = require('../../lib/chatOps');
const learn = require('../../lib/chatTools/learn');

const d = hasDb() ? describe : describe.skip;

d('Valódi DB — chat képesség-katalógus', () => {
  jest.setTimeout(60000);
  let cid, otherCid, ADMIN;
  const reqAs = (u) => ({ session: { user: u }, headers: {}, ip: '127.0.0.1' });
  const ctxAs = (u, ui) => router.makeCtx(reqAs(u), 'hu', 'teszt', [], router.cleanUi(ui || {}, u.pozicio), new Date());
  const tokOf = (html) => /data-tok="([^"]+)"/.exec(html)[1];

  beforeAll(async () => { await loadSchema(pool); });
  afterAll(async () => { await pool.end(); });

  beforeEach(async () => {
    await truncateAll(pool);
    await pool.query('TRUNCATE clients, carriers, document_expiries, vehicle_service_log, driver_earnings, chat_action_log, chat_miss_log, chat_learned_intents, order_uit_codes, order_legs, order_ecmr, cost_calculations, stats_goals, company_branding, doc_register_entries, doc_register_groups, doc_register_counters RESTART IDENTITY CASCADE');
    cid = (await pool.query("INSERT INTO companies (nev) VALUES ('Teszt SRL') RETURNING id")).rows[0].id;
    otherCid = (await pool.query("INSERT INTO companies (nev) VALUES ('Masik SRL') RETURNING id")).rows[0].id;
    const a = await pool.query("INSERT INTO users (nume, email, pozicio, password_hash, company_id) VALUES ('Admin A','admin@x.ro','Admin','x',$1) RETURNING id", [cid]);
    ADMIN = { id: a.rows[0].id, company_id: cid, pozicio: 'Admin', email: 'admin@x.ro', nume: 'Admin A' };
    await pool.query("INSERT INTO users (nume, email, pozicio, password_hash, company_id) VALUES ('Pető-Lőrincz Imre','peto@x.ro','Sofer','x',$1)", [cid]);
    await pool.query("INSERT INTO users (nume, email, pozicio, password_hash, company_id) VALUES ('Idegen Sofor','idegen@y.ro','Sofer','x',$1)", [otherCid]);
    await pool.query("INSERT INTO vehicles (rendszam, tip, marca, company_id) VALUES ('B104VLR','Vontato','Mercedes',$1), ('CJ36VSN','Potkocsi',null,$1)", [cid]);
    await pool.query(`INSERT INTO orders (id, client, loc_incarcare, loc_descarcare, data_incarcare, data_descarcare, pret, status, company_id, fuvar_no)
                      VALUES ('CMDA1','Bilka','Brașov, RO','Bicske, HU','2026-10-09','2026-10-10',1200,'Disponibil',$1,'CMD-2026-0042'),
                             ('CMDB1','Idegen','Arad, RO','Wien, AT','2026-10-09','2026-10-10',900,'Disponibil',$2,'CMD-2026-0043')`, [cid, otherCid]);
    await pool.query("INSERT INTO clients (company_id, denumire, cui_cif, email) VALUES ($1,'Bilka SRL','RO123','a@bilka.ro')", [cid]);
    await pool.query("INSERT INTO carriers (company_id, nev) VALUES ($1,'Trans Rapid SRL')", [cid]);
  });

  test('minden olvasó képesség lefut a valódi sémán (nincs SQL-hiba)', async () => {
    const c = ctxAs(ADMIN);
    const args = {
      'order.list': [{}, { status: 'all', client: 'Bilka', period: '2026-10' }, { status: 'unpaid' }, { status: 'waiting', driver: 'Peto', vehicle: 'B104VLR' }],
      'vehicle.position': [{ vehicle: 'B104VLR' }], 'service.list': [{ vehicle: 'B104VLR' }], 'expiry.list': [{}, { days: 0, target: 'B104VLR' }],
      'driver.balance': [{ driver: 'Peto' }, { driver: 'Peto', period: 'this_month' }], 'finance.revenue': [{}], 'fuel.compare': [{}],
      'finance.invoices_out': [{}], 'client.list': [{}, { search: 'bil' }], 'docs.search': [{}, { order: '0042', doc_type: 'cmr' }],
      'order.tracking_link': [{ order: '0042' }], 'mail.inbox': [{}],
      'order.uit_list': [{ order: '0042' }], 'vcalc.order_cost': [{ order: '0042', fuel_price: 7.2 }],
    };
    const reads = tools.all().filter((t) => t.kind === 'read');
    const fails = [];
    for (const t of reads) {
      for (const a of (args[t.name] || [{}])) {
        let r;
        try { r = await tools.prepare(c, { tool: t.name, args: a }); } catch (e) { fails.push(t.name + ': ' + e.message); continue; }
        if (/Eroare de server|Cannot read|is not a function/.test(String(r.reply))) fails.push(t.name + ': ' + r.reply);
      }
    }
    expect(fails).toEqual([]);
  });

  test('fuvar-módosítás → ✅ → DB-ben átírva → visszavonás → eredeti érték', async () => {
    const r = await tools.prepare(ctxAs(ADMIN), { tool: 'order.update', args: { order: '0042', pret: 1350, data_descarcare: '2026-10-12' } });
    expect(r.html).toContain('data-tok=');
    const x = await ops.executeAction(reqAs(ADMIN), tokOf(r.html), {}, 'hu');
    expect(x.ok).toBe(true);
    let o = (await pool.query("SELECT pret, data_descarcare::text AS dd FROM orders WHERE id='CMDA1'")).rows[0];
    expect(Number(o.pret)).toBe(1350);
    expect(o.dd).toBe('2026-10-12');
    const u = await tools.prepare(ctxAs(ADMIN), { tool: 'chat.undo', args: {} });
    const y = await ops.executeAction(reqAs(ADMIN), tokOf(u.html), {}, 'hu');
    expect(y.ok).toBe(true);
    o = (await pool.query("SELECT pret, data_descarcare::text AS dd FROM orders WHERE id='CMDA1'")).rows[0];
    expect(Number(o.pret)).toBe(1200);
    expect(o.dd).toBe('2026-10-10');
  });

  test('kiosztás + terv két lépéssel; idegen cég fuvarja / sofőrje nem oldható fel', async () => {
    const c = ctxAs(ADMIN);
    const bad = await tools.prepare(c, { tool: 'order.set_status', args: { order: '0043', status: 'Finalizat' } });
    expect(bad.html).toBe('');
    const bad2 = await tools.prepare(c, { tool: 'order.assign', args: { order: '0042', driver: 'Idegen' } });
    expect(bad2.html).toBe('');
    const r = await router.runSteps(c, [{ tool: 'order.assign', args: { order: '0042', driver: 'Peto', tractor: 'B104VLR' } }, { tool: 'order.update', args: { order: '0042', suly_kg: 18000 } }]);
    expect(r.html).toContain('och-plan');
    const x = await ops.executeAction(reqAs(ADMIN), tokOf(r.html), {}, 'hu');
    expect(x.ok).toBe(true);
    const o = (await pool.query("SELECT email_sofer, rendszam_camion, status, suly_kg FROM orders WHERE id='CMDA1'")).rows[0];
    expect(o.email_sofer).toBe('peto@x.ro');
    expect(o.rendszam_camion).toBe('B104VLR');
    expect(o.status).toBe('Alocat');
    expect(Number(o.suly_kg)).toBe(18000);
  });

  test('flotta + sofőr + ügyfél írások a valódi táblákba', async () => {
    const run = async (tool, args, extra) => {
      const r = await tools.prepare(ctxAs(ADMIN), { tool, args });
      expect(r.html).toContain('data-tok=');
      const x = await ops.executeAction(reqAs(ADMIN), tokOf(r.html), extra || {}, 'hu');
      expect(x).toMatchObject({ ok: true });
      return x;
    };
    await run('expiry.set', { vehicle: 'B104VLR', doc_type: 'itp', expiry_date: '2027-03-15' });
    expect((await pool.query("SELECT doc_type, expiry_date::text AS e FROM document_expiries WHERE company_id=$1", [cid])).rows).toEqual([{ doc_type: 'ITP (műszaki)', e: '2027-03-15' }]);
    // Második beállítás ugyanarra: frissít, nem duplikál.
    await run('expiry.set', { vehicle: 'B104VLR', doc_type: 'itp', expiry_date: '2028-03-15' });
    expect((await pool.query("SELECT COUNT(*)::int AS n FROM document_expiries WHERE company_id=$1", [cid])).rows[0].n).toBe(1);
    await run('service.add', { vehicle: 'B104VLR', km: 412000, category: 'olajcsere', cost_ron: 1800, next_due_km: 452000 });
    await run('service.postpone', { vehicle: 'B104VLR', next_due_km: 455000 });
    expect(Number((await pool.query('SELECT next_due_km FROM vehicle_service_log WHERE company_id=$1', [cid])).rows[0].next_due_km)).toBe(455000);
    await run('driver.earning_add', { driver: 'Peto', kind: 'diurna', unit_amount: 70, days: '2026-10-01..2026-10-03' });
    expect(Number((await pool.query('SELECT total_amount AS total FROM driver_earnings WHERE company_id=$1', [cid])).rows[0].total)).toBe(210);
    await run('vehicle.pair_driver', { driver: 'Peto', tractor: 'B104VLR' });
    expect((await pool.query("SELECT assigned_driver_email FROM vehicles WHERE rendszam='B104VLR'")).rows[0].assigned_driver_email).toBe('peto@x.ro');
    await run('client.update', { client: 'Bilka', payment_term_days: 45 });
    expect((await pool.query("SELECT payment_term_days FROM clients WHERE company_id=$1", [cid])).rows[0].payment_term_days).toBe(45);
    await run('order.delete', { order: '0042' }, { input: 'IGEN' });
    expect((await pool.query("SELECT status FROM orders WHERE id='CMDA1'")).rows[0].status).toBe('Anulat');
    const u = await tools.prepare(ctxAs(ADMIN), { tool: 'chat.undo', args: {} });
    await ops.executeAction(reqAs(ADMIN), tokOf(u.html), {}, 'hu');
    expect((await pool.query("SELECT status FROM orders WHERE id='CMDA1'")).rows[0].status).toBe('Disponibil');
  });

  test('2. kör: tömeges, UIT, szakasz, e-CMR, kalkuláció, KPI-cél, cégadat, nyilvántartás — írás + visszavonás', async () => {
    const run = async (tool, args, ui, extra) => {
      const r = await tools.prepare(ctxAs(ADMIN, ui), { tool, args });
      expect(r.html).toContain('data-tok=');
      const x = await ops.executeAction(reqAs(ADMIN), tokOf(r.html), extra || {}, 'hu');
      expect(x).toMatchObject({ ok: true });
      return x;
    };
    const undoLast = async () => {
      const u = await tools.prepare(ctxAs(ADMIN), { tool: 'chat.undo', args: {} });
      const y = await ops.executeAction(reqAs(ADMIN), tokOf(u.html), {}, 'hu');
      expect(y).toMatchObject({ ok: true });
    };
    await pool.query(`INSERT INTO orders (id, client, loc_incarcare, loc_descarcare, pret, km, status, company_id, fuvar_no, rendszam_camion)
                      VALUES ('CMDA2','Bilka','Arad, RO','Győr, HU',1500,1350,'Finalizat',$1,'CMD-2026-0044','B104VLR')`, [cid]);

    // Tömeges: a felületen kijelölt fuvarok + idegen cég fuvarja nem kerül bele.
    await run('order.bulk_post_delivery', { orders: 'selected', invoice_no: 'FCT-9' }, { selected: ['CMDA1', 'CMDA2', 'CMDB1'] });
    const inv = (await pool.query("SELECT id, invoice_no FROM orders ORDER BY id")).rows;
    expect(inv).toEqual([{ id: 'CMDA1', invoice_no: 'FCT-9' }, { id: 'CMDA2', invoice_no: 'FCT-9' }, { id: 'CMDB1', invoice_no: null }]);
    await undoLast();
    expect((await pool.query("SELECT COUNT(*)::int AS n FROM orders WHERE invoice_no IS NOT NULL")).rows[0].n).toBe(0);

    // UIT: kötőjeles kód normalizálva, duplikátum elutasítva, visszavonás töröl.
    await run('order.uit_add', { order: '0042', code: 'ab12-cd34-ef56-gh78' });
    expect((await pool.query("SELECT uit_code, rendszam FROM order_uit_codes WHERE company_id=$1", [cid])).rows).toEqual([{ uit_code: 'AB12CD34EF56GH78', rendszam: null }]);
    const dup = await tools.prepare(ctxAs(ADMIN), { tool: 'order.uit_add', args: { order: '0042', code: 'AB12CD34EF56GH78' } });
    expect(dup.reply).toMatch(/már szerepel/);
    await undoLast();
    expect((await pool.query("SELECT COUNT(*)::int AS n FROM order_uit_codes")).rows[0].n).toBe(0);
    // Idegen cég fuvarjához közvetlenül sem lehet UIT-et írni.
    const cross = await require('../../routes/uit').addUitCode(cid, ADMIN.id, 'CMDB1', { uit_code: 'X1' });
    expect(cross.status).toBe(404);

    // Szakasz: új sofőr átveszi, a fuvar teteje követi; visszavonás törli a szakaszt.
    await run('order.leg_add', { order: '0042', driver: 'Peto', tractor: 'B104VLR', place: 'Arad' });
    expect((await pool.query("SELECT email_sofer FROM orders WHERE id='CMDA1'")).rows[0].email_sofer).toBe('peto@x.ro');
    await undoLast();
    expect((await pool.query("SELECT COUNT(*)::int AS n FROM order_legs")).rows[0].n).toBe(0);

    // e-CMR
    await run('ecmr.create', { order: '0042' });
    expect((await pool.query("SELECT status FROM order_ecmr WHERE company_id=$1", [cid])).rows).toEqual([{ status: 'draft' }]);
    const again = await tools.prepare(ctxAs(ADMIN), { tool: 'ecmr.create', args: { order: '0042' } });
    expect(again.reply).toMatch(/már van e-CMR/);

    // Költség-kalkuláció: olvasás nem ment, a mentés tool igen.
    const calc = await tools.prepare(ctxAs(ADMIN), { tool: 'vcalc.order_cost', args: { order: '0044', fuel_price: 7.2 } });
    expect(calc.reply).toMatch(/várható eredménye/);
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM cost_calculations')).rows[0].n).toBe(0);
    await run('vcalc.order_cost_save', { order: '0044', fuel_price: 7.2 });
    expect((await pool.query('SELECT order_id FROM cost_calculations WHERE company_id=$1', [cid])).rows).toEqual([{ order_id: 'CMDA2' }]);

    // KPI-cél: beállítás → visszavonás (nem volt előtte → törlődik).
    await run('stats.goal_set', { metric: 'revenue', target: 120000 });
    expect(Number((await pool.query("SELECT target_value FROM stats_goals WHERE company_id=$1", [cid])).rows[0].target_value)).toBe(120000);
    await undoLast();
    expect((await pool.query("SELECT COUNT(*)::int AS n FROM stats_goals")).rows[0].n).toBe(0);

    // Cégadat: az IBAN módosul, a márka-szín NEM vész el; visszavonás.
    await pool.query("INSERT INTO company_branding (company_id, brand_color) VALUES ($1, '#f6711e')", [cid]);
    await run('company.settings_update', { iban: 'RO49AAAA1B31007593840000' });
    expect((await pool.query("SELECT iban FROM companies WHERE id=$1", [cid])).rows[0].iban).toBe('RO49AAAA1B31007593840000');
    expect((await pool.query("SELECT brand_color FROM company_branding WHERE company_id=$1", [cid])).rows[0].brand_color).toBe('#f6711e');
    await undoLast();
    expect((await pool.query("SELECT iban FROM companies WHERE id=$1", [cid])).rows[0].iban).toBeNull();

    // Dokumentum-nyilvántartás: foglalás → partner módosítás (a cím megmarad) → sztornó.
    await pool.query("INSERT INTO doc_register_groups (company_id, name, prefix) VALUES ($1, 'Facturi', 'FCT')", [cid]);
    const res = await run('docs.register_reserve', { folder: 'FCT', title: 'Szerződés' });
    const regNo = /: (\S+)$/.exec(res.reply)[1];
    await run('docs.register_update', { reg_no: regNo, partner: 'Bilka' });
    let e = (await pool.query('SELECT title, partner, status FROM doc_register_entries WHERE company_id=$1', [cid])).rows[0];
    expect(e).toEqual({ title: 'Szerződés', partner: 'Bilka', status: 'reserved' });
    await run('docs.register_update', { reg_no: regNo, void: true });
    expect((await pool.query('SELECT status FROM doc_register_entries WHERE company_id=$1', [cid])).rows[0].status).toBe('void');

    // Új jármű visszavonható (ha még nincs fuvarban).
    await run('vehicle.create', { plate: 'B999ZZZ', kind: 'tractor' });
    await undoLast();
    expect((await pool.query("SELECT COUNT(*)::int AS n FROM vehicles WHERE rendszam='B999ZZZ'")).rows[0].n).toBe(0);

    // Manager nem állíthat KPI-célt / cégadatot (csak Admin).
    const MGR = Object.assign({}, ADMIN, { pozicio: 'Manager' });
    const m = await tools.prepare(ctxAs(MGR), { tool: 'stats.goal_set', args: { metric: 'revenue', target: 1 } });
    expect(m.html || '').not.toContain('data-tok=');
  });

  test('nem értett mondat naplózva, majd a következő sikeres művelethez kötve tanul', async () => {
    const req = reqAs(ADMIN);
    await learn.recordMiss(req, 'csinálj valamit a bilkás fuvarral', ['Mutasd a Bilka fuvarjait']);
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM chat_miss_log WHERE company_id=$1', [cid])).rows[0].n).toBe(1);
    await learn.recordHit(req, 'x', 'order.list');
    expect((await pool.query('SELECT tool FROM chat_learned_intents WHERE company_id=$1', [cid])).rows).toEqual([{ tool: 'order.list' }]);
    expect((await pool.query('SELECT resolved_tool FROM chat_miss_log WHERE company_id=$1', [cid])).rows[0].resolved_tool).toBe('order.list');
  });
});
