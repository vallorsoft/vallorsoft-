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

describe('chat: beszélgetés egy meglévő fuvarról (fókusz az előzményből)', () => {
  const ORDER = { id: 'X1', fuvar_no: 'CMD-2026-0047', client: 'VESNA GC SRL', status: 'Finalizat', loc_incarcare: 'Cluj', loc_descarcare: 'Arad', pret: 900 };
  const hist = ['📎 Dokumentum feltöltése fuvarhoz — #CMD-2026-0047', 'Az utolsó befejezett fuvar...'];
  beforeEach(() => {
    pool.query.mockReset();
    pool.query.mockImplementation(async (sql) => {
      if (/FROM orders o WHERE o.id = \$1/.test(sql)) return { rows: [ORDER] };
      if (/fuvar_no|FROM orders/.test(sql)) return { rows: [{ id: 'X1', fuvar_no: 'CMD-2026-0047' }] };
      if (/order_documents/.test(sql)) return { rows: [{ id: 5, doc_type: 'invoice', file_name: 'f.pdf', doc_date: '2026-10-05' }] };
      return { rows: [] };
    });
  });

  test('csak fuvarszám („A 47es") = fuvar-adatlap, nem új fuvar', () => {
    expect(co._isPureRef('A 47es')).toBe(true);
    expect(co._isPureRef('#47')).toBe(true);
    expect(co._isPureRef('a referencia 47 legyen és FTL')).toBe(false);
  });

  test('„ehhez a fuvarhoz egy megbízást hozzáadunk" → az előzmény fuvarjára, megbízás típussal', async () => {
    const r = await co.answer(req, 'Ehhez a fuvarhoz egy megbizast is hozaadunk', hist, 'hu');
    expect(r.kind).toBe('doc_upload');
    expect(r.focus).toBe(true);
    expect(r.html).toContain('data-oid="X1"');
    expect(r.html).toContain('data-dt="order"');
  });

  test('„hozd elő ehhez a fuvarhoz a dokumentumokat és az adatait" → adatlap + dokumentum-lista', async () => {
    const r = await co.answer(req, 'Hoz ele ehez a fuvarhoz a dokumentumokat es a fuvar adatait', hist, 'hu');
    expect(r.kind).toBe('order_view');
    expect(r.focus).toBe(true);
    expect(r.html).toContain('CMD-2026-0047');
    expect(r.html).toContain('OrderDocs.download');
  });

  test('utalás nélkül az előzmény fuvarja nem kerül át más kérdésre', async () => {
    const r = await co.answer(req, 'holnap Cluj felrakó, FTL', hist, 'hu');
    expect(!r || (r.kind !== 'order_view' && r.kind !== 'doc_upload')).toBe(true);
  });
});

describe('chat: rövid folytatás a fókuszban lévő fuvarról („és kifizetve")', () => {
  const ORDER = { id: 'X1', fuvar_no: 'CMD-2026-0047', client: 'VESNA GC SRL', status: 'Finalizat', pret: 900, paid_amount: 0 };
  const hist = ['✅ Kész.', '📎 Dokumentum feltöltése fuvarhoz — #CMD-2026-0047'];
  beforeEach(() => {
    pool.query.mockReset();
    pool.query.mockImplementation(async (sql, p) => {
      if (/FROM orders o WHERE o.id = \$1/.test(sql)) { expect(p[1]).toBe(7); return { rows: [ORDER] }; }
      if (/FROM orders/.test(sql)) return { rows: [{ id: 'X1', fuvar_no: 'CMD-2026-0047' }] };
      return { rows: [] };
    });
  });

  test.each(['Es kifizetve', 'A szamla lett kifizetve', 'și a fost plătită'])('%s → fizetés-kártya a fókusz-fuvarra, aktív vázlat mellett is', async (msg) => {
    const r = await co.answer(req, msg, hist, 'hu', new Date('2026-10-08T10:00:00'), { draftActive: true });
    expect(r.action).toBe('pay');
    expect(r.focus).toBe(true);
    expect(r.html).toContain('CMD-2026-0047');
  });

  test('„postáztuk" → post-delivery kártya a fókusz-fuvarra', async () => {
    const r = await co.answer(req, 'postán elküldtük', hist, 'hu', new Date('2026-10-08T10:00:00'), { draftActive: true });
    expect(r.action).toBe('pd');
    expect(r.focus).toBe(true);
  });

  test('fókusz-fuvar nélkül nem talál ki fuvart', async () => {
    const r = await co.answer(req, 'Es kifizetve', ['Szia'], 'hu', new Date('2026-10-08T10:00:00'), { draftActive: true });
    expect(!r || r.action !== 'pay').toBe(true);
  });
});
