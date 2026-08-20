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
  test('rossz MIME (PDF) → visszautasítás (csak kép)', async () => {
    const res = mkRes();
    await handlers.scanUitFromImage(mkReq('Sofer'), res, [{ mimeType: 'application/pdf', data: 'AAAA' }]);
    expect(res._body.result.ok).toBe(false);
    expect(res._body.result.err).toMatch(/Format/i);
  });
  test('nincs API-kulcs → nem-konfigurált', async () => {
    delete process.env.GEMINI_API_KEY;
    const res = mkRes();
    await handlers.scanUitFromImage(mkReq('Admin'), res, [{ mimeType: 'image/jpeg', data: 'AAAA' }]);
    expect(res._body.result.ok).toBe(false);
    expect(res._body.result.err).toMatch(/nu este configurat/i);
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

describe('handlers.scanUitFromImage — teljes út (Gemini mock)', () => {
  beforeEach(() => { process.env.GEMINI_API_KEY = 'test'; extractJson.mockReset(); });
  test('sikeres AI-válasz → codes-tömb', async () => {
    extractJson.mockResolvedValueOnce({ json: { codes: ['ABCD-1234', 'xyz0-9999'], confidence: 0.9 }, model: 'gemini-2.0-flash' });
    const res = mkRes();
    await handlers.scanUitFromImage(mkReq('Sofer'), res, [{ mimeType: 'image/jpeg', data: Buffer.from('x').toString('base64') }]);
    expect(res._body.result.ok).toBe(true);
    expect(res._body.result.codes).toEqual(['ABCD1234', 'XYZ09999']);
    expect(res._body.result.model).toBe('gemini-2.0-flash');
  });
  test('AI-hiba → err a válaszban', async () => {
    extractJson.mockRejectedValueOnce(Object.assign(new Error('kvota'), { status: 429 }));
    const res = mkRes();
    await handlers.scanUitFromImage(mkReq('Sofer'), res, [{ mimeType: 'image/jpeg', data: Buffer.from('x').toString('base64') }]);
    expect(res._body.result.ok).toBe(false);
    expect(res._body.result.status).toBe(429);
  });
});
