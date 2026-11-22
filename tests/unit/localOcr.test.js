// lib/localOcr — helyi OCR segédei (a valódi felismerést kézzel ellenőriztük: román/magyar/angol modell).
const ocr = require('../../lib/localOcr');

function fakePdf(parts) {
  return Buffer.concat(parts.map((p) => (typeof p === 'string' ? Buffer.from(p, 'latin1') : p)));
}
const jpeg = (n) => Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(n, 7), Buffer.from([0xFF, 0xD9])]);

test('a PDF-be ágyazott JPEG oldalakat kiveszi, a kicsi (logó) és a nem-JPEG streamet kihagyja', () => {
  const big = jpeg(20000), small = jpeg(500);
  const buf = fakePdf([
    '%PDF-1.4\n1 0 obj\n<< /Type /XObject /Subtype /Image /Filter /DCTDecode /Length 1 >>\nstream\n', big, '\nendstream\nendobj\n',
    '2 0 obj\n<< /Filter /DCTDecode >>\nstream\n', small, '\nendstream\nendobj\n',
    '3 0 obj\n<< /Filter /FlateDecode >>\nstream\nxyz\nendstream\nendobj\n',
  ]);
  const out = ocr.pdfJpegs(buf, 4);
  expect(out.length).toBe(1);
  expect(out[0].length).toBe(big.length);
  expect(out[0][0]).toBe(0xFF);
  expect(out[0][out[0].length - 1]).toBe(0xD9);
});

test('nyelvek: alapból román + magyar + angol, env-vel bővíthető', () => {
  const old = process.env.WAYBILL_DOC_OCR_LANGS;
  delete process.env.WAYBILL_DOC_OCR_LANGS;
  expect(ocr.langs()).toEqual(['ron', 'hun', 'eng']);
  process.env.WAYBILL_DOC_OCR_LANGS = 'ron+hun+eng+deu; rm -rf';
  expect(ocr.langs()).toEqual(['ron', 'hun', 'eng', 'deu']);   // a hibás tétel kimarad
  if (old === undefined) delete process.env.WAYBILL_DOC_OCR_LANGS; else process.env.WAYBILL_DOC_OCR_LANGS = old;
});

test('a nyelvi modellek a projektben vannak (nincs futásidejű letöltés)', () => {
  ['ron', 'hun', 'eng'].forEach((l) => expect(() => require.resolve('@tesseract.js-data/' + l + '/package.json')).not.toThrow());
});
