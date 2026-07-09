// ============================================================
//  Cég & arculat + fuvar-sorozat + PDF-sablon beállítások
//
//  Handlerek:
//   - getCompanySettings / saveCompanySettings (Admin ír)
//   - orderSeriesList / orderSeriesSave / orderSeriesSetDefault /
//     orderSeriesDelete (Admin ír, MT foglalt prefix, prefix-formátum,
//     alapértelmezett-védelem törlésnél, tranzakció-alapú műveletek)
//   - pdfTemplateList / pdfTemplateGet / pdfTemplateSave (Admin ír,
//     doc_type + akcent-szín whitelist)
// ============================================================
jest.mock('../../db', () => require('../helpers/db-mock').pool);

const request = require('supertest');
const express = require('express');
const { pool, rows, reset } = require('../helpers/db-mock');
const { setUser, sessionMiddleware, fixtures } = require('../helpers/session-mock');

// Az orderSeriesSave és orderSeriesSetDefault pool.connect()-et használ
// (tranzakció). Bővítjük a mockot, hogy adjon vissza egy „client"-et,
// aminek a query hívása a fő pool.query-re irányul, hogy ne kelljen külön
// mockolni.
const dbMock = require('../helpers/db-mock');
dbMock.pool.connect = jest.fn(() => Promise.resolve({
  query: (...a) => dbMock.pool.query(...a),
  release: () => {},
}));

const request2 = require('supertest'); // supertest tömörítve
const request_ = request2;

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(sessionMiddleware);
app.use(require('../../routes/execute'));

function call(fn, args) {
  return request_(app).post('/api/execute').send({ functionName: fn, arguments: args });
}

const CID = 1;
const ADMIN = { ...fixtures.admin, company_id: CID };
const MANAGER = { ...fixtures.manager, company_id: CID };

beforeEach(() => reset());

// ═══ getCompanySettings ══════════════════════════════════════
describe('getCompanySettings', () => {
  test('Manager olvashat (canEdit=false)', async () => {
    setUser(MANAGER);
    pool.query
      .mockResolvedValueOnce(rows([{ nev: 'Cég Kft', eur_ron_rate: 4.98 }]))
      .mockResolvedValueOnce(rows([{ brand_color: '#f6711e', pdf_header_text: 'Cég Kft', logo_mime: 'image/png', has_logo: true, updated_at: '2026-01-01' }]))
      .mockResolvedValueOnce(rows([{ prefix: 'MT', current_seq: 42 }]));
    const res = await call('getCompanySettings', []);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.companyName).toBe('Cég Kft');
    expect(res.body.result.brandColor).toBe('#f6711e');
    expect(res.body.result.eurRonRate).toBe(4.98);
    expect(res.body.result.waybillPrefix).toBe('MT');
    expect(res.body.result.waybillSeq).toBe(42);
    expect(res.body.result.canEdit).toBe(false);
  });

  test('Admin: canEdit=true', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([{ nev: 'X', eur_ron_rate: null }]))
      .mockResolvedValueOnce(rows([]))
      .mockResolvedValueOnce(rows([]));
    const res = await call('getCompanySettings', []);
    expect(res.body.result.canEdit).toBe(true);
    expect(res.body.result.waybillPrefix).toBe('MT'); // default
  });
});

// ═══ saveCompanySettings ═════════════════════════════════════
describe('saveCompanySettings', () => {
  test('Manager NEM írhat', async () => {
    setUser(MANAGER);
    const res = await call('saveCompanySettings', [{ brandColor: '#f6711e' }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/interzis/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('érvénytelen hex-szín elutasít', async () => {
    setUser(ADMIN);
    const res = await call('saveCompanySettings', [{ brandColor: 'nem_hex' }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/culoare invalid/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('érvénytelen EUR/RON ráta (túl nagy) elutasít', async () => {
    setUser(ADMIN);
    const res = await call('saveCompanySettings', [{ eurRonRate: 999 }]);
    expect(res.body.result.err).toMatch(/Curs EUR\/RON invalid/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('érvénytelen EUR/RON ráta (nem szám) elutasít', async () => {
    setUser(ADMIN);
    const res = await call('saveCompanySettings', [{ eurRonRate: 'abc' }]);
    expect(res.body.result.err).toMatch(/Curs EUR\/RON invalid/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('sikeres mentés: branding + companies + document_series (MT prefix)', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce({ rowCount: 1 }) // company_branding UPSERT
      .mockResolvedValueOnce({ rowCount: 1 }) // companies eur_ron_rate
      .mockResolvedValueOnce({ rowCount: 1 }) // document_series UPSERT
      .mockResolvedValueOnce({ rowCount: 1 }); // audit
    const res = await call('saveCompanySettings', [{
      brandColor: '#f6711e', pdfHeaderText: 'Cég Kft',
      eurRonRate: 4.98, waybillPrefix: 'MT',
    }]);
    expect(res.body.result.ok).toBe(true);
    const sqls = pool.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /INSERT INTO company_branding.*ON CONFLICT/is.test(s))).toBe(true);
    expect(sqls.some((s) => /UPDATE companies SET eur_ron_rate/i.test(s))).toBe(true);
    expect(sqls.some((s) => /INSERT INTO document_series/i.test(s))).toBe(true);
  });

  test('hex-szín kis-nagybetű normalizálva', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 });
    await call('saveCompanySettings', [{ brandColor: '#F6711E' }]);
    // A branding UPSERT $2 = brand_color, kisbetűs
    expect(pool.query.mock.calls[0][1][1]).toBe('#f6711e');
  });
});

// ═══ orderSeriesList ═════════════════════════════════════════
describe('orderSeriesList', () => {
  test('Manager olvashatja (canEdit=false)', async () => {
    setUser(MANAGER);
    // getDefaultSeries(pool, cid) — belül SELECT + esetleg INSERT-eket futtat.
    // Több oda-vissza query lehet — general-purpose mocks resolveValue-t adunk.
    pool.query.mockResolvedValue(rows([{ id: 1, prefix: 'CMD', seq_key: 'CMD', is_default: true, current_seq: 5 }]));
    const res = await call('orderSeriesList', []);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.canEdit).toBe(false);
    expect(res.body.result.series).toBeDefined();
  });
});

// ═══ orderSeriesSave ═════════════════════════════════════════
describe('orderSeriesSave', () => {
  test('Manager NEM írhat', async () => {
    setUser(MANAGER);
    const res = await call('orderSeriesSave', [{ prefix: 'X' }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/interzis/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('érvénytelen prefix (túl hosszú)', async () => {
    setUser(ADMIN);
    const res = await call('orderSeriesSave', [{ prefix: 'ABCDEFGHIJK' }]);
    expect(res.body.result.err).toMatch(/Prefix invalid/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('érvénytelen prefix (kisbetű normalizálva, de speciális karakter)', async () => {
    setUser(ADMIN);
    const res = await call('orderSeriesSave', [{ prefix: 'AB-CD' }]);
    expect(res.body.result.err).toMatch(/Prefix invalid/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('MT foglalt prefix elutasít', async () => {
    setUser(ADMIN);
    const res = await call('orderSeriesSave', [{ prefix: 'MT' }]);
    expect(res.body.result.err).toMatch(/rezervat/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('duplikált prefix (a cégen belül)', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([{ '?column?': 1 }])); // van már ilyen prefix
    const res = await call('orderSeriesSave', [{ prefix: 'CMD' }]);
    expect(res.body.result.err).toMatch(/deja/i);
  });
});

// ═══ orderSeriesDelete ═══════════════════════════════════════
describe('orderSeriesDelete', () => {
  test('érvénytelen ID', async () => {
    setUser(ADMIN);
    const res = await call('orderSeriesDelete', [{ id: 'abc' }]);
    expect(res.body.result.err).toMatch(/ID invalid/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('alapértelmezett széria NEM törölhető', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([{ prefix: 'CMD', is_default: true }]));
    const res = await call('orderSeriesDelete', [{ id: 1 }]);
    expect(res.body.result.err).toMatch(/implicita/i);
    // Nem futott a DELETE
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test('nem lét — „Seria nu a fost gasita"', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([]));
    const res = await call('orderSeriesDelete', [{ id: 999 }]);
    expect(res.body.result.err).toMatch(/gasita/i);
  });

  test('sikeres törlés (nem default)', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([{ prefix: 'ALT', is_default: false }]))
      .mockResolvedValueOnce({ rowCount: 1 }) // DELETE
      .mockResolvedValueOnce({ rowCount: 1 }); // audit
    const res = await call('orderSeriesDelete', [{ id: 2 }]);
    expect(res.body.result.ok).toBe(true);
    const sqls = pool.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /DELETE FROM order_series/i.test(s))).toBe(true);
  });
});

// ═══ pdfTemplateList ═════════════════════════════════════════
describe('pdfTemplateList', () => {
  test('Admin/Manager olvashat — az összes 4 doc_type visszaadva', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([
        { doc_type: 'order', header_text: 'X', footer_text: 'Y', accent_color: '#f6711e', show_logo: true },
      ]))
      .mockResolvedValueOnce(rows([{ brand_color: '#f6711e', has_logo: true }]));
    const res = await call('pdfTemplateList', []);
    expect(res.body.result.ok).toBe(true);
    // 4 doc_type: order, waybill, cmr, invoice_note
    expect(res.body.result.templates).toHaveLength(4);
    expect(res.body.result.templates[0].doc_type).toBe('order');
    expect(res.body.result.templates[0].header_text).toBe('X');
    // A hiányzó típusokra alapértelmezett show_logo=true
    expect(res.body.result.templates[1].show_logo).toBe(true);
    expect(res.body.result.canEdit).toBe(true);
  });
});

// ═══ pdfTemplateGet ══════════════════════════════════════════
describe('pdfTemplateGet', () => {
  test('érvénytelen doc_type', async () => {
    setUser(ADMIN);
    const res = await call('pdfTemplateGet', ['NEM_LEHETSEGES']);
    expect(res.body.result.err).toMatch(/document invalid/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('mind a 4 érvényes doc_type elfogadva', async () => {
    for (const dt of ['order', 'waybill', 'cmr', 'invoice_note']) {
      reset();
      setUser(ADMIN);
      pool.query.mockResolvedValueOnce(rows([]));
      const res = await call('pdfTemplateGet', [dt]);
      expect(res.body.result.ok).toBe(true);
      expect(res.body.result.template.doc_type).toBe(dt);
    }
  });
});

// ═══ pdfTemplateSave ═════════════════════════════════════════
describe('pdfTemplateSave', () => {
  test('Manager NEM írhat', async () => {
    setUser(MANAGER);
    const res = await call('pdfTemplateSave', [{ docType: 'order' }]);
    expect(res.body.result.err).toMatch(/interzis/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('érvénytelen doc_type', async () => {
    setUser(ADMIN);
    const res = await call('pdfTemplateSave', [{ docType: 'INVALID' }]);
    expect(res.body.result.err).toMatch(/document invalid/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('érvénytelen akcent-szín', async () => {
    setUser(ADMIN);
    const res = await call('pdfTemplateSave', [{
      docType: 'order', accentColor: 'not_hex',
    }]);
    expect(res.body.result.err).toMatch(/culoare invalid/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('sikeres UPSERT — ON CONFLICT(company_id, doc_type)', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 }); // audit
    const res = await call('pdfTemplateSave', [{
      docType: 'waybill', headerText: 'H', footerText: 'F',
      accentColor: '#123456', showLogo: false,
    }]);
    expect(res.body.result.ok).toBe(true);
    const [sql] = pool.query.mock.calls[0];
    expect(String(sql)).toMatch(/INSERT INTO pdf_templates.*ON CONFLICT.*DO UPDATE/is);
  });
});
