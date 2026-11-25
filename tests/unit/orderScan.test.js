// ============================================================
//  Unit-teszt — handlers/orderScan.js
//  A fuvar-kiírás közbeni „megrendelő feltöltése + AI kiolvasás"
//  (`scanOrderDocument`) handler kapuit + a mező-sanitize-t ellenőrizzük;
//  a Gemini `fetch`-hívása mockolva (nincs valódi HTTP).
// ============================================================
// A DB-lekérdezéseket mock-oljuk (order_scan_samples SELECT + INSERT).
const mockDbQuery = jest.fn(async () => ({ rows: [] }));
jest.mock('../../db', () => ({ query: (...a) => mockDbQuery(...a) }));
jest.mock('../../lib/audit', () => ({ fromReq: async () => {} }));
// featureEnabled: tesztenként állítható (alap: engedélyezett)
let mockFeatureOn = true;
jest.mock('../../lib/featureEnabled', () => ({ featureEnabled: async () => mockFeatureOn }));
// pdf-parse nélkül is fusson: a PDF-szöveg-kinyerés üresre esik
jest.mock('../../services/pdf-extract', () => ({
  extractText: async () => ({ text: '', scanned: true, hasParser: false }),
}));

// A kiolvasó (services/order-ai) mockolva: a docPrivacy szabály óta MINDIG a helyi
// heurisztika fut (lásd tests/unit/docPrivacy.test.js) — itt a handler kapuit és a
// mező-sanitize-t teszteljük a kiolvasó kimenetére.
const mockExtract = jest.fn();
jest.mock('../../services/order-ai', () => ({ extractFields: (...a) => mockExtract(...a) }));

const handler = require('../../handlers/orderScan');

function call(user, args) {
  return new Promise((resolve) => {
    const req = { session: { user } };
    const res = { json: (payload) => resolve(payload) };
    handler.scanOrderDocument(req, res, args);
  });
}

function mockGeminiJson(json) {
  mockExtract.mockResolvedValue({ fields: json, confidence: json.confidence, ai_used: false });
}

const ADMIN = { id: 1, email: 'a@x', pozicio: 'Admin', company_id: 1, nume: 'A' };
const MANAGER = { id: 2, email: 'm@x', pozicio: 'Manager', company_id: 1, nume: 'M' };
const SOFER = { id: 3, email: 's@x', pozicio: 'Sofer', company_id: 1 };

const B64 = 'aGVsbG8=';                                     // "hello"
const IMG = [{ mimeType: 'image/jpeg', data: B64, fileName: 'comanda.jpg' }];
const PDF = [{ mimeType: 'application/pdf', data: B64, fileName: 'comanda.pdf' }];

const FULL = {
  client: '  Vallor Logistics  ', client_cui: 'RO47859317', ref: 'REF-99',
  loc_incarcare: 'Budapest', loc_descarcare: 'Arad',
  firma_incarcare: 'Feladó Kft', firma_descarcare: 'Primitor SRL',
  data_incarcare: '2026-07-30', data_descarcare: '2026-07-31T14:30',
  pret: '1 250,50', valuta: 'EUR', km: '640', greutate: '12000',
  load_type: 'ltl', hossz_cm: '240.6', szel_cm: 120, mag_cm: 180,
  rendszam_camion: 'b 104 vlr', rendszam_remorca: 'cj12abc',
  observatii: 'Rakodás 08:00', confidence: 0.91,
};

describe('handlers/orderScan — scanOrderDocument', () => {
  const origKey = process.env.GEMINI_API_KEY;
  const origFetch = global.fetch;
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key';
    mockExtract.mockReset();
    mockExtract.mockResolvedValue({ fields: {}, confidence: 0.25, ai_used: false });
    mockFeatureOn = true;
    mockDbQuery.mockReset();
    mockDbQuery.mockResolvedValue({ rows: [] });
  });
  afterAll(() => {
    if (origKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = origKey;
    global.fetch = origFetch;
  });

  // ── Kapuk ──
  it('bejelentkezés nélkül elutasít', async () => {
    const r = await call(null, IMG);
    expect(r.result.ok).toBe(false);
    expect(r.result.err).toMatch(/interzis/i);
  });

  it('sofőrt elutasít (csak Admin/Manager)', async () => {
    const r = await call(SOFER, IMG);
    expect(r.result.ok).toBe(false);
    expect(r.result.err).toMatch(/interzis/i);
  });

  it('managert beengedi', async () => {
    mockGeminiJson({ client: 'X', confidence: 0.5 });
    const r = await call(MANAGER, IMG);
    expect(r.result.ok).toBe(true);
    expect(r.result.fields.client).toBe('X');
  });

  it('kikapcsolt ai-kiolvasas csomag-flag esetén elutasít', async () => {
    mockFeatureOn = false;
    const r = await call(ADMIN, IMG);
    expect(r.result.ok).toBe(false);
    expect(r.result.err).toMatch(/nedisponibila/i);
  });

  // ── Fájl-validáció ──
  it('hiányzó fájlt elutasít', async () => {
    const r = await call(ADMIN, [{ mimeType: 'image/jpeg' }]);
    expect(r.result.ok).toBe(false);
    expect(r.result.err).toMatch(/lipsa/i);
  });

  it('nem támogatott formátumot elutasít', async () => {
    const r = await call(ADMIN, [{ mimeType: 'application/zip', data: B64 }]);
    expect(r.result.ok).toBe(false);
    expect(r.result.err).toMatch(/nesuportat/i);
  });

  it('8 MB-nál nagyobb fájlt elutasít', async () => {
    const big = 'A'.repeat(12 * 1024 * 1024);
    const r = await call(ADMIN, [{ mimeType: 'application/pdf', data: big }]);
    expect(r.result.ok).toBe(false);
    expect(r.result.err).toMatch(/prea mare/i);
  });

  it('PDF-et is elfogad (helyi kiolvasás, ai_used=false)', async () => {
    mockGeminiJson({ client: 'PDF Client', confidence: 0.8 });
    const r = await call(ADMIN, PDF);
    expect(r.result.ok).toBe(true);
    expect(r.result.ai_used).toBe(false);
    expect(r.result.fields.client).toBe('PDF Client');
  });

  // ── Mező-sanitize ──
  it('a teljes kiolvasást normalizálja a kiíró űrlap mezőire', async () => {
    mockGeminiJson(FULL);
    const r = await call(ADMIN, IMG);
    const f = r.result.fields;
    expect(r.result.ok).toBe(true);
    expect(f.client).toBe('Vallor Logistics');            // trimmelve
    expect(f.pret).toBe(1250.5);                          // "1 250,50" → szám
    expect(f.km).toBe(640);
    expect(f.suly_kg).toBe(12000);                        // greutate → suly_kg
    expect(f.load_type).toBe('LTL');                      // nagybetűsítve
    expect(f.hossz_cm).toBe(241);                         // egészre kerekítve
    expect(f.szel_cm).toBe(120);
    expect(f.rendszam_camion).toBe('B 104 VLR');          // nagybetű
    expect(f.rendszam_remorca).toBe('CJ12ABC');
    expect(f.data_incarcare).toBe('2026-07-30');          // dátum-csak marad
    expect(f.data_descarcare).toBe('2026-07-31T14:30');   // időbélyeg megmarad
    expect(f.firma_incarcare).toBe('Feladó Kft');
    expect(f.firma_descarcare).toBe('Primitor SRL');
    expect(r.result.confidence).toBe(0.91);
  });

  it('nem propagál ismeretlen („kreatív") kulcsot a kliensbe', async () => {
    mockGeminiJson({ client: 'X', hacker_field: 'boom', __proto__: {}, confidence: 0.5 });
    const r = await call(ADMIN, IMG);
    expect(r.result.fields.hacker_field).toBeUndefined();
    expect(Object.keys(r.result.fields).sort()).toEqual([
      'client', 'client_cui', 'data_descarcare', 'data_incarcare',
      'deliveries', 'firma_descarcare', 'firma_incarcare', 'hossz_cm', 'km', 'load_type',
      'loc_descarcare', 'loc_incarcare', 'mag_cm', 'observatii', 'pickups', 'pret',
      'ref', 'rendszam_camion', 'rendszam_remorca', 'suly_kg', 'szel_cm', 'valuta',
    ]);
  });

  it('érvénytelen dátumot/rakomány-típust null-ra tesz (nem szivárog ki)', async () => {
    mockGeminiJson({ data_incarcare: '30.07.2026', load_type: 'FULL', pret: 'nincs', confidence: 0.4 });
    const r = await call(ADMIN, IMG);
    expect(r.result.fields.data_incarcare).toBeNull();
    expect(r.result.fields.load_type).toBeNull();
    expect(r.result.fields.pret).toBeNull();
  });

  // ── Tartalék (AI nélkül) ──
  it('GEMINI_API_KEY nélkül a heurisztikus tartalék fut (ai_used=false)', async () => {
    delete process.env.GEMINI_API_KEY;
    const r = await call(ADMIN, PDF);
    expect(r.result.ok).toBe(true);
    expect(r.result.ai_used).toBe(false);
  });

  // ── Multi-stop (2+ felrakó vagy 2+ lerakó) ──
  it('a pickups[]/deliveries[] tömböt visszaadja a kliensnek', async () => {
    mockGeminiJson({
      loc_incarcare: 'Budapest', loc_descarcare: 'Arad',
      pickups: [
        { loc: 'Budapest', firma: 'A Kft', data: '2026-07-30' },
        { loc: 'Debrecen', firma: 'B Kft', data: '2026-07-30' },
      ],
      deliveries: [
        { loc: 'Arad', firma: 'X SRL', data: '2026-07-31' },
        { loc: 'Timișoara', firma: 'Y SRL', data: '2026-07-31' },
        { loc: 'Cluj', firma: 'Z SRL', data: '2026-08-01' },
      ],
      confidence: 0.9,
    });
    const r = await call(ADMIN, IMG);
    expect(r.result.ok).toBe(true);
    expect(r.result.fields.pickups).toHaveLength(2);
    expect(r.result.fields.deliveries).toHaveLength(3);
    expect(r.result.fields.pickups[1].loc).toBe('Debrecen');
    expect(r.result.fields.deliveries[2].firma).toBe('Z SRL');
  });

  it('multi-stop dátumok normalizálva, üres sorok kiesnek', async () => {
    mockGeminiJson({
      pickups: [
        { loc: 'X', data: '2026-07-30T08:00' },
        { loc: '', firma: '', data: '' },
        { loc: 'Y', data: 'invalid-date' },
      ],
      deliveries: null,
      confidence: 0.7,
    });
    const r = await call(ADMIN, IMG);
    expect(r.result.fields.pickups).toHaveLength(2);
    expect(r.result.fields.pickups[0].data).toBe('2026-07-30T08:00');
    expect(r.result.fields.pickups[1].data).toBeNull();
    expect(r.result.fields.deliveries).toBeNull();
  });

  it('multi-stop max 20 sorra korlátozva (payload-védelem)', async () => {
    const big = Array.from({ length: 50 }, (_, i) => ({ loc: 'City' + i }));
    mockGeminiJson({ pickups: big, deliveries: big, confidence: 0.5 });
    const r = await call(ADMIN, IMG);
    expect(r.result.fields.pickups).toHaveLength(20);
    expect(r.result.fields.deliveries).toHaveLength(20);
  });

  // ── Tanulás — few-shot minta betöltés ──
  it('tanult címke: a felismert megbízónál a címke után olvas (a friss értéket)', async () => {
    const TEXT = 'ALFA SPEDITION SRL\nPunct A >> Cluj-Napoca, Bd. Muncii 18\n';
    mockDbQuery.mockImplementation(async (sql) => {
      if (/FROM order_scan_samples/.test(sql)) return { rows: [{ template_key: 'alfa', template_label: 'ALFA SPEDITION SRL', cui: null, updated_at: new Date() }] };
      if (/FROM order_scan_rules/.test(sql)) return { rows: [{ id: 7, field: 'loc_incarcare', anchor: 'punct a >>', mode: 'same', hits: 2, misses: 0 }] };
      if (/INSERT INTO order_scan_jobs/.test(sql)) return { rows: [{ id: 99 }] };
      return { rows: [] };
    });
    mockExtract.mockResolvedValue({ fields: { client: null, loc_incarcare: null }, confidence: 0.2, ai_used: false, text: TEXT });
    const r = await call(ADMIN, PDF);
    expect(r.result.ok).toBe(true);
    expect(r.result.fields.client).toBe('ALFA SPEDITION SRL');
    expect(r.result.fields.loc_incarcare).toBe('Cluj-Napoca, Bd. Muncii 18');
    expect(r.result.learned_from).toBe(1);
    expect(r.result.scan_id).toBe(99);
    mockDbQuery.mockReset(); mockDbQuery.mockResolvedValue({ rows: [] });
  });

  it('few-shot: DB-hiba (tábla hiányzik) → hint nélkül fut', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('relation "order_scan_samples" does not exist'));
    mockGeminiJson({ client: 'Test', confidence: 0.5 });
    const r = await call(ADMIN, IMG);
    expect(r.result.ok).toBe(true);
    expect(r.result.learned_from).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
//  confirmOrderScanTemplate — a diszpécser által mentett fuvar
//  mezőit sablonként eltárolja (few-shot tanulás).
// ═══════════════════════════════════════════════════════════════
describe('handlers/orderScan — confirmOrderScanTemplate', () => {
  beforeEach(() => {
    mockFeatureOn = true;
    mockDbQuery.mockReset();
    mockDbQuery.mockResolvedValue({ rows: [] });
  });

  function callConfirm(user, args) {
    return new Promise((resolve) => {
      const req = { session: { user } };
      const res = { json: (payload) => resolve(payload) };
      handler.confirmOrderScanTemplate(req, res, args);
    });
  }

  it('sofőrt elutasít', async () => {
    const r = await callConfirm(SOFER, [{ fields: { client: 'X' } }]);
    expect(r.result.ok).toBe(false);
  });

  it('csomag-flag KI → elutasít', async () => {
    mockFeatureOn = false;
    const r = await callConfirm(ADMIN, [{ fields: { client: 'X' } }]);
    expect(r.result.ok).toBe(false);
    expect(r.result.err).toMatch(/nedisponibila/i);
  });

  it('client nélkül no-op (nem tanul semmit)', async () => {
    const r = await callConfirm(ADMIN, [{ fields: {} }]);
    expect(r.result.ok).toBe(true);
    expect(r.result.noop).toBe(true);
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  it('mentéskor csak a megbízó azonosítója tárolódik — érték (pénznem/méret) NEM', async () => {
    const r = await callConfirm(ADMIN, [{ fields: { client: 'Vallor Logistics SRL', client_cui: 'RO123456', valuta: 'EUR', load_type: 'FTL' } }]);
    expect(r.result.ok).toBe(true);
    expect(r.result.template_key).toBe('vallor');
    const [sql, args] = mockDbQuery.mock.calls[0];
    expect(sql).toMatch(/'\{\}'::jsonb/);
    expect(args).toEqual([1, 'vallor', 'Vallor Logistics SRL', 'RO123456']);
  });

  it('javításból címkét tanul (order_scan_rules), a kiolvasást törli', async () => {
    const TEXT = 'ALFA SPEDITION SRL\nPunct A >> Oradea, Str. Lunga 4\n';
    mockDbQuery.mockImplementation(async (sql) => {
      if (/FROM order_scan_jobs/.test(sql)) return { rows: [{ text: TEXT, extracted: { client: 'ALFA SPEDITION SRL', loc_incarcare: null }, applied: {} }] };
      return { rows: [] };
    });
    const r = await callConfirm(ADMIN, [{ scan_id: 5, fields: { client: 'ALFA SPEDITION SRL', loc_incarcare: 'Oradea, Str. Lunga 4' } }]);
    expect(r.result.learned).toBe(1);
    const ins = mockDbQuery.mock.calls.find(([q]) => /INSERT INTO order_scan_rules/.test(q));
    expect(ins[1]).toEqual([1, 'alfa', 'loc_incarcare', 'punct a >>', 'same']);
    expect(mockDbQuery.mock.calls.some(([q, p]) => /DELETE FROM order_scan_jobs/.test(q) && p[0] === 5 && p[1] === 1)).toBe(true);
  });

  it('rövidítést (SC/SRL) átugrik, a második szót veszi', async () => {
    // A normalizeTemplateKey helper közvetlen tesztje — csak >=3 hosszú
    // + betűt tartalmazó szavak; „SC" (2 char) kimarad, „MOL" (3 char) marad.
    expect(handler._normalizeTemplateKey('SC MOL Romania SA')).toBe('mol');
    expect(handler._normalizeTemplateKey('SA')).toBe('');           // 2 karakteres kimarad
    expect(handler._normalizeTemplateKey('12 345 67')).toBe('');    // csak szám → nincs
    expect(handler._normalizeTemplateKey('')).toBe('');
    expect(handler._normalizeTemplateKey(null)).toBe('');
    // Diakritikák le
    expect(handler._normalizeTemplateKey('Ștefan Trans')).toBe('stefan');
  });

  it('DB-hiba (migráció nincs) → csendes noop, nem hasal el', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('relation does not exist'));
    const r = await callConfirm(ADMIN, [{ fields: { client: 'DHL' } }]);
    expect(r.result.ok).toBe(true);
    expect(r.result.noop).toBe(true);
  });
});
