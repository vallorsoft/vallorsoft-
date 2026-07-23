// services/order-ai/gemini.js
// Mező-kiolvasás Google Gemini-vel (ingyenes tier). Multimodális: ha van
// PDF, közvetlenül azt olvassa (szöveges ÉS szkennelt is megy, OCR nélkül);
// különben a kinyert szöveget. A modell-lánc + fetch/retry logika a KÖZÖS
// `lib/geminiJson.js`-ben él — egyetlen forrás, mind ez a modul, mind a
// bon-scanner (handlers/receiptScan.js) azt hívja. Kulcs: GEMINI_API_KEY.
'use strict';

const { extractJson, MODELS } = require('../../lib/geminiJson');

const FIELDS = [
  'client', 'client_cui', 'ref', 'loc_incarcare', 'loc_descarcare',
  'data_incarcare', 'data_descarcare', 'pret', 'valuta', 'km', 'greutate',
  'rendszam_camion', 'rendszam_remorca', 'observatii',
];

const PROMPT =
  'Ești un extractor de date din comenzi de transport (RO/HU/EN). Din documentul/atributul primit, ' +
  'extrage DOAR un obiect JSON cu cheile exacte: ' + FIELDS.join(', ') + '. ' +
  'Reguli: datele în format ISO (YYYY-MM-DD); pret și km și greutate ca numere (fără text); ' +
  'valuta ca RON/EUR; rendszam = numere de înmatriculare; câmpurile necunoscute = null. ' +
  'Adaugă "confidence" (0..1) = cât de sigur ești în ansamblu. Răspunde STRICT cu JSON, fără text în plus.';

// A Gemini inline kérés-limitje ~20 MB — a base64 ~33%-kal nagyobb a nyersnél,
// ezért 10 MB fölötti PDF-et nem küldünk inline (a kinyert szövegre esünk vissza).
const MAX_INLINE_PDF_BYTES = 10 * 1024 * 1024;

// { text, pdfBuffer, pdfName } -> { fields, confidence, model }
async function extract({ text, pdfBuffer /*, pdfName */ }) {
  let parts;
  if (pdfBuffer && pdfBuffer.length > MAX_INLINE_PDF_BYTES) {
    console.warn(`[Gemini] Túl nagy PDF az inline küldéshez (${Math.round(pdfBuffer.length / 1048576)} MB) — szöveges kinyerésre váltunk.`);
    pdfBuffer = null;
  }
  if (pdfBuffer && pdfBuffer.length) {
    parts = [
      { inlineData: { mimeType: 'application/pdf', data: pdfBuffer.toString('base64') } },
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
