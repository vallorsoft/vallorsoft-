// lib/invoiceText — számla-adatok AI nélkül, a két valós FGO-elrendezés szövegrétegén.
const { parseInvoiceText, normName } = require('../../lib/invoiceText');

const EFACTURA = 'Factura\nVLR 01079\nData emitere:04.10.2026\nData Scadenta:07.10.2026\nIndex incarcare:\nData incarcare:\n' +
  'Furnizor\nVALLOR TEAM S.R.L.\nCUI: RO47859317\nReg. Com.: J2023000114142\nClient\nVESNA GC SRL\nCUI:  RO25871352\nJud. Cluj\nRO e-Factura';
const SIMA = 'FACTURA VLR 01079\nData emitere: 04.10.2026\nData scadenta: 07.10.2026\nFurnizor\nVALLOR TEAM S.R.L.\nCUI: RO47859317\n' +
  'Client\nVESNA GC SRL\nCUI: RO25871352\nFactura circula fara semnatura si stampila cf. art.V, alin (2) din Ordonanta nr.17/2015';

test.each([['e-Factura', EFACTURA], ['sima', SIMA]])('%s: szám, dátum, vevő, CUI-k', (_n, txt) => {
  const r = parseInvoiceText(txt);
  expect(r.invoice_no).toBe('VLR 01079');
  expect(r.date).toBe('2026-10-04');
  expect(r.client_name).toBe('VESNA GC SRL');
  expect(r.supplier_name).toBe('VALLOR TEAM S.R.L.');
  expect(r.cuis).toEqual(['47859317', '25871352']);
});

test('a lábléc-mondat ("Factura circula…") nem számlaszám', () => {
  expect(parseInvoiceText('Factura circula fara semnatura').invoice_no).toBeNull();
});

test('szétvált fejléc: címke és érték külön sorban', () => {
  const r = parseInvoiceText('FacturaData emitere:\nVLR 01079\n04.10.2026\n07.10.2026');
  expect(r.invoice_no).toBe('VLR 01079');
  expect(r.date).toBe('2026-10-04');
});

test('„Seria X nr. N" + egysoros vevő + érvénytelen dátum kihagyva', () => {
  const r = parseInvoiceText('Seria ABC nr. 123\n31.02.2026\nData facturii: 03/09/2026\nCumpărător: ACME S.R.L.\nCIF: RO 1234567');
  expect(r.invoice_no).toBe('ABC 123');
  expect(r.date).toBe('2026-09-03');
  expect(r.client_name).toBe('ACME S.R.L.');
  expect(r.cuis).toEqual(['1234567']);
});

test('üres / szöveg nélküli bemenet', () => {
  expect(parseInvoiceText('')).toMatchObject({ invoice_no: null, date: null, cuis: [] });
});

test('normName: jogi forma, ékezet, írásjel nélkül', () => {
  expect(normName('S.C. Vesna GC S.R.L.')).toBe('vesna gc');
  expect(normName('Transport Ștefănescu SA')).toBe('transport stefanescu');
});
