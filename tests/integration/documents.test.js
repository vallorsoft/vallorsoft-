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

// ─── fuvarlevelDelete (Admin/Manager, cascade waybilled_at + audit) ──
describe('fuvarlevelDelete', () => {
  test('Sofer nem hívhatja', async () => {
    setUser(SOFER);
    const res = await call('fuvarlevelDelete', ['FUV-1']);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/interzis/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('id hiányzik → hibaüzenet', async () => {
    setUser(ADMIN);
    const res = await call('fuvarlevelDelete', [null]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/lipsa/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('nem lét / más cég → „Nu a fost gasit / acces interzis"', async () => {
    setUser(ADMIN);
    // ownership check — üres
    pool.query.mockResolvedValueOnce(rows([]));
    const res = await call('fuvarlevelDelete', ['FUV-OTHER']);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/acces interzis|gasit/i);
    // ownership check egyetlen SELECT — cégre szűrt
    expect(pool.query).toHaveBeenCalledTimes(1);
    const [sqlSel, paramsSel] = pool.query.mock.calls[0];
    expect(String(sqlSel)).toMatch(/SELECT .* FROM fuvarlevelek/is);
    expect(String(sqlSel)).toMatch(/company_id = \$2/);
    expect(paramsSel).toEqual(['FUV-OTHER', ADMIN.company_id]);
  });

  test('sikeres törlés — cascade: érintett fuvar EGYETLEN másik menetlevélen sem szerepel → order_stops.waybilled_at reset', async () => {
    setUser(ADMIN);
    pool.query
      // 1) ownership SELECT
      .mockResolvedValueOnce(rows([{ id: 'FUV-1', numar_fisa: 'MT-2026-0001', email_sofer: 'sofer@a.hu', order_ids: ['CMD-1'] }]))
      // 2) DELETE fuvarlevelek
      .mockResolvedValueOnce({ rowCount: 1 })
      // 3) "van-e másik menetlevél a CMD-1-re?" → nincs
      .mockResolvedValueOnce(rows([]))
      // 4) order_stops.waybilled_at reset
      .mockResolvedValueOnce({ rowCount: 3 })
      // 5) audit INSERT
      .mockResolvedValueOnce({ rowCount: 1 });
    const res = await call('fuvarlevelDelete', ['FUV-1']);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.id).toBe('FUV-1');
    expect(res.body.result.stops_reset).toBe(3);
    expect(res.body.result.released_orders).toEqual(['CMD-1']);
    // Cascade query — UPDATE order_stops … waybilled_at = NULL
    const [sqlUpd, paramsUpd] = pool.query.mock.calls[3];
    expect(String(sqlUpd)).toMatch(/UPDATE order_stops[\s\S]+waybilled_at = NULL/i);
    expect(paramsUpd).toEqual(['CMD-1', ADMIN.company_id]);
  });

  test('sikeres törlés — másik menetlevél MÉG hivatkozza a fuvart → stopok érintetlenek', async () => {
    setUser(MANAGER);
    pool.query
      // 1) ownership SELECT
      .mockResolvedValueOnce(rows([{ id: 'FUV-2', order_ids: ['CMD-9'] }]))
      // 2) DELETE fuvarlevelek
      .mockResolvedValueOnce({ rowCount: 1 })
      // 3) "van-e másik menetlevél a CMD-9-re?" → IGEN
      .mockResolvedValueOnce(rows([{ '?column?': 1 }]))
      // 4) audit INSERT
      .mockResolvedValueOnce({ rowCount: 1 });
    const res = await call('fuvarlevelDelete', ['FUV-2']);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.stops_reset).toBe(0);
    expect(res.body.result.released_orders).toEqual([]);
    // Nem futott UPDATE order_stops (csak SELECT + DELETE + SELECT másik + audit)
    const calls = pool.query.mock.calls.map(c => String(c[0]));
    expect(calls.some(s => /UPDATE order_stops/i.test(s))).toBe(false);
  });

  test('üres order_ids → csak fő törlés + audit', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([{ id: 'FUV-3', order_ids: [] }]))
      .mockResolvedValueOnce({ rowCount: 1 })
      // NINCS "másik menetlevél" lookup és NINCS UPDATE order_stops
      .mockResolvedValueOnce({ rowCount: 1 }); // audit
    const res = await call('fuvarlevelDelete', ['FUV-3']);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.stops_reset).toBe(0);
    // 3 query: SELECT + DELETE + audit
    expect(pool.query).toHaveBeenCalledTimes(3);
  });

  test('cross-tenant: idegen cég menetlevele nem törölhető', async () => {
    setUser({ ...ADMIN, company_id: 99 });
    // ownership SELECT — az idegen cégnek szűrve üres
    pool.query.mockResolvedValueOnce(rows([]));
    const res = await call('fuvarlevelDelete', ['FUV-FROM-CID-1']);
    expect(res.body.result.ok).toBe(false);
    // A SELECT `company_id = 99`-re fut
    expect(pool.query.mock.calls[0][1][1]).toBe(99);
    // Sem DELETE, sem cascade nem fut
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test('cascade hiba → a fő törlés sikeres marad (best-effort)', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([{ id: 'FUV-4', order_ids: ['CMD-A'] }])) // ownership
      .mockResolvedValueOnce({ rowCount: 1 })                                // DELETE
      .mockRejectedValueOnce(new Error('boom'))                              // "másik menetlevél" lekérés hasal
      .mockResolvedValueOnce({ rowCount: 1 });                               // audit
    const res = await call('fuvarlevelDelete', ['FUV-4']);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.stops_reset).toBe(0);
  });
});
