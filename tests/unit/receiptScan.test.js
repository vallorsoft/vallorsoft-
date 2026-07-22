// ============================================================
//  Unit-teszt — handlers/receiptScan.js
//  A `scanReceipt` handler kapuit + a mező-sanitize-t ellenőrizzük;
//  a Gemini `fetch`-hívása mockolva (nincs valódi HTTP).
// ============================================================
jest.mock('../../db', () => require('../helpers/db-mock').pool);
// featureEnabled: alapból engedélyezett (a handler tovább mehet)
jest.mock('../../lib/featureEnabled', () => ({ featureEnabled: async () => true }));
// audit: no-op (a handler try/catch-eli, de így nem is log-olja el)
jest.mock('../../lib/audit', () => ({ fromReq: async () => {} }));

const handler = require('../../handlers/receiptScan');

// Kis segéd — a handler mint `/api/execute` RPC-t hívja: `handler(req,res,args)`
function callScan(user, args) {
  return new Promise((resolve) => {
    const req = { session: { user } };
    const res = { json: (payload) => resolve(payload) };
    handler.scanReceipt(req, res, args);
  });
}

// A `fetch` globális mockja — a callGemini ezt hívja.
function mockGeminiJson(json) {
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(json) }] } }],
    }),
  }));
}
function mockGeminiStatus(status, body) {
  global.fetch = jest.fn(async () => ({
    ok: false, status,
    text: async () => JSON.stringify(body || { error: { message: 'fail' } }),
  }));
}

const SOFER = { id: 1, email: 's@x', pozicio: 'Sofer', company_id: 1 };
const ADMIN = { id: 2, email: 'a@x', pozicio: 'Admin', company_id: 1 };
const OTHER = { id: 3, email: 'o@x', pozicio: 'Konyvelo', company_id: 1 };

// Egy pici, valid base64 (1x1 PNG helyett akármi — a Gemini-hívás mockolva).
const B64 = 'aGVsbG8='; // "hello"
const PAYLOAD_IMG = [{ mimeType: 'image/jpeg', data: B64 }];

describe('handlers/receiptScan', () => {
  const origKey = process.env.GEMINI_API_KEY;
  const origFetch = global.fetch;
  beforeEach(() => { process.env.GEMINI_API_KEY = 'test-key'; });
  afterAll(() => {
    if (origKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = origKey;
    global.fetch = origFetch;
  });

  test('nincs bejelentkezve → Acces interzis', async () => {
    const r = await callScan(null, PAYLOAD_IMG);
    expect(r.result.ok).toBe(false);
  });

  test('nem-jogosult szerep (Konyvelo) → Acces interzis', async () => {
    const r = await callScan(OTHER, PAYLOAD_IMG);
    expect(r.result.ok).toBe(false);
  });

  test('hiányzó API-kulcs → nem-configured hiba', async () => {
    delete process.env.GEMINI_API_KEY;
    const r = await callScan(SOFER, PAYLOAD_IMG);
    expect(r.result.ok).toBe(false);
    expect(r.result.err).toMatch(/nu este configurat/i);
  });

  test('nem támogatott mimetype → hiba', async () => {
    const r = await callScan(SOFER, [{ mimeType: 'text/plain', data: B64 }]);
    expect(r.result.ok).toBe(false);
    expect(r.result.err).toMatch(/Format/i);
  });

  test('üres fájl → hiba', async () => {
    const r = await callScan(SOFER, [{ mimeType: 'image/jpeg', data: '' }]);
    expect(r.result.ok).toBe(false);
  });

  test('túl nagy fájl (>8 MB) → hiba', async () => {
    // ~10.7 MB nyers becslés
    const big = 'A'.repeat(15 * 1024 * 1024);
    const r = await callScan(SOFER, [{ mimeType: 'image/jpeg', data: big }]);
    expect(r.result.ok).toBe(false);
    expect(r.result.err).toMatch(/prea mare/i);
  });

  test('fuel bon: Gemini válaszát fehérlistázva visszaadja', async () => {
    mockGeminiJson({
      kind: 'fuel', loc: 'MOL Arad', data: '2026-07-22', tip: 'Motorină',
      litru: 234.56, km: 456123, plata: 'Card', suma: 1450.00, valuta: 'RON',
      produs: null, confidence: 0.91,
    });
    const r = await callScan(SOFER, PAYLOAD_IMG);
    expect(r.result.ok).toBe(true);
    expect(r.result.fields).toEqual(expect.objectContaining({
      kind: 'fuel', loc: 'MOL Arad', data: '2026-07-22', tip: 'Motorină',
      litru: 234.56, km: 456123, plata: 'Card', suma: 1450, valuta: 'RON',
    }));
  });

  test('purchase bon: kliens purchase-jel is visszatér', async () => {
    mockGeminiJson({
      kind: 'purchase', loc: 'Kaufland', data: '2026-07-22', tip: null,
      litru: null, km: null, plata: 'Cash', suma: 89.5, valuta: 'RON',
      produs: 'Apă minerală', confidence: 0.8,
    });
    const r = await callScan(ADMIN, PAYLOAD_IMG);
    expect(r.result.ok).toBe(true);
    expect(r.result.fields.kind).toBe('purchase');
    expect(r.result.fields.produs).toBe('Apă minerală');
    expect(r.result.fields.suma).toBe(89.5);
  });

  test('sanitize kiszűri az ismeretlen "plata"/"tip"-et, invalid dátumot', () => {
    const out = handler._sanitize({
      kind: 'fuel',
      loc: '  Kaufland  ',
      data: '22.07.2026', // nem ISO → null
      tip: 'BENZIN',      // nem fehérlistán → null
      litru: '12,3',      // parseFloat → 12 (a vessző utáni levág)
      plata: 'BitcoinPay',// nem fehérlistán → null
      suma: '89.5',
      valuta: 'RON',
      confidence: 'nem-szám',
    });
    expect(out.data).toBeNull();
    expect(out.tip).toBeNull();
    expect(out.plata).toBeNull();
    expect(out.suma).toBe(89.5);
    expect(out.loc).toBe('Kaufland');
    expect(out.confidence).toBeNull();
  });

  test('minden modell 429/503 → érthető hiba', async () => {
    mockGeminiStatus(429, { error: { message: 'quota' } });
    const r = await callScan(SOFER, PAYLOAD_IMG);
    expect(r.result.ok).toBe(false);
    expect(r.result.err).toMatch(/supraincarcate|epuizata/i);
    // A modell-lánc mind a 6 modellen végigment (429 → next)
    expect(global.fetch.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  test('400 → azonnal áll, nem próbál más modellt', async () => {
    mockGeminiStatus(400, { error: { message: 'bad request' } });
    const r = await callScan(SOFER, PAYLOAD_IMG);
    expect(r.result.ok).toBe(false);
    expect(global.fetch.mock.calls.length).toBe(1);
  });

  test('feature kikapcsolva → tiltva', async () => {
    jest.resetModules();
    jest.doMock('../../lib/featureEnabled', () => ({ featureEnabled: async () => false }));
    const h2 = require('../../handlers/receiptScan');
    const req = { session: { user: SOFER } };
    let out;
    await new Promise((resolve) => {
      h2.scanReceipt(req, { json: (p) => { out = p; resolve(); } }, PAYLOAD_IMG);
    });
    expect(out.result.ok).toBe(false);
    expect(out.result.err).toMatch(/nedisponibila/i);
  });
});
