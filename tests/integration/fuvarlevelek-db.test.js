// ============================================================
//  VALÓDI DB integráció — menetlevelek (fuvarlevelek) teljes út:
//   - POST /api/fuvarlevel-save  (generálás/„feltöltés" — indulas_dt/
//     erkezes_dt/hataratok oszlopokkal → migráció-drift őr)
//   - GET  /api/pdf-download/:id (REGRESSZIÓ: companies.nev join — a
//     korábbi c.denumire bug ezt 500-ra vitte, üres adattal)
//   - getFuvarlevelek / getFuvarlevelDetail / fuvarlevelUpdate
//   - getFuvarlevelFieldSuggestions (autocomplete: distinct + szerep-
//     védelem + cross-tenant izoláció)
//  Csak DATABASE_URL mellett fut (CI Postgres service); enélkül skip.
// ============================================================
const { loadSchema, truncateAll, hasDb } = require('../helpers/real-db');

const request = require('supertest');
const express = require('express');
const { setUser, sessionMiddleware } = require('../helpers/session-mock');

const pool = require('../../db');                  // VALÓDI pool
const documents = require('../../handlers/documents');

function makeRes() {
  const res = { body: null, statusCode: 200 };
  res.json = (o) => { res.body = o; return res; };
  res.status = (c) => { res.statusCode = c; return res; };
  return res;
}
const reqAs = (user) => ({ session: { user } });

const d = hasDb() ? describe : describe.skip;

d('Valódi DB integráció (menetlevelek)', () => {
  jest.setTimeout(40000);
  let app, companyId, otherId;
  const ADMIN = { id: 1, email: 'admin@x.hu', nume: 'Admin A', pozicio: 'Admin' };
  const SOFER = { id: 2, email: 'sofer@x.hu', nume: 'Kovacs Bela', pozicio: 'Sofer' };

  beforeAll(async () => {
    await loadSchema(pool);
    app = express();
    app.use(express.json({ limit: '20mb' }));
    app.use(sessionMiddleware);
    app.use(require('../../routes/soferApi'));
  });
  afterAll(async () => { await pool.end(); });

  beforeEach(async () => {
    await truncateAll(pool);
    const c = await pool.query("INSERT INTO companies (nev) VALUES ('Teszt Kft') RETURNING id");
    companyId = c.rows[0].id;
    const c2 = await pool.query("INSERT INTO companies (nev) VALUES ('Masik Kft') RETURNING id");
    otherId = c2.rows[0].id;
    ADMIN.company_id = companyId; SOFER.company_id = companyId;
    await pool.query(
      "INSERT INTO users (nume, email, pozicio, password_hash, company_id) VALUES ($1,$2,'Sofer','x',$3)",
      [SOFER.nume, SOFER.email, companyId]);
  });

  // ---- helper: egy menetlevél beszúrása a sofőrhöz ----
  async function seedWaybill(over = {}) {
    const o = Object.assign({
      id: 'FUV-SEED1', file_name: 'menetlevel.pdf', email_sofer: SOFER.email, nume_sofer: SOFER.nume,
      numar_camion: 'CJ01ABC', numar_remorca: 'CJ90REM', numar_fisa: 'MT-2026-0001',
      alte_mentiuni: 'Marfa fragila',
      puncte: '[{"tip":"Incarcare","loc":"Cluj-Napoca"}]',
      alimentari: '[{"loc":"OMV Oradea","tip":"Motorină","plata":"Card","litru":100}]',
      achizitii: '[{"loc":"Magazin Cluj","produs":"Manusi","plata":"Cash"}]',
    }, over);
    await pool.query(
      `INSERT INTO fuvarlevelek (id,file_name,email_sofer,nume_sofer,numar_camion,numar_remorca,numar_fisa,alte_mentiuni,puncte,alimentari,achizitii)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [o.id, o.file_name, o.email_sofer, o.nume_sofer, o.numar_camion, o.numar_remorca, o.numar_fisa, o.alte_mentiuni, o.puncte, o.alimentari, o.achizitii]);
    return o.id;
  }

  test('POST /api/fuvarlevel-save: menetlevél mentés (indulas/erkezes/hataratok oszlopokkal)', async () => {
    setUser(SOFER);
    const res = await request(app).post('/api/fuvarlevel-save').send({
      kmInceput: 1000, kmSfarsit: 1500,
      indulasDt: '2026-01-01T08:00', erkezesDt: '2026-01-03T18:00',
      hataratok: [{ data: '2026-01-01', dir: 'OUT' }],
      alimentari: [{ loc: 'OMV', litru: 200, plata: 'Card' }],
      puncte: [{ tip: 'Incarcare', loc: 'Cluj' }],
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const row = (await pool.query('SELECT total_km, indulas_dt, hataratok FROM fuvarlevelek WHERE id = $1', [res.body.id])).rows[0];
    expect(Number(row.total_km)).toBe(500);
    expect(row.indulas_dt).not.toBeNull();
  });

  test('GET /api/pdf-download/:id (Admin): 200 + a menetlevél + cégnév látszik (regresszió: companies.nev)', async () => {
    const id = await seedWaybill();
    setUser(ADMIN);
    const res = await request(app).get('/api/pdf-download/' + id);
    expect(res.status).toBe(200);                       // a régi c.denumire bug itt 500 volt
    expect(res.text).toContain('Teszt Kft');            // companies.nev a fejlécben
    expect(res.text).toContain('CJ01ABC');              // a menetlevél adatai
    expect(res.text).toContain('Cluj-Napoca');
  });

  test('GET /api/pdf-download/:id: ismeretlen id → 404, login nélkül → 401', async () => {
    setUser(ADMIN);
    const r404 = await request(app).get('/api/pdf-download/NINCS-ILYEN');
    expect(r404.status).toBe(404);
    setUser(null);
    const r401 = await request(app).get('/api/pdf-download/akarmi');
    expect(r401.status).toBe(401);
  });

  test('getFuvarlevelek (Admin): a cég sofőrjeinek menetlevelei jönnek', async () => {
    await seedWaybill();
    const res = makeRes();
    await documents.getFuvarlevelek(reqAs(ADMIN), res, []);
    expect(Array.isArray(res.body.result)).toBe(true);
    expect(res.body.result.length).toBe(1);
    expect(res.body.result[0].numar_fisa).toBe('MT-2026-0001');
  });

  test('getFuvarlevelDetail + fuvarlevelUpdate: kör + derivált mezők újraszámítása', async () => {
    const id = await seedWaybill();
    const det = makeRes();
    await documents.getFuvarlevelDetail(reqAs(ADMIN), det, [id]);
    expect(det.body.result.ok).toBe(true);

    const upd = makeRes();
    await documents.fuvarlevelUpdate(reqAs(ADMIN), upd, [id, {
      km_inceput: 100, km_sfarsit: 700,
      cant_inceput: 50, cant_sfarsit: 30,
      alimentari: [{ loc: 'X', litru: 40 }],
    }]);
    expect(upd.body.result.ok).toBe(true);
    expect(upd.body.result.total_km).toBe(600);
    // motorina = 50 + 40 - 30 = 60
    const row = (await pool.query('SELECT total_km, motorina_folosit FROM fuvarlevelek WHERE id = $1', [id])).rows[0];
    expect(Number(row.total_km)).toBe(600);
    expect(Number(row.motorina_folosit)).toBe(60);
  });

  test('getFuvarlevelFieldSuggestions: distinct értékek (top + JSONB), Sofer tiltva', async () => {
    await seedWaybill({ id: 'FUV-S1', numar_camion: 'CJ01ABC' });
    await seedWaybill({ id: 'FUV-S2', numar_camion: 'CJ02XYZ', alimentari: '[{"loc":"Petrom","tip":"AdBlue","plata":"Card"}]' });

    const res = makeRes();
    await documents.getFuvarlevelFieldSuggestions(reqAs(ADMIN), res, []);
    const sg = res.body.result;
    expect(sg.numar_camion.sort()).toEqual(['CJ01ABC', 'CJ02XYZ']);
    expect(sg.alim_tip).toEqual(expect.arrayContaining(['Motorină', 'AdBlue']));
    expect(sg.alim_plata).toEqual(['Card']);            // distinct (kétszer Card → egyszer)
    expect(sg.ach_produs).toEqual(['Manusi']);

    // Sofőr nem férhet hozzá (Admin/Manager-only)
    const sof = makeRes();
    await documents.getFuvarlevelFieldSuggestions(reqAs(SOFER), sof, []);
    expect(sof.body.result).toEqual({});
  });

  test('getFuvarlevelFieldSuggestions: nincs cross-tenant szivárgás', async () => {
    await seedWaybill({ numar_camion: 'CJ01ABC' });
    // másik cég sofőrje + menetlevele
    await pool.query("INSERT INTO users (nume,email,pozicio,password_hash,company_id) VALUES ('Titok','titok@y.ro','Sofer','x',$1)", [otherId]);
    await pool.query("INSERT INTO fuvarlevelek (id,file_name,email_sofer,nume_sofer,numar_camion) VALUES ('FUV-Y','y.pdf','titok@y.ro','Titok Ferenc','SECRET99')");

    const res = makeRes();
    await documents.getFuvarlevelFieldSuggestions(reqAs(ADMIN), res, []);
    const blob = JSON.stringify(res.body.result);
    expect(blob).not.toContain('SECRET99');
    expect(blob).not.toContain('Titok');
  });
});
