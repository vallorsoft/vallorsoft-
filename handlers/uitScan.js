// ============================================================
//  VallorSoft — handlers/uitScan.js
//  Papírra írt UIT-kód(ok) fotó → Gemini AI kiolvasás.
//  A sofőr a fuvarnál 📷 gombot nyom → mobil kamera → egy vagy több UIT-kód
//  szerepel a papíron → AI kiolvassa (max 16 alfanumerikus karakter/kód),
//  visszaadja mindegyiket külön. A hívó (kliens) menti mindegyiket a
//  fuvarhoz (order_uit_codes), és a fotót is (photo_b64 minden sorra).
//
//  Kapuk: bejelentkezés + Sofer|Admin|Manager + `ai-kiolvasas` csomag-flag
//  (a bon-scan-nel közösen — ha a cég AI-kiolvasást vett, azt is használhatja
//  UIT-hoz) + GEMINI_API_KEY. Válasz fehérlistán validálva.
// ============================================================
'use strict';

const { extractJson } = require('../lib/geminiJson');
const { featureEnabled } = require('../lib/featureEnabled');
const { normalizeUit, isValidUit } = require('../lib/uitFormat');
const audit = require('../lib/audit');

const handlers = {};

// Max 8 MB (mint a bon-scannernél).
const MAX_BYTES = 8 * 1024 * 1024;
// Egy fotón max 20 UIT-kód — reális papíros lista.
const MAX_CODES_PER_PHOTO = 20;

const UIT_PROMPT =
  'Ești un extractor de coduri UIT (Unique Identifier for Transport) — codurile pe care ANAF le emite ' +
  'pentru declarația e-Transport. Din imaginea primită (o fotografie a unei hârtii/tichete/bon) ' +
  'extrage TOATE codurile UIT vizibile. Un cod UIT are între 1 și 16 caractere alfanumerice ' +
  '(A-Z, 0-9), fără spații sau semne. Poate apărea cu sau fără cratime (ex. ABCD-1234-XYZ0). ' +
  'Răspunde STRICT cu un JSON de forma: {"codes":["ABCD1234XYZ0","EFGH5678"],"confidence":0.9}. ' +
  'REGULI: ' +
  '- „codes" este o listă de string-uri, fiecare max 16 caractere doar A-Z/0-9 (fără cratime în răspuns). ' +
  '- Dacă vezi doar UN cod, listează UN cod. Dacă vezi mai multe, listează-le pe toate. ' +
  '- IGNORĂ orice text care nu pare cod UIT (adrese, nume, date). ' +
  '- Dacă NU vezi niciun cod UIT valid, răspunde {"codes":[],"confidence":0}. ' +
  '- confidence (0..1) = cât de sigur ești în ansamblu.';

// Csak az ellenőrzött (fehérlistázott) mezők jutnak a kliensre.
function sanitize(json) {
  var codes = [];
  if (json && Array.isArray(json.codes)) {
    var seen = {};
    for (var i = 0; i < json.codes.length && codes.length < MAX_CODES_PER_PHOTO; i++) {
      var c = normalizeUit(json.codes[i]);
      if (isValidUit(c) && !seen[c]) { codes.push(c); seen[c] = true; }
    }
  }
  var conf = (json && typeof json.confidence === 'number') ? json.confidence : null;
  return { codes: codes, confidence: conf };
}

// ─── args[0]: { mimeType, data (base64) } ─────────────────────
handlers.scanUitFromImage = async function (req, res, args) {
  try {
    const u = req.session && req.session.user;
    if (!u) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const allowed = u.pozicio === 'Sofer' || u.pozicio === 'Admin' || u.pozicio === 'Manager';
    if (!allowed) return res.json({ result: { ok: false, err: 'Acces interzis' } });

    const cid = u.company_id;
    // A UIT-scan a bon-scan-nel közös csomag-kapun megy (ai-kiolvasas). Ha
    // a cég AI-kiolvasást vett, mindkettőt használhatja. Külön kapcsoló nem
    // kell — a fotó-kiolvasás egyazon Gemini-hívás mögött van.
    if (!(await featureEnabled(cid, 'ai-kiolvasas'))) {
      return res.json({ result: { ok: false, err: 'Functie AI nedisponibila in pachetul curent.' } });
    }
    if (!process.env.GEMINI_API_KEY) {
      return res.json({ result: { ok: false, err: 'Serviciul AI nu este configurat.' } });
    }

    const a = (args && args[0]) ? args[0] : {};
    const mimeType = String(a.mimeType || '').toLowerCase();
    const base64 = String(a.data || '');
    if (!mimeType.startsWith('image/')) {
      return res.json({ result: { ok: false, err: 'Format nesuportat (doar imagine).' } });
    }
    if (!base64) return res.json({ result: { ok: false, err: 'Fisier lipsa.' } });
    const approxBytes = Math.floor(base64.length * 0.75);
    if (approxBytes > MAX_BYTES) {
      return res.json({ result: { ok: false, err: 'Fisierul este prea mare (max 8 MB).' } });
    }

    const parts = [
      { inlineData: { mimeType: mimeType, data: base64 } },
      { text: 'Extrage codurile UIT.' },
    ];

    try {
      const { json, model } = await extractJson({ systemPrompt: UIT_PROMPT, parts: parts });
      const fields = sanitize(json);
      try {
        // Audit CSAK metaadat (modell + darab + confidence). A base64 SOHA
        // nem kerül logba / DB-be — csak a Gemini-hívás alatt él.
        await audit.fromReq(req, 'uit.scan', 'uit', null, {
          model: model, codes: fields.codes.length, confidence: fields.confidence,
        });
      } catch (_) { /* audit best-effort */ }
      return res.json({ result: { ok: true, codes: fields.codes, model: model, confidence: fields.confidence } });
    } catch (e) {
      console.warn('scanUitFromImage AI hiba:', { status: e.status, msg: e.message, attempts: e.attempts });
      const msg = String(e.message || 'Eroare AI').slice(0, 300);
      return res.json({ result: { ok: false, err: msg, status: e.status || 500 } });
    }
  } catch (e) {
    console.error('scanUitFromImage hiba:', e);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// Belső segéd — a teszt eléri, de RPC-n nem hívható.
Object.defineProperty(handlers, '_sanitize', { value: sanitize, enumerable: false });

module.exports = handlers;
