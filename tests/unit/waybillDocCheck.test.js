// lib/waybillDocCheck — menetlevél dokumentum-csomag ellenőrzése (helyben, AI nélkül).
jest.mock('../../db', () => ({ query: jest.fn() }));
const { parseInvoiceText } = require('../../lib/invoiceText');
const chk = require('../../lib/waybillDocCheck');

const OWN = '47859317';
const ORD_A = { id: 'A', fuvar_no: 'CMD-2026-0042', ref: 'PO-88123', client: 'Vesna GC SRL', client_denumire: 'VESNA GC SRL',
  client_cui: '25871352', carrier_id: null, pret: 1500, rendszam_camion: 'B104VLR',
  loc_incarcare: 'Arad, 310364, RO', loc_descarcare: 'Cluj-Napoca, RO', data_incarcare: '2026-10-01', data_descarcare: '2026-10-02' };
const ORD_B = { id: 'B', fuvar_no: 'CMD-2026-0043', ref: 'TX-5511', client: 'Dacia Log SRL', client_denumire: 'DACIA LOG SRL',
  client_cui: '11223344', carrier_id: 7, carrier_nev: 'Trans X SRL', carrier_cui: '99887766', pret: 2000, carrier_cost: 1700,
  rendszam_camion: 'CJ10ABC', loc_incarcare: 'Oradea, RO', loc_descarcare: 'Sibiu, RO', data_incarcare: '2026-10-03', data_descarcare: '2026-10-04' };
const ORD_C = { id: 'C', fuvar_no: 'CMD-2026-0044', ref: 'ZZ-1', client: 'Alt Client SRL', client_cui: '55554444', carrier_id: null,
  pret: 900, loc_incarcare: 'Brasov', loc_descarcare: 'Iasi' };

function doc(id, text, extra) {
  const inv = parseInvoiceText(text);
  return Object.assign({ id, file_name: 'd' + id + '.pdf', doc_type: '', order_id: null, text, inv, kind: chk.textKind(text, inv) }, extra || {});
}
const ORDER_A = 'COMANDA DE TRANSPORT nr. PO-88123\nBeneficiar: VESNA GC SRL CUI RO25871352\nTransportator: VALLOR TEAM SRL\n' +
  'Incarcare: Arad 01.10.2026\nDescarcare: Cluj-Napoca 02.10.2026\nPret: 1.500,00 EUR\nNr auto: B 104 VLR';
const INV_A = 'Factura\nVLR 01079\nData emitere: 03.10.2026\nFurnizor\nVALLOR TEAM S.R.L.\nCUI: RO47859317\nClient\nVESNA GC SRL\n' +
  'CUI: RO25871352\nServicii transport Arad - Cluj-Napoca, comanda PO-88123, CMD-2026-0042\nTotal 1815,00 EUR';
const ORDER_B_CLIENT = 'Comanda de transport TX-5511\nClient: DACIA LOG SRL CUI 11223344\nOradea -> Sibiu 03.10.2026\nPret 2000 EUR';
const ORDER_B_CARRIER = 'COMANDA DE TRANSPORT CMD-2026-0043\nCatre: TRANS X SRL CUI RO99887766\nIncarcare Oradea, descarcare Sibiu\nPret: 1700 EUR';
const INV_B_CARRIER = 'FACTURA TRX 555\nData emitere: 05.10.2026\nFurnizor\nTRANS X SRL\nCUI: RO99887766\nClient\nVALLOR TEAM SRL\n' +
  'CUI: RO47859317\nTransport Oradea - Sibiu cmd CMD-2026-0043\nTotal 1700,00 EUR';
const INV_B_CLIENT = 'FACTURA VLR 01080\nData emitere: 05.10.2026\nFurnizor\nVALLOR TEAM SRL\nCUI: RO47859317\nClient\nDACIA LOG SRL\nCUI: RO11223344\n' +
  'Transport ref TX-5511 Oradea - Sibiu\nTotal 2.420,00 EUR';
const FOREIGN = 'COMANDA DE TRANSPORT 777\nClient: ALTCEVA SRL CUI RO12121212\nTimisoara -> Constanta\nPret 3100 EUR';

describe('unloadedOrderIds — a menetlevélen szereplő lerakások', () => {
  test('3 fuvar: 1. fel+le, 2. fel+le, 3. csak felrakás → az első kettő kell', () => {
    const p = [
      { tip: 'Plecare' },
      { tip: 'Incarcare', orderId: 'A', role: 'loading' }, { tip: 'Descarcare', orderId: 'A', role: 'unloading' },
      { tip: 'Incarcare', orderId: 'B', role: 'loading' }, { tip: 'Descarcare', orderId: 'B', role: 'unloading' },
      { tip: 'Incarcare', orderId: 'C', role: 'loading' },
      { tip: 'Sosire' },
    ];
    expect(chk.unloadedOrderIds(p, {})).toEqual({ required: ['A', 'B'], legacy: false });
  });
  test('stopId-ből is felismeri a fuvart; jelöletlen pontok → legacy', () => {
    expect(chk.unloadedOrderIds([{ tip: 'Descarcare', stopId: 9 }], { 9: 'X' }).required).toEqual(['X']);
    expect(chk.unloadedOrderIds([{ tip: 'Descarcare', loc: 'Cluj' }], {}).legacy).toBe(true);
  });
});

describe('segéd-keresések', () => {
  test('összeg: nettó és bruttó (21%), ezres tagolással', () => {
    expect(chk.amountIn('Total 1.500,00 EUR', 1500)).toBe(true);
    expect(chk.amountIn('Total 1815,00', 1500)).toBe(true);
    expect(chk.amountIn('Total 15000', 1500)).toBe(false);
    expect(chk.amountIn('x', 0)).toBe(false);
  });
  test('irat-fajta a szövegből', () => {
    expect(chk.textKind(ORDER_A, parseInvoiceText(ORDER_A))).toBe('order');
    expect(chk.textKind(INV_A, parseInvoiceText(INV_A))).toBe('invoice');
    expect(chk.textKind('valami', parseInvoiceText('valami'))).toBeNull();
  });
});

describe('evaluate — a dokumentum-csomag', () => {
  test('saját sofőrös fuvar: megrendelő + számla → teljes', () => {
    const r = chk.evaluate({ orders: [ORD_A], requiredIds: ['A'], docs: [doc(1, ORDER_A), doc(2, INV_A)], ownCui: OWN });
    expect(r.status).toBe('complete');
    const s = r.orders[0].slots;
    expect(s.map((x) => x.slot)).toEqual(['client_order', 'client_invoice']);
    expect(s[0].doc_id).toBe(1);
    expect(s[1].doc_id).toBe(2);
    expect(s.every((x) => x.conf >= chk.OK_CONF)).toBe(true);
  });

  test('alvállalkozós fuvar: 4 irat kell, mindegyik a helyére kerül', () => {
    const r = chk.evaluate({ orders: [ORD_B], requiredIds: ['B'], ownCui: OWN,
      docs: [doc(1, ORDER_B_CLIENT), doc(2, ORDER_B_CARRIER), doc(3, INV_B_CARRIER), doc(4, INV_B_CLIENT)] });
    const by = {};
    r.orders[0].slots.forEach((s) => { by[s.slot] = s.doc_id; });
    expect(by).toEqual({ client_order: 1, client_invoice: 4, carrier_order: 2, carrier_invoice: 3 });
  });

  test('alvállalkozó nélkül az alvállalkozói iratok nem kellenek', () => {
    const r = chk.evaluate({ orders: [ORD_A], requiredIds: ['A'], docs: [], ownCui: OWN });
    expect(r.orders[0].slots.map((s) => s.slot)).toEqual(['client_order', 'client_invoice']);
    expect(r.missing_cnt).toBe(2);
  });

  test('a nem lerakott fuvar iratai nem kellenek, és folyamatban lévőként jelenik meg', () => {
    const r = chk.evaluate({ orders: [ORD_A, ORD_C], requiredIds: ['A'], docs: [doc(1, ORDER_A), doc(2, INV_A)], ownCui: OWN });
    expect(r.status).toBe('complete');
    const c = r.orders.find((o) => o.id === 'C');
    expect(c.state).toBe('in_progress');
    expect(c.slots).toEqual([]);
  });

  test('egy oda nem tartozó megrendelő kiszűrve; a hiány jelezve', () => {
    const r = chk.evaluate({ orders: [ORD_A], requiredIds: ['A'], docs: [doc(1, ORDER_A), doc(5, FOREIGN)], ownCui: OWN });
    expect(r.status).toBe('incomplete');
    expect(r.foreign.map((f) => f.doc_id)).toEqual([5]);
    expect(r.orders[0].slots.find((s) => s.slot === 'client_invoice').level).toBe('missing');
  });

  test('két megrendelő ugyanarra a fuvarra → a gyengébb „többlet"', () => {
    const dup = ORDER_A.replace('PO-88123', 'PO-88123 (copie)');
    const r = chk.evaluate({ orders: [ORD_A], requiredIds: ['A'], docs: [doc(1, ORDER_A), doc(2, INV_A), doc(3, dup)], ownCui: OWN });
    expect(r.extra.map((x) => x.reason)).toEqual(['duplicate']);
  });

  test('visszaigazolás: ✓ rögzít (100%), ✗ párt többé nem ajánl', () => {
    const weak = 'Comanda\nArad - Cluj-Napoca';
    const base = { orders: [ORD_A], requiredIds: ['A'], ownCui: OWN };
    const r0 = chk.evaluate(Object.assign({}, base, { docs: [doc(1, weak, { order_id: 'A' })] }));
    const s0 = r0.orders[0].slots.find((s) => s.slot === 'client_order');
    expect(s0.doc_id).toBe(1);
    expect(s0.level).not.toBe('ok');
    const r1 = chk.evaluate(Object.assign({}, base, { docs: [doc(1, weak, { order_id: 'A' })],
      decisions: [{ doc_id: 1, order_id: 'A', slot: 'client_order', verdict: 'ok' }] }));
    const s1 = r1.orders[0].slots.find((s) => s.slot === 'client_order');
    expect(s1.conf).toBe(100);
    expect(s1.level).toBe('ok');
    const r2 = chk.evaluate(Object.assign({}, base, { docs: [doc(1, weak, { order_id: 'A' })],
      decisions: [{ doc_id: 1, order_id: 'A', slot: 'client_order', verdict: 'no' }] }));
    expect(r2.orders[0].slots.find((s) => s.slot === 'client_order').level).toBe('missing');
  });

  test('nem olvasható (szkennelt) irat: a fuvarhoz kötött helyét elfoglalja, kézi megerősítéssel', () => {
    const scanned = { id: 9, file_name: 'scan.pdf', doc_type: 'invoice', order_id: 'A', text: '', inv: null, kind: 'invoice' };
    const r = chk.evaluate({ orders: [ORD_A], requiredIds: ['A'], docs: [doc(1, ORDER_A), scanned], ownCui: OWN });
    const s = r.orders[0].slots.find((x) => x.slot === 'client_invoice');
    expect(s.doc_id).toBe(9);
    expect(s.level).toBe('unreadable');
    expect(r.status).toBe('incomplete');
  });

  test('nincs lerakás a menetlevélen → nincs kötelező irat', () => {
    const r = chk.evaluate({ orders: [ORD_C], requiredIds: [], docs: [], ownCui: OWN });
    expect(r.status).toBe('none');
  });

  test('a CMR / POD / GPS nem számít a kötelező csomagba', () => {
    const r = chk.evaluate({ orders: [ORD_A], requiredIds: ['A'], ownCui: OWN,
      docs: [doc(1, ORDER_A), doc(2, INV_A), doc(3, FOREIGN, { doc_type: 'cmr' })] });
    expect(r.status).toBe('complete');
    expect(r.foreign).toEqual([]);
  });
});

describe('tanulás — ügyfelenkénti referencia-felirat + jel-súly', () => {
  const A = Object.assign({}, ORD_A, { client_id: 12 });
  // Ugyanaz az ügyfél, ugyanaz az útvonal — DE egy másik fuvar megrendelője.
  const OTHER = 'COMANDA DE TRANSPORT\nNr. comandă: PO-99001\nBeneficiar: VESNA GC SRL CUI RO25871352\nIncarcare: Arad\nDescarcare: Cluj-Napoca\nPret: 1.500,00 EUR';
  const RIGHT = 'COMANDA DE TRANSPORT\nNr. comandă: PO-88123\nBeneficiar: VESNA GC SRL CUI RO25871352\nIncarcare: Arad\nDescarcare: Cluj-Napoca';

  test('a felirat megtanulása és az érték kiolvasása', () => {
    const l = chk.learnLabel(RIGHT, 'PO-88123');
    expect(l).toBe('nr comanda');
    expect(chk.valuesAfterLabel(OTHER, l)).toEqual(['po99001']);
    expect(chk.partyKey(A, 'client')).toBe('client:12');
    expect(chk.partyKey(ORD_B, 'carrier')).toBe('carrier:7');
  });

  test('tanulás nélkül az ügyfél MÁSIK fuvarjának megrendelője is átmegy — tanulással kiszűrve', () => {
    const base = { orders: [A], requiredIds: ['A'], ownCui: OWN, docs: [doc(1, OTHER)] };
    const r0 = chk.evaluate(base);
    expect(r0.orders[0].slots[0].doc_id).toBe(1);   // CUI + név + városok + ár → párosítja
    const learn = { patterns: { 'client:12|order': 'nr comanda' }, weights: {} };
    const r1 = chk.evaluate(Object.assign({}, base, { learn }));
    expect(r1.orders[0].slots[0].level).toBe('missing');
    expect(r1.foreign.map((f) => f.doc_id)).toEqual([1]);
  });

  test('tanult felirattal a helyes megrendelő magas biztonságot kap', () => {
    const learn = { patterns: { 'client:12|order': 'nr comanda' }, weights: {} };
    const r = chk.evaluate({ orders: [A], requiredIds: ['A'], ownCui: OWN, docs: [doc(1, OTHER), doc(2, RIGHT)], learn });
    const s = r.orders[0].slots[0];
    expect(s.doc_id).toBe(2);
    expect(s.level).toBe('ok');
    expect(s.reasons.some((x) => x.startsWith('learned_ref'))).toBe(true);
  });

  test('jel-súly: 5 döntés alatt 1, rossz arány → csökken, jó → max 1,2', () => {
    expect(chk.weightOf(2, 1)).toBe(1);
    expect(chk.weightOf(1, 9)).toBeLessThan(0.6);
    expect(chk.weightOf(20, 0)).toBeCloseTo(1.2, 1);
  });
});
