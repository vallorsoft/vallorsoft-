// services/order-ai/gemini.js
// Mező-kiolvasás Google Gemini-vel (ingyenes tier). Multimodális: ha van PDF, közvetlenül
// azt olvassa (szöveges ÉS szkennelt is megy, OCR nélkül); különben a kinyert szöveget.
// Kulcs: process.env.GEMINI_API_KEY. Modell felülírható: process.env.GEMINI_MODEL.

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const TIMEOUT_MS = 30000;
const MAX_ATTEMPTS = 3;          // 1 eredeti + 2 újrapróba
const RETRY_WAIT_CAP_MS = 15000; // egy várakozás felső határa (ne blokkolja sokáig az ütemezőt)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A Gemini 429/503 hibatestből kiolvassa az ajánlott várakozást (RetryInfo.retryDelay: "21s").
function parseRetryDelayMs(body) {
  try {
    const details = (body && body.error && body.error.details) || [];
    for (const d of details) {
      if (d && d.retryDelay) {
        const m = String(d.retryDelay).match(/([\d.]+)\s*s/i);
        if (m) return Math.round(parseFloat(m[1]) * 1000);
      }
    }
  } catch (_) { /* nincs strukturált info */ }
  return null;
}

// Olvasható (magyar) hibaüzenet a nyers Gemini JSON helyett.
function friendlyError(status, body) {
  const apiMsg = (body && body.error && body.error.message) || '';
  if (status === 429) {
    const daily = /per\s*day|RequestsPerDay|daily/i.test(JSON.stringify(body || {}));
    return 'Gemini kvóta/sebességkorlát (429)'
      + (daily ? ' — a napi ingyenes keret elfogyott, holnap áll vissza' : ' — túl sok kérés rövid idő alatt')
      + '. A rendszer a beépített kiolvasásra váltott, kérlek ellenőrizd a mezőket kézzel.';
  }
  if (status === 503) return 'Gemini átmenetileg túlterhelt (503). A rendszer a beépített kiolvasásra váltott.';
  return 'Gemini hiba (' + status + ')' + (apiMsg ? ': ' + apiMsg : '') + '.';
}

async function callGemini(parts) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) { const e = new Error('Hiányzik a GEMINI_API_KEY.'); e.code = 'NO_KEY'; throw e; }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;
  const payload = JSON.stringify({
    systemInstruction: { parts: [{ text: PROMPT }] },
    contents: [{ role: 'user', parts }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0 },
  });

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res, txt;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        body: payload,
      });
      txt = await res.text();
    } finally { clearTimeout(t); }

    if (res.ok) {
      const data = JSON.parse(txt);
      const out = ((data.candidates || [])[0] || {}).content || {};
      const textOut = (out.parts || []).map(p => p.text || '').join('').trim();
      return JSON.parse(textOut.replace(/^```json\s*|\s*```$/g, ''));
    }

    // Hibás válasz — átmeneti (429/503) esetén megpróbáljuk újra
    let body = null; try { body = JSON.parse(txt); } catch (_) { /* nem JSON */ }
    const transient = res.status === 429 || res.status === 503;
    if (transient && attempt < MAX_ATTEMPTS) {
      const suggested = parseRetryDelayMs(body);
      const wait = Math.min(suggested != null ? suggested : attempt * 4000, RETRY_WAIT_CAP_MS);
      await sleep(wait);
      continue;
    }
    const e = new Error(friendlyError(res.status, body));
    e.status = res.status;
    throw e;
  }
}

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
