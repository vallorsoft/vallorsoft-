// services/order-ai/gemini.js
// Mező-kiolvasás Google Gemini-vel (ingyenes tier). Multimodális: ha van PDF, közvetlenül
// azt olvassa (szöveges ÉS szkennelt is megy, OCR nélkül); különben a kinyert szöveget.
// Kulcs: process.env.GEMINI_API_KEY. Modell felülírható: process.env.GEMINI_MODEL.

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const TIMEOUT_MS = 30000;

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

async function callGemini(parts) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) { const e = new Error('Hiányzik a GEMINI_API_KEY.'); e.code = 'NO_KEY'; throw e; }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: PROMPT }] },
        contents: [{ role: 'user', parts }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0 },
      }),
    });
    const txt = await res.text();
    if (!res.ok) { const e = new Error(`Gemini hiba (${res.status}). ${txt.slice(0, 300)}`); e.status = res.status; throw e; }
    const data = JSON.parse(txt);
    const out = ((data.candidates || [])[0] || {}).content || {};
    const textOut = (out.parts || []).map(p => p.text || '').join('').trim();
    return JSON.parse(textOut.replace(/^```json\s*|\s*```$/g, ''));
  } finally { clearTimeout(t); }
}

// { text, pdfBuffer, pdfName } -> { fields, confidence }
async function extract({ text, pdfBuffer, pdfName }) {
  let parts;
  if (pdfBuffer && pdfBuffer.length) {
    parts = [
      { inlineData: { mimeType: 'application/pdf', data: pdfBuffer.toString('base64') } },
      { text: 'Extrage datele comenzii din acest document.' },
    ];
  } else {
    parts = [{ text: 'Comanda (text):\n\n' + (text || '').slice(0, 20000) }];
  }
  const json = await callGemini(parts);
  const confidence = typeof json.confidence === 'number' ? json.confidence : 0.7;
  delete json.confidence;
  return { fields: json, confidence };
}

module.exports = { extract, FIELDS, provider: 'gemini' };
