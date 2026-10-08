jest.mock('../../db', () => ({ query: jest.fn() }));
const pool = require('../../db');
const co = require('../../lib/chatOps');

const req = { session: { user: { company_id: 7, id: 1, pozicio: 'Admin', email: 'a@a' } } };

describe('chat: dokumentum feltöltése fuvarhoz (AI nélkül)', () => {
  beforeEach(() => pool.query.mockReset());

  test('dokumentum-típus a szövegből', () => {
    expect(co._docType('szamlat kell feltoltenem')).toBe('invoice');
    expect(co._docType('cmr feltoltes')).toBe('cmr');
    expect(co._docType('fotot toltok fel')).toBe('pod');
  });

  test('„legutóbb befejezett Vesna" → az ügyfél utolsó lezárt fuvarja, cégre szűrve, gombbal', async () => {
    pool.query.mockImplementation(async (sql, p) => {
      if (/FROM clients/.test(sql)) return { rows: [{ id: 3, denumire: 'VESNA TRANS SRL' }] };
      if (/FROM orders o/.test(sql)) {
        expect(p[0]).toBe(7);
        expect(sql).toMatch(/o\.company_id = \$1/);
        expect(sql).toMatch(/status = 'Finalizat'/);
        expect(sql).toMatch(/finalized_at DESC/);
        return { rows: [{ id: 'X1', fuvar_no: 'CMD-2026-0042', client: 'VESNA TRANS SRL', status: 'Finalizat', loc_incarcare: 'Cluj', loc_descarcare: 'Arad' }] };
      }
      return { rows: [] };
    });
    const r = await co.answer(req, 'Szamlat kell feltolsek egy fuvarhoz a legutobb befejezett vesna cegnek', [], 'hu');
    expect(r.kind).toBe('doc_upload');
    expect(r.html).toContain('data-oid="X1"');
    expect(r.html).toContain('data-dt="invoice"');
    expect(r.html).toContain('OrderChat.docUp(this)');
  });

  test('nincs találat → feltöltő ablak gomb fuvar nélkül', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    const r = await co.answer(req, 'cmr-t kell feltöltenem', [], 'hu');
    expect(r.kind).toBe('doc_upload');
    expect(r.html).not.toContain('data-oid');
  });

  test('feltöltés-szó nélkül nem veszi el a számlaszám-műveletet', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    const r = await co.answer(req, 'add hozzá a számlaszámot FCT-123', [], 'hu');
    expect(!r || r.kind !== 'doc_upload').toBe(true);
  });
});
