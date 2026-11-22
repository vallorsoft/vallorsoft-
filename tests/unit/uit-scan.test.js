// tests/unit/uit-scan.test.js — a UIT AI-scan handler
//   - szerep/env/csomag kapuk
//   - fájl-validáció (MIME, méret)
//   - Gemini-válasz normalizáció (duplikátum-szűrés, kötőjel-eltávolítás,
//     max 16 karakter, üres/hibás bemenet)
'use strict';

// A `geminiJson.extractJson` mockolása — nincs valós hálózat.
jest.mock('../../lib/geminiJson', () => ({
  extractJson: jest.fn(),
}));
// A featureEnabled → mindig true (a kapcsoló kapun kívül van).
jest.mock('../../lib/featureEnabled', () => ({
  featureEnabled: jest.fn().mockResolvedValue(true),
}));
// audit no-op
jest.mock('../../lib/audit', () => ({
  fromReq: jest.fn().mockResolvedValue(undefined),
}));

// A PDF szövegrétege helyben olvasva (docPrivacy) — tesztenként állítható szöveg.
let mockPdfText = '';
jest.mock('../../services/pdf-extract', () => ({ extractText: async () => ({ text: mockPdfText }) }));

const { extractJson } = require('../../lib/geminiJson');
const handlers = require('../../handlers/uitScan');

function mkReq(pozicio) {
  return { session: { user: pozicio ? { id: 1, company_id: 1, email: 'x@y.z', pozicio } : null } };
}
function mkRes() {
  const r = {};
  r.json = jest.fn().mockImplementation(function (o) { r._body = o; return r; });
  return r;
}

describe('handlers.scanUitFromImage — kapuk', () => {
  beforeEach(() => { process.env.GEMINI_API_KEY = 'test'; });
  test('nincs session → 403', async () => {
    const res = mkRes();
    await handlers.scanUitFromImage(mkReq(null), res, [{}]);
    expect(res._body.result.ok).toBe(false);
    expect(res._body.result.err).toMatch(/interzis/i);
  });
  test('Konyvelo → 403', async () => {
    const res = mkRes();
    await handlers.scanUitFromImage(mkReq('Konyvelo'), res, [{}]);
    expect(res._body.result.ok).toBe(false);
  });
  test('Sofer + hiányzó fájl → hibaüzenet', async () => {
    const res = mkRes();
    await handlers.scanUitFromImage(mkReq('Sofer'), res, [{ mimeType: 'image/jpeg' }]);
    expect(res._body.result.ok).toBe(false);
    expect(res._body.result.err).toMatch(/Fisier|lipsa/);
  });
  test.each(['image/svg+xml', 'text/html', 'application/zip'])('rossz MIME (%s) → visszautasítás', async (mime) => {
    const res = mkRes();
    await handlers.scanUitFromImage(mkReq('Sofer'), res, [{ mimeType: mime, data: 'AAAA' }]);
    expect(res._body.result.ok).toBe(false);
    expect(res._body.result.err).toMatch(/Format/i);
  });
  test('fotó → nem megy ki (local_only), az AI-t nem hívja', async () => {
    extractJson.mockReset();
    const res = mkRes();
    await handlers.scanUitFromImage(mkReq('Admin'), res, [{ mimeType: 'image/jpeg', data: 'AAAA' }]);
    expect(res._body.result.ok).toBe(false);
    expect(res._body.result.local_only).toBe(true);
    expect(extractJson).not.toHaveBeenCalled();
  });
});

describe('handlers.scanUitFromImage — sanitize', () => {
  const { _sanitize } = handlers;
  test('kötőjeleket kivágja, nagybetűs, max 16', () => {
    const r = _sanitize({ codes: ['ab-cd-12-34', 'XYZ0'] });
    expect(r.codes).toEqual(['ABCD1234', 'XYZ0']);
  });
  test('duplikátumokat kiszűri', () => {
    const r = _sanitize({ codes: ['ABCD1234', 'abcd1234', 'ab-cd-1234'] });
    expect(r.codes).toEqual(['ABCD1234']);
  });
  test('érvénytelen kódot kihagy (üres, csak jelek)', () => {
    const r = _sanitize({ codes: ['', '---', 'ABCD1'] });
    expect(r.codes).toEqual(['ABCD1']);
  });
  test('a lista max 20 elemű', () => {
    const many = [];
    for (let i = 0; i < 30; i++) many.push('CODE' + String(i).padStart(3, '0'));
    const r = _sanitize({ codes: many });
    expect(r.codes.length).toBe(20);
  });
  test('nincs codes tömb → üres', () => {
    expect(_sanitize({}).codes).toEqual([]);
    expect(_sanitize(null).codes).toEqual([]);
  });
});

describe('UIT PDF — helyi kiolvasás (docPrivacy)', () => {
  beforeEach(() => { extractJson.mockReset(); mockPdfText = ''; });
  const PDF = [{ mimeType: 'application/pdf', data: Buffer.from('%PDF-1.4').toString('base64') }];
  test('PDF szövegrétegéből kódok, AI nélkül', async () => {
    mockPdfText = 'Confirmare e-Transport\nCod UIT: ABCD-1234-EFGH-5678\nFactura 2026000123';
    const res = mkRes();
    await handlers.scanUitFromImage(mkReq('Sofer'), res, PDF);
    expect(res._body.result.ok).toBe(true);
    expect(res._body.result.codes).toEqual(['ABCD1234EFGH5678']);
    expect(res._body.result.model).toBe('local-pdf');
    expect(extractJson).not.toHaveBeenCalled();
  });
  test('nincs UIT a szövegben → kézi bevitelre kér', async () => {
    mockPdfText = 'Factura nr 2026000123';
    const res = mkRes();
    await handlers.scanUitFromImage(mkReq('Sofer'), res, PDF);
    expect(res._body.result.ok).toBe(false);
    expect(extractJson).not.toHaveBeenCalled();
  });
});

describe('lib/uitFormat sanitizeUitPhoto', () => {
  const { sanitizeUitPhoto } = require('../../lib/uitFormat');
  test('kép és PDF elfogadva', () => {
    expect(sanitizeUitPhoto({ photo_mime: 'image/jpeg', photo_b64: 'QUJD' }).photo_mime).toBe('image/jpeg');
    expect(sanitizeUitPhoto({ photo_mime: 'application/pdf', photo_b64: 'QUJD' }).photo_mime).toBe('application/pdf');
  });
  test('SVG / HTML / nem-base64 / túl nagy → nincs csatolmány', () => {
    expect(sanitizeUitPhoto({ photo_mime: 'image/svg+xml', photo_b64: 'QUJD' }).photo_b64).toBeNull();
    expect(sanitizeUitPhoto({ photo_mime: 'text/html', photo_b64: 'QUJD' }).photo_b64).toBeNull();
    expect(sanitizeUitPhoto({ photo_mime: 'image/png', photo_b64: '<script>' }).photo_b64).toBeNull();
    expect(sanitizeUitPhoto({ photo_mime: 'image/png', photo_b64: 'A'.repeat(12 * 1024 * 1024) }).photo_b64).toBeNull();
  });
});
