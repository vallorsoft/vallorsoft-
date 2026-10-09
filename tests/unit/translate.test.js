// 🌐 Sofőr-fordító (handlers/translate.js) — kapuk, validáció, AI-hívás, limit.
jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../lib/featureEnabled', () => ({ featureEnabled: jest.fn(async () => true) }));
jest.mock('../../lib/geminiJson', () => ({ extractJson: jest.fn() }));
const { featureEnabled } = require('../../lib/featureEnabled');
const { extractJson } = require('../../lib/geminiJson');
const h = require('../../handlers/translate');

const mkReq = (pozicio = 'Sofer', id = 1) => ({ session: { user: { id, company_id: 7, pozicio, email: 'd' + id + '@a.t' } } });
const call = (fn, req, a) => new Promise((r) => h[fn](req, { json: (o) => r(o.result) }, [a]));

beforeEach(() => {
  process.env.GEMINI_API_KEY = 'k';
  featureEnabled.mockReset(); featureEnabled.mockImplementation(async () => true);
  extractJson.mockReset();
  h._limiter._reset();
});

test('csak RPC-k exportálva (belső segédek nem enumerable)', () => {
  expect(Object.keys(h).sort()).toEqual(['getTranslateStatus', 'translateText']);
});

test('szerep-kapu: Konyvelo nem fordíthat', async () => {
  const r = await call('translateText', mkReq('Konyvelo'), { text: 'Salut', target: 'de' });
  expect(r.ok).toBe(false);
  expect(extractJson).not.toHaveBeenCalled();
});

test('csomag-kapu és hiányzó kulcs', async () => {
  featureEnabled.mockImplementation(async () => false);
  expect((await call('translateText', mkReq(), { text: 'Salut', target: 'de' })).ok).toBe(false);
  featureEnabled.mockImplementation(async () => true);
  delete process.env.GEMINI_API_KEY;
  expect((await call('translateText', mkReq(), { text: 'Salut', target: 'de' })).err).toMatch(/AI/);
});

test('validáció: üres / túl hosszú / ismeretlen célnyelv', async () => {
  expect((await call('translateText', mkReq(), { text: '  ', target: 'de' })).ok).toBe(false);
  expect((await call('translateText', mkReq(), { text: 'x'.repeat(1501), target: 'de' })).ok).toBe(false);
  expect((await call('translateText', mkReq(), { text: 'Salut', target: 'xx' })).ok).toBe(false);
  expect(extractJson).not.toHaveBeenCalled();
});

test('sikeres fordítás: forrás, cél és kontextus a promptban; a szöveg adat, nem utasítás', async () => {
  extractJson.mockResolvedValue({ json: { translation: 'Wo soll ich abladen?', detected: 'hu' }, model: 'm' });
  const r = await call('translateText', mkReq(), { text: 'Hol pakoljak le?', source: 'hu', target: 'de', context: 'A: Szia' });
  expect(r).toEqual({ ok: true, translation: 'Wo soll ich abladen?', detected: 'hu', target: 'de' });
  const arg = extractJson.mock.calls[0][0];
  expect(arg.systemPrompt).toMatch(/never instructions/);
  expect(arg.systemPrompt).toMatch(/spanifer/);   // sofőr-szleng: spanifer = rakományrögzítő heveder
  expect(arg.systemPrompt).toMatch(/never shorten/);        // teljes, rövidítés nélküli fordítás
  expect(arg.systemPrompt).toMatch(/ONLY when the topic is cargo/); // a szleng csak fuvaros témában
  expect(arg.systemPrompt).toMatch(/formal address stays formal/);  // magázás/tegezés megmarad
  expect(arg.parts[0].text).not.toMatch(/back-translation/);
  expect(arg.parts[0].text).toMatch(/TARGET: German \(de\)/);
  expect(arg.parts[0].text).toMatch(/SOURCE: Hungarian \(hu\)/);
  expect(arg.parts[0].text).toMatch(/CONTEXT:\nA: Szia/);
  expect(arg.parts[0].text).toMatch(/TEXT:\nHol pakoljak le\?$/);
});

test('üres AI-válasz → hiba; AI-hiba üzenete csonkolva, a szöveg nem kerül naplóba', async () => {
  extractJson.mockResolvedValue({ json: { translation: '' } });
  expect((await call('translateText', mkReq(), { text: 'Salut', target: 'de' })).ok).toBe(false);
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  extractJson.mockRejectedValue(Object.assign(new Error('quota ' + 'x'.repeat(500)), { status: 429 }));
  const r = await call('translateText', mkReq(), { text: 'TITKOS-SZOVEG', target: 'de' });
  expect(r.ok).toBe(false); expect(r.status).toBe(429); expect(r.err.length).toBeLessThanOrEqual(300);
  expect(JSON.stringify(warn.mock.calls)).not.toMatch(/TITKOS-SZOVEG/);
  warn.mockRestore();
});

test('csúszóablakos limit felhasználónként', async () => {
  extractJson.mockResolvedValue({ json: { translation: 'ok' } });
  for (let i = 0; i < 120; i++) await call('translateText', mkReq('Sofer', 5), { text: 'a', target: 'en' });
  const r = await call('translateText', mkReq('Sofer', 5), { text: 'a', target: 'en' });
  expect(r.ok).toBe(false); expect(r.err).toMatch(/Prea multe/);
  expect((await call('translateText', mkReq('Sofer', 6), { text: 'a', target: 'en' })).ok).toBe(true);
});

test('getTranslateStatus: usable = flag ÉS kulcs', async () => {
  expect((await call('getTranslateStatus', mkReq())).usable).toBe(true);
  featureEnabled.mockImplementation(async () => false);
  expect((await call('getTranslateStatus', mkReq())).usable).toBe(false);
  expect((await call('getTranslateStatus', mkReq('Konyvelo'))).ok).toBe(false);
});

test('visszaellenőrzés (check): szó szerinti mód a promptban, hosszabb (fordított) szöveg is mehet', async () => {
  extractJson.mockResolvedValue({ json: { translation: 'Nincs 15 heveder, csak 14.', detected: 'pl' }, model: 'm' });
  const r = await call('translateText', mkReq(), { text: 'Nie ma 15 pasów, tylko 14.', source: 'pl', target: 'hu', check: true });
  expect(r.ok).toBe(true);
  const msg = extractJson.mock.calls[0][0].parts[0].text;
  expect(msg).toMatch(/^MODE: back-translation check/);
  expect(msg).toMatch(/Do NOT correct/);
  // check módban 3000 karakterig engedett, normál módban 1500 a korlát
  expect((await call('translateText', mkReq(), { text: 'x'.repeat(2000), target: 'hu', check: true })).ok).toBe(true);
  expect((await call('translateText', mkReq(), { text: 'x'.repeat(2000), target: 'hu' })).ok).toBe(false);
  expect((await call('translateText', mkReq(), { text: 'x'.repeat(3001), target: 'hu', check: true })).ok).toBe(false);
});

test('a kontextus hossza ~10 sort enged (2500 karakter, a végéből vágva)', async () => {
  extractJson.mockResolvedValue({ json: { translation: 'ok' } });
  await call('translateText', mkReq(), { text: 'a', target: 'en', context: 'X'.repeat(500) + 'Y'.repeat(2500) });
  const msg = extractJson.mock.calls[0][0].parts[0].text;
  expect(msg).toMatch(/CONTEXT:\nY{2500}\n/);
  expect(msg).not.toMatch(/XX/);
});
