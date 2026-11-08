// ============================================================
//  VALÓDI DB integráció — határátlépés AUTOMATIKUSAN a GPS-ből
//   - a gps_track_days pontsorából a felismerő (lib/borderAuto.js)
//     source='auto' sorokat ír (idő, koordináta, rendszám, sofőr)
//   - ismételt futás nem duplikál; az elvetett sort nem hozza vissza
//   - a menetlevél diurnája GPS-lefedettség mellett az AUTOMATA sorokból
//     számol, a sofőr gombnyomását figyelmen kívül hagyva
//   - GPS nélkül marad a régi (sofőr-gombos) számítás
//  Csak DATABASE_URL mellett fut; enélkül skip.
// ============================================================
const { loadSchema, truncateAll, hasDb } = require('../helpers/real-db');
const pool = require('../../db');
const documents = require('../../handlers/documents');
const borderAuto = require('../../lib/borderAuto');
const { fetchTripCrossings } = require('../../lib/tripCrossings');
const { calculateDiurna } = require('../../lib/diurna');

const d = hasDb() ? describe : describe.skip;
const call = async (fn, user, arg) => {
  const res = { body: null, json(o) { this.body = o; return this; } };
  await documents[fn]({ session: { user }, headers: {}, ip: '127.0.0.1' }, res, arg === undefined ? [] : [arg]);
  return res.body.result;
};

const ARAD = [46.18, 21.31], MAKO = [46.21, 20.48];
function track(a, b, n, t0) {
  const out = [];
  for (let i = 0; i <= n; i++) { const f = i / n; out.push([t0 + i * 60, a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, 70, 1]); }
  return out;
}
// 'YYYY-MM-DD' bukaresti nap kezdete (epoch mp) — nyári időszámítás, UTC+3
const dayStart = (day) => Date.parse(day + 'T00:00:00+03:00') / 1000;

d('Valódi DB — automatikus határátlépés a GPS-ből', () => {
  jest.setTimeout(60000);
  let cid;
  const SOFER = { email: 'sofer@x.ro', nume: 'Pop Ion', pozicio: 'Sofer' };
  const ADMIN = { email: 'admin@x.ro', nume: 'Admin', pozicio: 'Admin' };
  const PLATE = 'CV 10 VLR';

  beforeAll(async () => { await loadSchema(pool); });
  afterAll(async () => { await pool.end(); });
  beforeEach(async () => {
    await truncateAll(pool);
    await pool.query('TRUNCATE gps_track_days RESTART IDENTITY');
    cid = (await pool.query("INSERT INTO companies (nev) VALUES ('A SRL') RETURNING id")).rows[0].id;
    SOFER.company_id = cid; ADMIN.company_id = cid;
    await pool.query("INSERT INTO users (nume,email,pozicio,password_hash,company_id) VALUES ($1,$2,'Sofer','x',$3)", [SOFER.nume, SOFER.email, cid]);
    await pool.query("INSERT INTO users (nume,email,pozicio,password_hash,company_id) VALUES ($1,$2,'Admin','x',$3)", [ADMIN.nume, ADMIN.email, cid]);
    await pool.query("INSERT INTO vehicles (company_id, rendszam, tip, assigned_driver_email) VALUES ($1,$2,'Vontato',$3)", [cid, PLATE, SOFER.email]);
  });

  async function gpsDay(day, pts) {
    await pool.query(
      `INSERT INTO gps_track_days (company_id, rendszam, day, points_json, point_count, complete)
       VALUES ($1,$2,$3::date,$4,$5,true)`, [cid, PLATE, day, JSON.stringify(pts), pts.length]);
  }

  // Út: 2026-07-01 kimegy Makóra (07:00-tól), 2026-07-03 este visszajön
  async function seedTrip() {
    await gpsDay('2026-07-01', track(ARAD, MAKO, 60, dayStart('2026-07-01') + 7 * 3600));
    await gpsDay('2026-07-02', track(MAKO, [46.25, 20.15], 60, dayStart('2026-07-02') + 9 * 3600));
    await gpsDay('2026-07-03', track(MAKO, ARAD, 60, dayStart('2026-07-03') + 18 * 3600));
  }

  test('felismeri a KI + BE átlépést, sofőrhöz rendeli, ismételt futás nem duplikál', async () => {
    await seedTrip();
    const r = await borderAuto.scanRound({ vehicles: 10 });
    expect(r.inserted).toBe(2);
    const rows = (await pool.query("SELECT * FROM border_crossings WHERE source='auto' ORDER BY created_at")).rows;
    expect(rows.map((x) => x.tip)).toEqual(['Iesire', 'Intrare']);
    expect(rows[0].company_id).toBe(cid);
    expect(rows[0].rendszam).toBe(PLATE);
    expect(rows[0].email_sofer).toBe(SOFER.email);
    expect(rows[0].locatie).toMatch(/Nădlac/);
    // a kilépés román idő szerint 07:xx-kor (nem UTC 04:xx)
    const roHour = new Date(rows[0].created_at).toLocaleString('en-GB', { timeZone: 'Europe/Bucharest', hour: '2-digit', hour12: false });
    expect(roHour).toBe('07');

    // Újrafuttatás (a napok frissültek) → nincs duplikátum
    await pool.query('UPDATE gps_track_days SET updated_at = NOW() + INTERVAL \'1 minute\'');
    const r2 = await borderAuto.scanRound({ vehicles: 10 });
    expect(r2.inserted).toBe(0);
  });

  test('a diurna GPS-lefedettség mellett az automata sorokból számol, nem a sofőr gombjából', async () => {
    await seedTrip();
    await borderAuto.scanRound({ vehicles: 10 });
    // A sofőr ROSSZ időben nyomta a gombot (csak 07-02 este lépett ki szerinte)
    await pool.query("INSERT INTO border_crossings (email_sofer, nume_sofer, tip, tara, created_at) VALUES ($1,$2,'Iesire','RO','2026-07-02T19:00:00Z')", [SOFER.email, SOFER.nume]);

    const tc = await fetchTripCrossings(pool, SOFER.email, '2026-07-01T06:00', '2026-07-03T20:00', { companyId: cid, plate: 'CV10VLR' });
    expect(tc.mode).toBe('auto');
    expect(tc.inWindow.map((x) => x.direction)).toEqual(['OUT', 'IN']);
    expect(tc.inWindow.every((x) => x.source === 'auto')).toBe(true);
    const c = calculateDiurna('2026-07-01T06:00', '2026-07-03T20:00', tc.forCalc);
    expect(c.externDays).toBe(3);      // 07-01 12:00 / 07-02 / 07-03 12:00 — mindhárom kint

    // GPS nélküli (kézi) módban a sofőr gombja számítana
    const man = await fetchTripCrossings(pool, SOFER.email, '2026-07-01T06:00', '2026-07-03T20:00');
    expect(man.mode).toBe('manual');
    expect(man.inWindow).toHaveLength(1);
  });

  test('rendszám nélkül a sofőr kiosztott járművéből dolgozik; előnézet mode=auto', async () => {
    await seedTrip();
    await borderAuto.scanRound({ vehicles: 10 });
    const r = await call('previewTripDiurna', ADMIN, { indulasDt: '2026-07-01T06:00', erkezesDt: '2026-07-03T20:00' });
    // az admin e-mailje nem a sofőré → kézi mód; a sofőrével auto
    expect(r.mode).toBe('manual');
    const r2 = await call('previewTripDiurna', SOFER, { indulasDt: '2026-07-01T06:00', erkezesDt: '2026-07-03T20:00', camion: PLATE });
    expect(r2.mode).toBe('auto');
    expect(r2.crossings).toHaveLength(2);
    expect(r2.externDays).toBeUndefined();   // a sofőr nem lát napszámot
  });

  test('az iroda elveti az automata sort → nem számít, és a felismerő nem hozza vissza', async () => {
    await seedTrip();
    await borderAuto.scanRound({ vehicles: 10 });
    const id = (await pool.query("SELECT id FROM border_crossings WHERE source='auto' AND tip='Intrare'")).rows[0].id;
    const r = await call('borderCrossingDelete', ADMIN, { id });
    expect(r.ok).toBe(true);
    const row = (await pool.query('SELECT ignored FROM border_crossings WHERE id=$1', [id])).rows[0];
    expect(row.ignored).toBe(true);
    const logs = await call('getBorderLogs', ADMIN);
    expect(logs.find((x) => x.id === id)).toBeUndefined();
    expect(logs.some((x) => x.source === 'auto')).toBe(true);

    await pool.query('UPDATE gps_track_days SET border_scanned_at = NULL');
    const r2 = await borderAuto.scanRound({ vehicles: 10 });
    expect(r2.inserted).toBe(0);
  });

  test('módosított (áttett idejű) automata sort sem hozza vissza', async () => {
    await seedTrip();
    await borderAuto.scanRound({ vehicles: 10 });
    const id = (await pool.query("SELECT id, created_at FROM border_crossings WHERE source='auto' AND tip='Iesire'")).rows[0].id;
    const r = await call('borderCrossingUpdate', ADMIN, { id, at: '2026-07-01T12:00:00Z' });
    expect(r.ok).toBe(true);
    await pool.query('UPDATE gps_track_days SET border_scanned_at = NULL');
    expect((await borderAuto.scanRound({ vehicles: 10 })).inserted).toBe(0);
  });

  test('friss menetlevél diurnája az új automata átlépéssel magától frissül', async () => {
    const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
    const ds = (dd) => Date.parse(dd + 'T00:00:00Z') / 1000 - 2 * 3600;
    await gpsDay(day(4), track(ARAD, MAKO, 60, ds(day(4)) + 7 * 3600));
    await gpsDay(day(3), track(MAKO, [46.25, 20.15], 60, ds(day(3)) + 9 * 3600));
    await gpsDay(day(2), track(MAKO, ARAD, 60, ds(day(2)) + 18 * 3600));
    const dep = day(4) + 'T06:00', arr = day(2) + 'T20:00';
    // a menetlevél a felismerés ELŐTT mentődött: akkor még 0 kinti nap
    const pre = calculateDiurna(dep, arr, (await fetchTripCrossings(pool, SOFER.email, dep, arr, { companyId: cid, plate: PLATE })).forCalc);
    const w = (await pool.query(
      `INSERT INTO fuvarlevelek (id, email_sofer, nume_sofer, numar_camion, indulas_dt, erkezes_dt, diurna_externa, diurna_interna, company_id)
       VALUES ('FUV-T1',$1,$2,$3,$4::timestamptz,$5::timestamptz,$6,$7,$8) RETURNING id`,
      [SOFER.email, SOFER.nume, PLATE, dep + ':00+02:00', arr + ':00+02:00', pre.externDays, pre.internDays, cid])).rows[0].id;
    expect(pre.externDays).toBe(0);
    const r = await borderAuto.scanRound({ vehicles: 10 });
    expect(r.recalc).toBeGreaterThan(0);
    const after = (await pool.query('SELECT diurna_externa, hataratok FROM fuvarlevelek WHERE id=$1', [w])).rows[0];
    expect(after.diurna_externa).toBe(3);
    expect(after.hataratok).toHaveLength(2);
  });

  test('másik cég nem látja az automata sort', async () => {
    await seedTrip();
    await borderAuto.scanRound({ vehicles: 10 });
    const other = (await pool.query("INSERT INTO companies (nev) VALUES ('B SRL') RETURNING id")).rows[0].id;
    const logs = await call('getBorderLogs', { email: 'b@b.ro', pozicio: 'Admin', company_id: other });
    expect(logs).toHaveLength(0);
  });
});
