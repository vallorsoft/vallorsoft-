// ============================================================
//  VALÓDI DB integráció — határátlépés utólagos módosítása
//  (`borderCrossingUpdate`) + időrendi lista (`getBorderLogs`):
//   - sofőr a SAJÁTJÁT módosíthatja, másét nem; admin a cégéét
//   - az eredeti időpont/irány megőrződik (orig_*), edit_count nő
//   - a lista a MÓDOSÍTOTT időpont szerint rendeződik
//   - két egymást követő azonos irány → seq_warn
//   - a menetlevél diurnája újraszámolódik (ha nem volt kézzel felülírva)
//  Csak DATABASE_URL mellett fut; enélkül skip.
// ============================================================
const { loadSchema, truncateAll, hasDb } = require('../helpers/real-db');
const pool = require('../../db');
const documents = require('../../handlers/documents');

function makeRes() {
  const res = { body: null };
  res.json = (o) => { res.body = o; return res; };
  return res;
}
const call = async (fn, user, arg) => {
  const res = makeRes();
  await documents[fn]({ session: { user }, headers: {}, ip: '127.0.0.1' }, res, arg === undefined ? [] : [arg]);
  return res.body.result;
};
const daysAgo = (n, h = 10) => { const d = new Date(Date.now() - n * 86400000); d.setUTCHours(h, 0, 0, 0); return d; };

const d = hasDb() ? describe : describe.skip;

d('Valódi DB — határátlépés módosítása', () => {
  jest.setTimeout(40000);
  let cid, otherCid;
  const ADMIN = { id: 1, email: 'admin@x.hu', nume: 'Admin', pozicio: 'Admin' };
  const SOFER = { id: 2, email: 'sofer@x.hu', nume: 'Kovacs Bela', pozicio: 'Sofer' };
  const OTHER = { id: 3, email: 'masik@y.hu', nume: 'Masik', pozicio: 'Admin' };

  beforeAll(async () => { await loadSchema(pool); });
  afterAll(async () => { await pool.end(); });
  beforeEach(async () => {
    await truncateAll(pool);
    cid = (await pool.query("INSERT INTO companies (nev) VALUES ('A Kft') RETURNING id")).rows[0].id;
    otherCid = (await pool.query("INSERT INTO companies (nev) VALUES ('B Kft') RETURNING id")).rows[0].id;
    ADMIN.company_id = cid; SOFER.company_id = cid; OTHER.company_id = otherCid;
    await pool.query("INSERT INTO users (nume,email,pozicio,password_hash,company_id) VALUES ($1,$2,'Sofer','x',$3)", [SOFER.nume, SOFER.email, cid]);
    await pool.query("INSERT INTO users (nume,email,pozicio,password_hash,company_id) VALUES ($1,$2,'Admin','x',$3)", [OTHER.nume, OTHER.email, otherCid]);
  });

  async function cross(tip, at) {
    const r = await pool.query(
      'INSERT INTO border_crossings (email_sofer, nume_sofer, tip, tara, created_at) VALUES ($1,$2,$3,$4,$5::timestamptz) RETURNING id',
      [SOFER.email, SOFER.nume, tip, 'RO', at.toISOString()]);
    return r.rows[0].id;
  }

  test('sofőr módosítja a sajátját: irány + időpont, eredeti megőrizve, lista újrarendezve', async () => {
    const a = await cross('Iesire', daysAgo(5));
    const b = await cross('Intrare', daysAgo(3));
    const newAt = daysAgo(1);
    const r = await call('borderCrossingUpdate', SOFER, { id: a, tip: 'Intrare', at: newAt.toISOString() });
    expect(r.ok).toBe(true);
    const row = (await pool.query('SELECT * FROM border_crossings WHERE id=$1', [a])).rows[0];
    expect(row.tip).toBe('Intrare');
    expect(row.orig_tip).toBe('Iesire');
    expect(row.edit_count).toBe(1);
    expect(row.edited_by).toBe(SOFER.email);
    expect(new Date(row.orig_created_at).getTime()).toBe(daysAgo(5).getTime());

    // Második módosítás: az ERedeti marad
    await call('borderCrossingUpdate', SOFER, { id: a, tip: 'Iesire' });
    const row2 = (await pool.query('SELECT * FROM border_crossings WHERE id=$1', [a])).rows[0];
    expect(row2.orig_tip).toBe('Iesire');
    expect(row2.edit_count).toBe(2);

    const list = await call('getBorderLogs', SOFER);
    expect(list.map((x) => x.id)).toEqual([a, b]);          // a módosított (legújabb) elöl
    expect(list[0].edited_at).toBeTruthy();
    expect(list[0].can_edit).toBe(true);
  });

  test('két azonos irányú átlépés egymás után → seq_warn', async () => {
    await cross('Iesire', daysAgo(6));
    const second = await cross('Iesire', daysAgo(4));
    await cross('Intrare', daysAgo(2));
    const list = await call('getBorderLogs', ADMIN);
    const byId = Object.fromEntries(list.map((x) => [x.id, x]));
    expect(byId[second].seq_warn).toBe(true);
    expect(list.filter((x) => x.seq_warn)).toHaveLength(1);
  });

  test('jogosultság: más sofőr / más cég nem módosíthat; sofőr 30 napnál régebbit nem', async () => {
    const a = await cross('Iesire', daysAgo(2));
    const stranger = { id: 9, email: 'idegen@x.hu', nume: 'X', pozicio: 'Sofer', company_id: cid };
    expect((await call('borderCrossingUpdate', stranger, { id: a, tip: 'Intrare' })).ok).toBe(false);
    expect((await call('borderCrossingUpdate', OTHER, { id: a, tip: 'Intrare' })).ok).toBe(false);
    expect((await call('borderCrossingUpdate', ADMIN, { id: a, tip: 'Intrare' })).ok).toBe(true);

    const old = await cross('Intrare', daysAgo(45));
    expect((await call('borderCrossingUpdate', SOFER, { id: old, tip: 'Iesire' })).ok).toBe(false);
    expect((await call('borderCrossingUpdate', ADMIN, { id: old, tip: 'Iesire' })).ok).toBe(true);
  });

  test('érvénytelen bemenet: jövőbeli dátum, ismeretlen irány', async () => {
    const a = await cross('Iesire', daysAgo(2));
    const fut = new Date(Date.now() + 3600000).toISOString();
    expect((await call('borderCrossingUpdate', SOFER, { id: a, at: fut })).ok).toBe(false);
    expect((await call('borderCrossingUpdate', SOFER, { id: a, tip: 'X' })).ok).toBe(false);
  });

  test('a menetlevél diurnája újraszámolódik, a kézzel felülírt nem', async () => {
    const dep = daysAgo(6, 6), arr = daysAgo(1, 20);
    const out = await cross('Iesire', daysAgo(5, 9));
    await cross('Intrare', daysAgo(2, 9));
    const { calculateDiurna } = require('../../lib/diurna');
    const { fetchTripCrossings } = require('../../lib/tripCrossings');
    const tc = await fetchTripCrossings(pool, SOFER.email, dep.toISOString(), arr.toISOString());
    const c0 = calculateDiurna(dep.toISOString(), arr.toISOString(), tc.forCalc);
    await pool.query(
      `INSERT INTO fuvarlevelek (id, email_sofer, nume_sofer, indulas_dt, erkezes_dt, diurna_externa, diurna_interna, company_id)
       VALUES ('FUV-A',$1,$2,$3,$4,$5,$6,$7), ('FUV-B',$1,$2,$3,$4,99,0,$7)`,
      [SOFER.email, SOFER.nume, dep.toISOString(), arr.toISOString(), c0.externDays, c0.internDays, cid]);

    // A kilépést 2 nappal korábbra tesszük → több külföldi nap
    const r = await call('borderCrossingUpdate', ADMIN, { id: out, at: daysAgo(5, 23).toISOString() });
    expect(r.ok).toBe(true);
    const r2 = await call('borderCrossingUpdate', ADMIN, { id: out, at: daysAgo(4, 9).toISOString() });
    expect(r2.ok).toBe(true);
    const tc2 = await fetchTripCrossings(pool, SOFER.email, dep.toISOString(), arr.toISOString());
    const c2 = calculateDiurna(dep.toISOString(), arr.toISOString(), tc2.forCalc);
    expect(c2.externDays).not.toBe(c0.externDays);
    const rows = (await pool.query("SELECT id, diurna_externa, hataratok FROM fuvarlevelek ORDER BY id")).rows;
    expect(Number(rows[0].diurna_externa)).toBe(c2.externDays);
    expect(Array.isArray(rows[0].hataratok) && rows[0].hataratok.length).toBe(2);
    expect(Number(rows[1].diurna_externa)).toBe(99);       // kézi felülírás érintetlen
  });
});
