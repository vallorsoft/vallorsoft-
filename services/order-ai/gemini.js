// services/order-ai/gemini.js
// Mező-kiolvasás Google Gemini-vel (ingyenes tier). Multimodális: ha van PDF, közvetlenül
// azt olvassa (szöveges ÉS szkennelt is megy, OCR nélkül); különben a kinyert szöveget.
// Kulcs: process.env.GEMINI_API_KEY.
//
// MODELL-LÁNC (a napi kvóta megkerülésére): minden Gemini-modellnek KÜLÖN napi ingyenes
// kerete van. Ha az első modell 429-et ad (napi keret elfogyott / sebességkorlát), a
// kiolvasás automatikusan a következő modellre vált. Így több modell napi kerete adódik
// össze. Felülírható: GEMINI_MODEL (egy modell) vagy GEMINI_MODELS (vesszős lista).

const DEFAULT_MODELS = [
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b',
];

// A lánc összeállítása: env-felülírások előre, majd a maradék alapértelmezett (duplikátum nélkül).
const MODELS = (() => {
  const fromEnv = (process.env.GEMINI_MODELS || process.env.GEMINI_MODEL || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const m of [...fromEnv, ...DEFAULT_MODELS]) { if (!seen.has(m)) { seen.add(m); out.push(m); } }
  return out;
})();

const TIMEOUT_MS = 30000;
const MAX_ATTEMPTS = 3;          // modellenként: 1 eredeti + 2 újrapróba (perc-limitre)
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

async function callGemini(model, parts) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) { const e = new Error('Hiányzik a GEMINI_API_KEY.'); e.code = 'NO_KEY'; throw e; }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
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

    // Hibás válasz.
    // 429 (kvóta/sebességkorlát): NEM várunk a modellen belül — a hívó (extract) azonnal a
    //   következő modellre vált, amelynek külön napi kerete van. Ez a leggyorsabb megoldás.
    // 503/5xx (átmeneti szerver-túlterhelés): ugyanaz a modell jó, csak foglalt -> rövid újrapróba.
    let body = null; try { body = JSON.parse(txt); } catch (_) { /* nem JSON */ }
    const serverBusy = res.status === 503 || res.status === 500 || res.status === 502 || res.status === 504;
    if (serverBusy && attempt < MAX_ATTEMPTS) {
      const suggested = parseRetryDelayMs(body);
      const wait = Math.min(suggested != null ? suggested : attempt * 3000, RETRY_WAIT_CAP_MS);
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

// A Gemini inline kérés-limitje ~20 MB — a base64 ~33%-kal nagyobb a nyersnél,
// ezért 10 MB fölötti PDF-et nem küldünk inline (a kinyert szövegre esünk vissza).
const MAX_INLINE_PDF_BYTES = 10 * 1024 * 1024;

// { text, pdfBuffer, pdfName } -> { fields, confidence }
async function extract({ text, pdfBuffer, pdfName }) {
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

  // Végigmegyünk a modell-láncon: 429/503 (kvóta/túlterhelés) esetén a következő modell
  // jön (külön napi keret); minden más hiba (pl. 400) azonnal megáll.
  let lastErr;
  for (const model of MODELS) {
    try {
      const json = await callGemini(model, parts);
      const confidence = typeof json.confidence === 'number' ? json.confidence : 0.7;
      delete json.confidence;
      return { fields: json, confidence, model };
    } catch (e) {
      lastErr = e;
      if (e.status === 429 || e.status === 503) continue; // próbáljuk a következő modellt
      throw e;
    }
  }
  // Minden modell kvótája elfogyott / túlterhelt.
  const e = new Error('Minden Gemini-modell napi kerete elfogyott vagy túlterhelt (429/503). '
    + 'A rendszer a beépített kiolvasásra váltott, kérlek ellenőrizd a mezőket kézzel.');
  e.status = (lastErr && lastErr.status) || 429;
  throw e;
}

module.exports = { extract, FIELDS, MODELS, provider: 'gemini' };
