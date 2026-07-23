// ============================================================
//  Unit-teszt — lib/geminiJson.js (közös Gemini JSON-kiolvasó)
//  A `fetch` mockolva; nincs valódi HTTP.
// ============================================================
const { extractJson, MODELS, DEFAULT_MODELS } = require('../../lib/geminiJson');

function mockJsonOnce(json) {
  global.fetch.mockImplementationOnce(async () => ({
    ok: true, status: 200,
    text: async () => JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(json) }] } }],
    }),
  }));
}
function mockStatus(status, body) {
  return {
    ok: false, status,
    text: async () => JSON.stringify(body || { error: { message: 'fail' } }),
  };
}

describe('lib/geminiJson', () => {
  const origKey = process.env.GEMINI_API_KEY;
  const origFetch = global.fetch;
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key';
    global.fetch = jest.fn();
  });
  afterAll(() => {
    if (origKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = origKey;
    global.fetch = origFetch;
  });

  test('DEFAULT_MODELS: legalább 6 modell, első a 2.0-flash', () => {
    expect(DEFAULT_MODELS.length).toBeGreaterThanOrEqual(6);
    expect(DEFAULT_MODELS[0]).toBe('gemini-2.0-flash');
  });

  test('MODELS: nincs duplikátum', () => {
    const set = new Set(MODELS);
    expect(set.size).toBe(MODELS.length);
  });

  test('siker: első modell → { json, model }', async () => {
    mockJsonOnce({ foo: 'bar', n: 42 });
    const r = await extractJson({ systemPrompt: 'sys', parts: [{ text: 'x' }] });
    expect(r.json).toEqual({ foo: 'bar', n: 42 });
    expect(r.model).toBe(MODELS[0]);
    // Ellenőrzés: a kulcs headerben megy (query stringben NEM)
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).not.toMatch(/key=/);
    expect(opts.headers['x-goog-api-key']).toBe('test-key');
  });

  test('429 az elsőn → a második modellel próbál', async () => {
    global.fetch
      .mockImplementationOnce(async () => mockStatus(429))
      .mockImplementationOnce(async () => ({
        ok: true, status: 200,
        text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":1}' }] } }] }),
      }));
    const r = await extractJson({ systemPrompt: 's', parts: [], models: [MODELS[0], MODELS[1]] });
    expect(r.model).toBe(MODELS[1]);
    expect(global.fetch.mock.calls.length).toBe(2);
  });

  test('400 → azonnal dob, nem próbál más modellt', async () => {
    global.fetch.mockImplementationOnce(async () => mockStatus(400, { error: { message: 'bad' } }));
    await expect(extractJson({ systemPrompt: 's', parts: [], models: [MODELS[0], MODELS[1]] }))
      .rejects.toMatchObject({ status: 400 });
    expect(global.fetch.mock.calls.length).toBe(1);
  });

  test('404 az elsőn (visszavont modell) → továbblép a következőre', async () => {
    // A régi lánc (PR #287) ezen ELHASALT: 4 flash után `gemini-1.5-flash`
    // 2025-09-24 óta visszavonva → 404, és a régi extractJson csak 429/503-on
    // ugrott. Az új: 404 = "ez a modell nem elérhető ide", megy a következőre.
    global.fetch
      .mockImplementationOnce(async () => mockStatus(404, { error: { message: 'models/... not found' } }))
      .mockImplementationOnce(async () => ({
        ok: true, status: 200,
        text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":1}' }] } }] }),
      }));
    const r = await extractJson({ systemPrompt: 's', parts: [], models: ['retired-model', MODELS[0]] });
    expect(r.model).toBe(MODELS[0]);
    expect(global.fetch.mock.calls.length).toBe(2);
  });

  test('minden modell 429 → érthető végső hiba', async () => {
    global.fetch.mockImplementation(async () => mockStatus(429));
    let err;
    try { await extractJson({ systemPrompt: 's', parts: [], models: ['a', 'b', 'c'] }); }
    catch (e) { err = e; }
    expect(err).toBeDefined();
    expect(err.status).toBe(429);
    expect(err.message).toMatch(/supraînc|epuizat/i);
    expect(global.fetch.mock.calls.length).toBe(3);
  });

  test('nincs API-kulcs → NO_KEY hiba', async () => {
    delete process.env.GEMINI_API_KEY;
    await expect(extractJson({ systemPrompt: 's', parts: [] }))
      .rejects.toMatchObject({ code: 'NO_KEY' });
  });

  test('GEMINI_MODELS env: a modul-listát nem befolyásolja utólag (module-load-time)', () => {
    // A MODELS module-load-idejű; itt csak biztosítjuk, hogy az env-alapú
    // override szemantikája dokumentált — a MODELS a NODE_MODULES betöltésekor
    // rögzül. (Új env → új require kell, ami külön tesztek dolga.)
    process.env.GEMINI_MODELS = 'xxx';
    expect(MODELS[0]).toBe(DEFAULT_MODELS[0]);
    delete process.env.GEMINI_MODELS;
  });
});
