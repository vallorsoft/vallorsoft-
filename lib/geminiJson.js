// ============================================================
//  VallorSoft — lib/geminiJson.js
//  KÖZÖS Gemini JSON-kiolvasó — a fuvar-megrendelés e-mail parser
//  (services/order-ai/gemini.js) és a bon-scanner (handlers/
//  receiptScan.js) is EZT hívja. A modell-lánc (429/503 → következő
//  modell, mindegyiknek külön napi ingyenes kerete van), a 5xx-es
//  retry, a hibaüzenetek EGYETLEN forráson élnek → csak itt kell
//  frissíteni, ha új modell jön ki vagy változik a hibakezelés.
//
//  API:
//    const { extractJson, MODELS, DEFAULT_MODELS } = require('./geminiJson');
//    const { json, model } = await extractJson({ systemPrompt, parts, models? });
//      - systemPrompt: string — a rendszerutasítás
//      - parts: Array — a Gemini "contents.parts" tömbje (text/inlineData)
//      - models: opcionális modell-lista (a MODELS-t írja felül)
//      - kimenet: { json: parsed JSON, model: melyik modell adta a választ }
//      - dobás: Error e.status = HTTP státusz (429/503 → minden modell
//        elfogyott; egyéb → az első nem-recoverable hiba)
// ============================================================
'use strict';

// A modell-lánc — mindegyiknek KÜLÖN napi ingyenes kerete van, így a
// 429-es hibáknál (kvóta/perc-limit) a következő modellre váltunk, és
// a keretek gyakorlatilag összeadódnak. A sorrend:
//   1) Flash modellek — a legmagasabb napi ingyenes kerettel (~1500 RPD),
//      gyorsak, olcsók; a legtöbb bon/megrendelés ezekkel megy.
//   2) Pro modellek — alacsonyabb napi keret, DE erősebb pattern-matching:
//      nehezebb, homályos bonoknál (pl. rossz megvilágítás) segít.
//   3) Preview / experimental modellek — végső fallback.
// Mindegyik `separately` (külön) napi keretet fogyaszt → ha az összeset
// használjuk, akár ~10× több ingyenes bon-scan lehetséges naponta.
const DEFAULT_MODELS = [
  // Flash — magas napi keret, gyors
  'gemini-2.0-flash',
  'gemini-2.5-flash',
  'gemini-2.0-flash-lite',
  'gemini-2.5-flash-lite',
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b',
  // Flash preview / experimental
  'gemini-2.0-flash-exp',
  // Pro — erősebb, kisebb napi keret, jó fallback nehezebb bonokhoz
  'gemini-2.5-pro',
  'gemini-1.5-pro-002',
  'gemini-1.5-pro',
  // Végső fallback: kísérleti
  'gemini-exp-1206',
];

// A lánc összeállítása: env-felülírások előre, majd a maradék default
// (duplikátum nélkül). GEMINI_MODELS (vesszős) vagy GEMINI_MODEL (egy).
const MODELS = (() => {
  const fromEnv = (process.env.GEMINI_MODELS || process.env.GEMINI_MODEL || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const m of [...fromEnv, ...DEFAULT_MODELS]) {
    if (!seen.has(m)) { seen.add(m); out.push(m); }
  }
  return out;
})();

const TIMEOUT_MS = 30000;
const MAX_ATTEMPTS = 3;            // modellenként: 1 eredeti + 2 újrapróba (csak 5xx-re)
const RETRY_WAIT_CAP_MS = 15000;   // egy várakozás felső határa

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A Gemini 429/503 hibatestből a Google által javasolt várakozás
// ("RetryInfo.retryDelay: 21s") kiolvasása → ha van, azt tiszteljük.
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

function friendlyError(status, body) {
  const apiMsg = (body && body.error && body.error.message) || '';
  if (status === 429) {
    const daily = /per\s*day|RequestsPerDay|daily/i.test(JSON.stringify(body || {}));
    return 'Limită cotă/viteză Gemini (429)'
      + (daily ? ' — cota gratuită zilnică s-a epuizat, revine mâine' : ' — prea multe cereri într-un timp scurt')
      + '.';
  }
  if (status === 503) return 'Gemini este temporar supraîncărcat (503).';
  return 'Eroare Gemini (' + status + ')' + (apiMsg ? ': ' + apiMsg : '') + '.';
}

// Egy modell hívása JSON-válaszra. Belül: 5xx → rövid újrapróba
// (max MAX_ATTEMPTS); 429 vagy egyéb hiba → azonnal dob a hívónak.
async function callGemini(model, systemPrompt, parts) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) { const e = new Error('Lipsește GEMINI_API_KEY.'); e.code = 'NO_KEY'; throw e; }
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent';
  const payload = JSON.stringify({
    systemInstruction: { parts: [{ text: systemPrompt }] },
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
        // A kulcs headerben megy (query stringben proxy-/szerver-logokba
        // szivárogna).
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        signal: ctrl.signal,
        body: payload,
      });
      txt = await res.text();
    } finally { clearTimeout(t); }

    if (res.ok) {
      const data = JSON.parse(txt);
      const out = ((data.candidates || [])[0] || {}).content || {};
      const textOut = (out.parts || []).map((p) => p.text || '').join('').trim();
      return JSON.parse(textOut.replace(/^```json\s*|\s*```$/g, ''));
    }

    // Hibás válasz.
    // 429: NEM várunk a modellen belül — a hívó (extractJson) azonnal a
    //   következő modellre vált, amelynek külön napi kerete van.
    // 5xx: átmeneti szerver-túlterhelés → rövid újrapróba ugyanezen a modellen.
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

// Fő API: átfut a modell-láncon (429/503 → következő modell),
// az első sikeres JSON-választ visszaadja: { json, model }.
async function extractJson({ systemPrompt, parts, models } = {}) {
  const list = (Array.isArray(models) && models.length) ? models : MODELS;
  const attempts = [];   // diagnosztika: mi történt modellenként
  let lastErr;
  for (const model of list) {
    try {
      const json = await callGemini(model, systemPrompt || '', parts || []);
      // Sikeres modell — a korábbi kudarcokat naplóra tesszük (miért kellett ez a modell)
      if (attempts.length) {
        console.warn(`[geminiJson] Modell-lánc siker a(z) ${model}-nél. Előző kudarcok: ${attempts.map(a => a.model + ':' + a.status).join(', ')}`);
      }
      return { json, model };
    } catch (e) {
      lastErr = e;
      attempts.push({ model, status: e.status || 'err', msg: (e.message || '').slice(0, 100) });
      // 429/503: kvóta/túlterhelés → következő modell külön kerettel.
      // Egyéb (pl. 400 rossz kérés, 401 auth, 403 gate): azonnal áll.
      if (e.status === 429 || e.status === 503) continue;
      // Nem-recoverable hiba — de LOGGOLD, hogy diagnosztizálható legyen.
      console.warn(`[geminiJson] Modell-lánc megáll a(z) ${model}-nél (status ${e.status || 'err'}): ${(e.message || '').slice(0, 200)}`);
      throw e;
    }
  }
  // Minden modell 429/503 → részletes diagnosztika a naplóba, és a
  // hibaüzenetbe is az utolsó modell nevét + statuszát tesszük, hogy
  // a UI-n látszódjon, meddig ért a lánc.
  console.warn(`[geminiJson] Minden ${list.length} modell kimerítve: ${attempts.map(a => a.model + ':' + a.status).join(', ')}`);
  const lastStatus = (lastErr && lastErr.status) || 429;
  const e = new Error(
    'Toate cele ' + list.length + ' modele AI sunt supraîncărcate sau cota gratuită a fost epuizată (' + lastStatus + '). '
    + 'Reîncearcă mai târziu.');
  e.status = lastStatus;
  e.attempts = attempts;
  throw e;
}

module.exports = { extractJson, MODELS, DEFAULT_MODELS };
