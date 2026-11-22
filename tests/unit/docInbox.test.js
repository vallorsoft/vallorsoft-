// lib/docInbox + handlers/docInbox — csoportos irat-feltöltés a menetlevelekhez.
jest.mock('../../db', () => ({ query: jest.fn() }));
const pool = require('../../db');
const { parseInvoiceText } = require('../../lib/invoiceText');
const chk = require('../../lib/waybillDocCheck');
const inbox = require('../../lib/docInbox');
const H = require('../../handlers/docInbox');

const OWN = '47859317';
const ORD_A = { id: 'A', fuvar_no: 'CMD-2026-0042', ref: 'PO-88123', client: 'Vesna GC SRL', client_denumire: 'VESNA GC SRL',
  client_cui: '25871352', carrier_id: null, pret: 1500, rendszam_camion: 'B104VLR',
  loc_incarcare: 'Arad', loc_descarcare: 'Cluj-Napoca', data_incarcare: '2026-10-01', data_descarcare: '2026-10-02' };
const ORD_B = { id: 'B', fuvar_no: 'CMD-2026-0043', ref: 'TX-5511', client: 'Dacia Log SRL', client_denumire: 'DACIA LOG SRL',
  client_cui: '11223344', carrier_id: 7, carrier_nev: 'Trans X SRL', carrier_cui: '99887766', pret: 2000, carrier_cost: 1700,
  loc_incarcare: 'Oradea', loc_descarcare: 'Sibiu' };
function doc(text) { const inv = parseInvoiceText(text); return { id: 1, text, inv, kind: chk.textKind(text, inv) }; }
const INV_A = 'Factura\nVLR 01079\nData emitere: 03.10.2026\nFurnizor\nVALLOR TEAM S.R.L.\nCUI: RO47859317\nClient\nVESNA GC SRL\n' +
  'CUI: RO25871352\nServicii transport Arad - Cluj-Napoca, comanda PO-88123, CMD-2026-0042\nTotal 1815,00 EUR';
const INV_B_CARRIER = 'FACTURA TRX 555\nData emitere: 05.10.2026\nFurnizor\nTRANS X SRL\nCUI: RO99887766\nClient\nVALLOR TEAM SRL\n' +
  'CUI: RO47859317\nTransport Oradea - Sibiu cmd CMD-2026-0043\nTotal 1700,00 EUR';
const FOREIGN = 'COMANDA DE TRANSPORT 777\nClient: ALTCEVA SRL CUI RO12121212\nTimisoara -> Constanta\nPret 3100 EUR';

const SLOTS = [
  { waybill_id: 'W1', order_id: 'A', slot: 'client_order' }, { waybill_id: 'W1', order_id: 'A', slot: 'client_invoice' },
  { waybill_id: 'W2', order_id: 'B', slot: 'client_invoice' }, { waybill_id: 'W2', order_id: 'B', slot: 'carrier_invoice' },
];
const ORDERS = { A: ORD_A, B: ORD_B };

describe('missingSlots', () => {
  test('csak a lerakott fuvarok hiányzó helyei', () => {
    const checks = [{ waybill_id: 'W1', detail: { orders: [
      { id: 'A', state: 'unloaded', slots: [{ slot: 'client_order', level: 'missing' }, { slot: 'client_invoice', level: 'ok' }] },
      { id: 'C', state: 'in_progress', slots: [{ slot: 'client_order', level: 'missing' }] },
    ] } }];
    expect(inbox.missingSlots(checks)).toEqual([{ waybill_id: 'W1', order_id: 'A', slot: 'client_order' }]);
    expect(inbox.missingSlots(null)).toEqual([]);
  });
});

describe('pickSlot', () => {
  test('ügyfél-számla → a saját fuvar számla-helye, automatikusan', () => {
    const r = inbox.pickSlot(doc(INV_A), SLOTS, ORDERS, OWN, null);
    expect(r.best).toMatchObject({ order_id: 'A', slot: 'client_invoice' });
    expect(r.auto).toBe(true);
  });
  test('alvállalkozó számlája → az alvállalkozói számla-hely', () => {
    const r = inbox.pickSlot(doc(INV_B_CARRIER), SLOTS, ORDERS, OWN, null);
    expect(r.best).toMatchObject({ order_id: 'B', slot: 'carrier_invoice' });
    expect(r.auto).toBe(true);
  });
  test('idegen irat → nincs automatikus párosítás', () => {
    const r = inbox.pickSlot(doc(FOREIGN), SLOTS, ORDERS, OWN, null);
    expect(r.auto).toBe(false);
  });
  test('két egyformán jó jelölt → nem automatikus (kis különbség)', () => {
    const A2 = Object.assign({}, ORD_A, { id: 'A2' });
    const r = inbox.pickSlot(doc('Factura\nTotal 1815,00 EUR\nVESNA GC SRL CUI RO25871352'),
      [{ waybill_id: 'W1', order_id: 'A', slot: 'client_invoice' }, { waybill_id: 'W3', order_id: 'A2', slot: 'client_invoice' }],
      { A: ORD_A, A2 }, OWN, null);
    expect(r.auto).toBe(false);
  });
});

describe('handlers — szerep-kapu és validáció', () => {
  const mkRes = () => { const res = { json: jest.fn() }; return res; };
  const req = (pozicio) => ({ session: { user: { pozicio, company_id: 5, email: 'a@b.ro' } }, headers: {}, ip: '1.1.1.1' });
  beforeEach(() => pool.query.mockReset());
  test.each(['docInboxUpload', 'docInboxList', 'docInboxAssign', 'docInboxDelete', 'docInboxRetry', 'docInboxProcess'])('%s: Sofer tiltva', async (fn) => {
    const res = mkRes();
    await H[fn](req('Sofer'), res, [{}]);
    expect(res.json.mock.calls[0][0].result.ok).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });
  test('upload: nem PDF/kép elutasítva', async () => {
    const res = mkRes();
    await H.docInboxUpload(req('Admin'), res, [{ file_name: 'x.exe', data: 'data:application/x-msdownload;base64,AAAA' }]);
    expect(res.json.mock.calls[0][0].result.ok).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });
  test('upload: PDF beszúrva a cégre', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ n: 0 }] }).mockResolvedValueOnce({ rows: [{ id: 11 }] }).mockResolvedValue({ rows: [] });
    const res = mkRes();
    await H.docInboxUpload(req('Manager'), res, [{ file_name: 'f.pdf', data: 'data:application/pdf;base64,JVBERi0=' }]);
    expect(res.json.mock.calls[0][0].result).toMatchObject({ ok: true, id: 11 });
    const ins = pool.query.mock.calls[1];
    expect(ins[0]).toMatch(/INSERT INTO waybill_doc_inbox/);
    expect(ins[1][0]).toBe(5);
  });
  test('delete: csak a saját cég sorát', async () => {
    pool.query.mockResolvedValue({ rows: [], rowCount: 1 });
    const res = mkRes();
    await H.docInboxDelete(req('Admin'), res, [{ id: 3 }]);
    const q = pool.query.mock.calls.find((c) => /DELETE FROM waybill_doc_inbox/.test(c[0]));
    expect(q[0]).toMatch(/company_id\s*=\s*\$/);
    expect(q[1]).toContain(5);
  });
});
