// ============================================================
//  Dokumentumok — stampGet/Save, orderDocList/Get/SaveSigned,
//  fuvarlevelCreate, getFuvarlevelek (Admin vs Sofer szerep),
//  getFuvarlevelDetail, getFuvarlevelFieldSuggestions.
// ============================================================
jest.mock('../../db', () => require('../helpers/db-mock').pool);

const request = require('supertest');
const express = require('express');
const { pool, rows, reset } = require('../helpers/db-mock');
const { setUser, sessionMiddleware, fixtures } = require('../helpers/session-mock');

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

// ─── stampGet / stampSave ────────────────────────────────────
describe('bélyegző (stamp)', () => {
  test('stampGet: nincs tárolt bélyegző → base64:null', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([]));
    const res = await call('stampGet', []);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.base64).toBeNull();
  });

  test('stampGet: tárolt bélyegzőt visszaad', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([{ base64_png: 'PNG_DATA' }]));
    const res = await call('stampGet', []);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.base64).toBe('PNG_DATA');
  });

  test('stampSave: üres b64 elutasít', async () => {
    setUser(ADMIN);
    const res = await call('stampSave', [null]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/lipsa/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('stampSave: UPSERT sikeres', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce({ rowCount: 1 });
    const res = await call('stampSave', ['PNG_BASE64']);
    expect(res.body.result.ok).toBe(true);
    const [sql, params] = pool.query.mock.calls[0];
    expect(String(sql)).toMatch(/INSERT INTO stamps.*ON CONFLICT.*DO UPDATE/is);
    expect(params[0]).toBe(ADMIN.email);
  });
});

// ─── orderDocList ────────────────────────────────────────────
describe('orderDocList', () => {
  test('üres orderId → üres tömb', async () => {
    setUser(ADMIN);
    const res = await call('orderDocList', ['']);
    expect(res.body.result).toEqual([]);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('company_id + order_id-szűrt lista', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([
      { id: 1, file_name: 'megrendelo.pdf', has_signed: true },
    ]));
    const res = await call('orderDocList', ['CMD-1']);
    expect(res.body.result).toHaveLength(1);
    const [sql, params] = pool.query.mock.calls[0];
    expect(String(sql)).toMatch(/JOIN orders o.*company_id/is);
    expect(params).toEqual(['CMD-1', CID]);
  });
});

// ─── orderDocGet ─────────────────────────────────────────────
describe('orderDocGet', () => {
  test('érvénytelen docId', async () => {
    setUser(ADMIN);
    const res = await call('orderDocGet', ['abc']);
    expect(res.body.result.ok).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('nem lét → „Nu a fost gasit"', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([]));
    const res = await call('orderDocGet', [999]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/gasit/i);
  });

  test('signed nélkül a megfelelő ág (original)', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([{
      file_name: 'x.pdf', original_base64: 'ORIG', signed_base64: null,
    }]));
    const res = await call('orderDocGet', [5]);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.base64).toBe('ORIG');
    expect(res.body.result.fileName).toBe('x.pdf');
  });

  test('signed változat kérve, de nincs', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([{
      file_name: 'x.pdf', original_base64: 'ORIG', signed_base64: null,
    }]));
    const res = await call('orderDocGet', [5, 'signed']);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/varianta/i);
  });

  test('signed változat visszaadva', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([{
      file_name: 'x.pdf', original_base64: 'ORIG', signed_base64: 'SIGNED',
    }]));
    const res = await call('orderDocGet', [5, 'signed']);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.base64).toBe('SIGNED');
  });
});

// ─── orderDocSaveSigned ──────────────────────────────────────
describe('orderDocSaveSigned', () => {
  test('hiányzó adat', async () => {
    setUser(ADMIN);
    const res = await call('orderDocSaveSigned', [null, 'BASE64']);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/lipsa/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('nem lét (RETURNING üres) — cross-tenant védelem', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([]));
    const res = await call('orderDocSaveSigned', [999, 'BASE64']);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/gasit/i);
    const [sql] = pool.query.mock.calls[0];
    expect(String(sql)).toMatch(/UPDATE order_documents.*FROM orders o.*company_id/is);
  });

  test('sikeres mentés (RETURNING egy sor)', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([{ id: 5 }]));
    const res = await call('orderDocSaveSigned', [5, 'BASE64']);
    expect(res.body.result.ok).toBe(true);
  });
});

// ─── getFuvarlevelek ─────────────────────────────────────────
describe('getFuvarlevelek', () => {
  test('Sofer: csak a saját email-en szűrt', async () => {
    setUser(SOFER);
    pool.query.mockResolvedValueOnce(rows([
      { id: 'FUV-1', email_sofer: SOFER.email, total_km: 100 },
    ]));
    const res = await call('getFuvarlevelek', []);
    expect(res.body.result).toHaveLength(1);
    // 1 query, sofőr-emailre szűrve
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query.mock.calls[0][1]).toEqual([SOFER.email]);
  });

  test('Admin: 2 lépés — email-lista + menetlevél-lista', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([{ email: 'a@a.hu' }, { email: 'b@b.hu' }])) // sofőr-emailek
      .mockResolvedValueOnce(rows([                                             // menetlevelek
        { id: 'FUV-1', email_sofer: 'a@a.hu' },
        { id: 'FUV-2', email_sofer: 'b@b.hu' },
      ]));
    const res = await call('getFuvarlevelek', []);
    expect(res.body.result).toHaveLength(2);
    // 2. hívás email-tömbre
    expect(pool.query.mock.calls[1][1][0]).toEqual(['a@a.hu', 'b@b.hu']);
  });

  test('Admin, üres user-lista → a company_id horgony miatt is lekérdez (törölt sofőr menetlevele)', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([]))   // sofőr-emailek: üres (pl. minden sofőr törölve)
      .mockResolvedValueOnce(rows([]));  // menetlevelek: company_id-re szűrve
    const res = await call('getFuvarlevelek', []);
    expect(res.body.result).toEqual([]);
    // A 2. lekérdezés ekkor is lefut (company_id = cég), hogy a törölt sofőrök
    // menetlevelei ne vesszenek el; a 2. hívás paramétere [emails, company_id].
    expect(pool.query).toHaveBeenCalledTimes(2);
    expect(pool.query.mock.calls[1][1][1]).toBe(ADMIN.company_id);
  });
});

// ─── fuvarlevelCreate ────────────────────────────────────────
describe('fuvarlevelCreate', () => {
  test('Sofer nem hívhatja', async () => {
    setUser(SOFER);
    const res = await call('fuvarlevelCreate', [{ nume_sofer: 'X' }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/interzis/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('nume_sofer nélkül elutasít', async () => {
    setUser(ADMIN);
    const res = await call('fuvarlevelCreate', [{}]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/Numele soferului/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('sikeres létrehozás — auto MT sorszám', async () => {
    setUser(ADMIN);
    pool.query
      // Nincs kiválasztott email_sofer, tehát nincs user-check.
      .mockResolvedValueOnce(rows([{ prefix: 'MT', current_seq: 42 }])) // document_series UPSERT
      .mockResolvedValueOnce({ rowCount: 1 }); // INSERT fuvarlevelek
    const res = await call('fuvarlevelCreate', [{
      nume_sofer: 'Teszt Sofor', km_inceput: 100, km_sfarsit: 500,
    }]);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.docNumber).toMatch(/^MT-\d{4}-0042$/);
    expect(res.body.result.total_km).toBe(400);
  });

  test('kiválasztott email_sofer + saját cég user → azt használjuk', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([{ email: 'sofer@cegA.hu' }])) // user-lookup
      .mockResolvedValueOnce(rows([{ prefix: 'MT', current_seq: 1 }]))
      .mockResolvedValueOnce({ rowCount: 1 });
    const res = await call('fuvarlevelCreate', [{
      nume_sofer: 'Sofor', email_sofer: 'SOFER@cegA.hu',
    }]);
    expect(res.body.result.ok).toBe(true);
    // Az INSERT-be a felismert email kerül (email_sofer $3 = 'sofer@cegA.hu')
    const insertParams = pool.query.mock.calls[2][1];
    expect(insertParams[2]).toBe('sofer@cegA.hu');
  });

  test('kiválasztott email_sofer, de NEM a saját cég usere → a létrehozó emailje kerül', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([])) // user-lookup üres (más cégé v. nem lét)
      .mockResolvedValueOnce(rows([{ prefix: 'MT', current_seq: 5 }]))
      .mockResolvedValueOnce({ rowCount: 1 });
    const res = await call('fuvarlevelCreate', [{
      nume_sofer: 'Sofor', email_sofer: 'external@other.hu',
    }]);
    expect(res.body.result.ok).toBe(true);
    // A tenant-horgony a létrehozó (Admin) e-mailje
    const insertParams = pool.query.mock.calls[2][1];
    expect(insertParams[2]).toBe(ADMIN.email);
  });

  test('kézi numar_fisa megőrizve — nincs auto-sorszám', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce({ rowCount: 1 }); // csak az INSERT
    const res = await call('fuvarlevelCreate', [{
      nume_sofer: 'X', numar_fisa: 'CUSTOM-001',
    }]);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.docNumber).toBe('CUSTOM-001');
    // 1 query — document_series NEM futott, mert kézi sorszám
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test('total_km számolás: kmSf > kmInc', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([{ prefix: 'MT', current_seq: 1 }]))
      .mockResolvedValueOnce({ rowCount: 1 });
    const res = await call('fuvarlevelCreate', [{
      nume_sofer: 'X', km_inceput: 1000, km_sfarsit: 800, // fordított
    }]);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.total_km).toBe(0); // Math.max(0, kmSf - kmInc)
  });
});
