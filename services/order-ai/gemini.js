// services/order-ai/gemini.js
// Mező-kiolvasás Google Gemini-vel (ingyenes tier). Multimodális: ha van
// fájl (PDF VAGY kép), közvetlenül azt olvassa (szöveges ÉS szkennelt is
// megy, OCR nélkül); különben a kinyert szöveget. A modell-lánc + fetch/retry
// logika a KÖZÖS `lib/geminiJson.js`-ben él — egyetlen forrás, mind ez a
// modul, mind a bon-scanner (handlers/receiptScan.js) azt hívja.
// Kulcs: GEMINI_API_KEY.
//
// Két hívó:
//   - `services/email-intake` → e-mail-melléklet (PDF) automatikus kiolvasása
//   - `handlers/orderScan.js` → a fuvar-kiíró „📄 Feltöltés + AI kiolvasás"
//     gombja (PDF vagy fotó) — UGYANEZ a prompt/mező-készlet.
'use strict';

const { extractJson, MODELS } = require('../../lib/geminiJson');

const FIELDS = [
  'client', 'client_cui', 'ref', 'loc_incarcare', 'loc_descarcare',
  'firma_incarcare', 'firma_descarcare',
  'data_incarcare', 'data_descarcare', 'pret', 'valuta', 'km', 'greutate',
  'load_type', 'hossz_cm', 'szel_cm', 'mag_cm',
  'rendszam_camion', 'rendszam_remorca', 'observatii',
];

const PROMPT =
  'Ești un extractor de date din comenzi de transport (RO/HU/EN). Din documentul/atributul primit, ' +
  'extrage DOAR un obiect JSON cu cheile exacte: ' + FIELDS.join(', ') + '. ' +
  'Reguli: datele în format ISO (YYYY-MM-DD); pret și km și greutate ca numere (fără text); ' +
  'valuta ca RON/EUR; rendszam = numere de înmatriculare; ' +
  'loc_incarcare / loc_descarcare = localitatea de încărcare / descărcare; ' +
  'firma_incarcare / firma_descarcare = denumirea firmei de la locul de încărcare / descărcare (expeditor / destinatar), NU clientul care comandă; ' +
  'load_type = "FTL" pentru marfă completă sau "LTL" pentru grupaj (dacă nu reiese clar, null); ' +
  'hossz_cm / szel_cm / mag_cm = dimensiunile mărfii în CENTIMETRI (convertește din m/mm dacă e nevoie); ' +
  'câmpurile necunoscute = null. ' +
  'Adaugă "confidence" (0..1) = cât de sigur ești în ansamblu. Răspunde STRICT cu JSON, fără text în plus.';

// A Gemini inline kérés-limitje ~20 MB — a base64 ~33%-kal nagyobb a nyersnél,
// ezért 10 MB fölötti fájlt nem küldünk inline (a kinyert szövegre esünk vissza).
const MAX_INLINE_PDF_BYTES = 10 * 1024 * 1024;

// { text, pdfBuffer, pdfName, fileBuffer, mimeType } -> { fields, confidence, model }
// A `pdfBuffer`/`application/pdf` a régi (e-mail intake) hívási forma; a
// `fileBuffer`+`mimeType` a általános (kép vagy PDF) út — a kettő ugyanoda fut.
async function extract({ text, pdfBuffer, fileBuffer, mimeType /*, pdfName */ }) {
  let parts;
  let buf = fileBuffer || pdfBuffer || null;
  let mime = fileBuffer ? (mimeType || 'application/octet-stream') : 'application/pdf';
  if (buf && buf.length > MAX_INLINE_PDF_BYTES) {
    console.warn(`[Gemini] Túl nagy fájl az inline küldéshez (${Math.round(buf.length / 1048576)} MB) — szöveges kinyerésre váltunk.`);
    buf = null;
  }
  if (buf && buf.length) {
    parts = [
      { inlineData: { mimeType: mime, data: buf.toString('base64') } },
      { text: 'Extrage datele comenzii din acest document.' },
    ];
  } else {
    parts = [{ text: 'Comanda (text):\n\n' + (text || '').slice(0, 20000) }];
  }

  try {
    const { json, model } = await extractJson({ systemPrompt: PROMPT, parts });
    const confidence = typeof json.confidence === 'number' ? json.confidence : 0.7;
    delete json.confidence;
    return { fields: json, confidence, model };
  } catch (e) {
    // Az eredeti modul emberbaráti üzenettel egészítette ki a 429/503-ast
    // ("Sistemul a comutat pe citirea integrată…") — ezt megtartjuk, hogy
    // a `services/order-ai/index.js` fallback-üzenete változatlan legyen.
    if (e.status === 429 || e.status === 503) {
      e.message = e.message + ' Sistemul a comutat pe citirea integrată, te rog verifică manual câmpurile.';
    }
    throw e;
  }
}

module.exports = { extract, FIELDS, MODELS, provider: 'gemini' };
