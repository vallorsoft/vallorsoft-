// tests/unit/docPrivacy.test.js — ÁLLANDÓ SZABÁLY: megrendelő, számla/bon, fuvar-fotó
// soha nem hagyja el a szervert. A VALÓDI geminiJson + order-ai modult hívjuk,
// a `fetch` kémkedik: egyetlen hálózati hívás sem történhet.
'use strict';

const docPrivacy = require('../../lib/docPrivacy');
const { extractJson } = require('../../lib/geminiJson');
const orderAi = require('../../services/order-ai');

describe('lib/docPrivacy', () => {
  const origFetch = global.fetch;
  const origKey = process.env.GEMINI_API_KEY;
  beforeEach(() => { global.fetch = jest.fn(); process.env.GEMINI_API_KEY = 'test-key'; });
  afterAll(() => {
    global.fetch = origFetch;
    if (origKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = origKey;
  });

  test('a kapcsoló kódba égetve BE van', () => {
    expect(docPrivacy.DOCS_LOCAL_ONLY).toBe(true);
  });

  test.each([
    [{ inlineData: { mimeType: 'image/jpeg', data: 'AAAA' } }],
    [{ inline_data: { mime_type: 'application/pdf', data: 'AAAA' } }],
    [{ fileData: { fileUri: 'gs://x' } }],
  ])('fájl-rész (%o) → elutasítva, hálózat nélkül', async (part) => {
    await expect(extractJson({ systemPrompt: 'x', parts: [part, { text: 'y' }] }))
      .rejects.toMatchObject({ code: 'DOCS_LOCAL_ONLY', status: 403 });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('csak a bon (fileKind=receipt) vihet fájlt; más fajta címke nem nyit kaput', async () => {
    const img = [{ inlineData: { mimeType: 'image/jpeg', data: 'AAAA' } }];
    for (const k of ['order', 'invoice', 'uit', 'photo', undefined]) {
      await expect(extractJson({ systemPrompt: 'x', parts: img, fileKind: k }))
        .rejects.toMatchObject({ code: 'DOCS_LOCAL_ONLY' });
    }
    expect(global.fetch).not.toHaveBeenCalled();
    expect(docPrivacy.fileAllowed('receipt')).toBe(true);
    expect(docPrivacy.ALLOWED_FILE_KINDS).toEqual(['receipt']);
  });

  test('megrendelő-kiolvasás (fájl + szöveg) mindig helyi, hálózat nélkül', async () => {
    const r = await orderAi.extractFields({
      text: 'Comanda nr. REF-123 CUI RO47859317 pret 1500 EUR',
      fileBuffer: Buffer.from('%PDF'), mimeType: 'application/pdf', aiEnabled: true,
    });
    expect(r.ai_used).toBe(false);
    expect(r.fields.client_cui).toMatch(/47859317/);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
