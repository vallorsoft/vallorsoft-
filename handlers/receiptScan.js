// ============================================================
//  VallorSoft — handlers/receiptScan.js
//  Bon (fuvarozói tankolás/vásárlás) fotózás → Gemini kiolvasás → a
//  visszaadott mezők a sofőr menetlevél-piszkozatában egy új tankolás
//  vagy vásárlás sorba töltődnek. A már meglévő /reparse-nál használt
//  Gemini modell-lánc (429/503 → következő modell) itt is; a promt bon-
//  specifikus. Csomag-kapu: 'ai-kiolvasas' (mint az inbound-reparse).
// ============================================================
const { featureEnabled } = require('../lib/featureEnabled');
const audit = require('../lib/audit');

const handlers = {};

// Modell-lánc — a Gemini-adapterrel azonos szemantikájú (külön napi kvóták
// összegződnek). Env-felülírás: GEMINI_MODELS (vesszős) vagy GEMINI_MODEL.
const DEFAULT_MODELS = [
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b',
];
const MODELS = (() => {
  const fromEnv = (process.env.GEMINI_MODELS || process.env.GEMINI_MODEL || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const m of [...fromEnv, ...DEFAULT_MODELS]) { if (!seen.has(m)) { seen.add(m); out.push(m); } }
  return out;
})();

const TIMEOUT_MS = 30000;
// Base64-inline felső határ. Mobil-fotó bőven belefér; nagyobb PDF-et is
// visszautasítunk (a Gemini inline limitje ~20 MB, itt szigorúbb: 8 MB nyers).
const MAX_BYTES = 8 * 1024 * 1024;

const RECEIPT_PROMPT =
  'Ești un extractor de date din bon fiscal / chitanță (RO/HU/EN) — combustibil sau achiziții. ' +
  'Din imaginea/PDF-ul primit, extrage DOAR un obiect JSON cu cheile exacte: ' +
  'kind, loc, data, tip, litru, km, plata, suma, valuta, produs, confidence. ' +
  'Reguli: ' +
  '- kind = "fuel" dacă bonul este pentru combustibil (Motorină/AdBlue/benzină), altfel "purchase" (mâncare, ulei, spălare, taxe, etc.). ' +
  '- loc = localitatea (fallback: numele stației/magazinului), FĂRĂ adresa completă. ' +
  '- data = "YYYY-MM-DD" (data bonului, fus orar Europe/Bucharest). ' +
  '- tip = "Motorină" sau "AdBlue" doar pentru kind=fuel, altfel null. ' +
  '- litru = numărul de litri (până la 3 zecimale) doar pentru fuel, altfel null. ' +
  '- km = kilometrajul dacă apare pe bon (ex. bon Flota Card), altfel null. ' +
  '- plata = "Card", "Cash", "Flota Card" sau "DKV" (cea mai probabilă interpretare). ' +
  '- suma = totalul plătit ca număr (fără simbol valută, punct pentru zecimale, fără separatori de mii). ' +
  '- valuta = "RON", "EUR", "HUF" sau "USD". ' +
  '- produs = descriere scurtă a articolului doar pentru kind=purchase, altfel null. ' +
  '- Câmpurile necunoscute = null. ' +
  '- confidence (0..1) = cât de sigur ești în ansamblu. ' +
  'Răspunde STRICT cu JSON, fără text în plus.';

async function callGemini(model, mimeType, base64) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) { const e = new Error('Lipsește GEMINI_API_KEY.'); e.code = 'NO_KEY'; throw e; }
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent';
  const parts = [
    { inlineData: { mimeType, data: base64 } },
    { text: 'Extrage datele bonului fiscal.' },
  ];
  const payload = JSON.stringify({
    systemInstruction: { parts: [{ text: RECEIPT_PROMPT }] },
    contents: [{ role: 'user', parts }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0 },
  });
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res, txt;
  try {
    res = await fetch(url, {
      method: 'POST',
      // A kulcs headerben megy (nem query stringben) — a query string
      // proxy-/szerver-logokba kerülhetne.
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
  let body = null; try { body = JSON.parse(txt); } catch (_) { /* nem JSON */ }
  const apiMsg = (body && body.error && body.error.message) || '';
  const e = new Error('Eroare Gemini (' + res.status + ')' + (apiMsg ? ': ' + apiMsg : '') + '.');
  e.status = res.status;
  throw e;
}

// Csak az ismert, ellenőrzött mezők kerülnek vissza a kliensre (a Gemini
// "kreatív" kulcsait nem propagáljuk; a plata/tip fehérlistázott).
function sanitize(json) {
  const kind = json && json.kind === 'fuel' ? 'fuel'
    : (json && json.kind === 'purchase' ? 'purchase' : null);
  const _num = (v) => { if (v == null || v === '') return null; const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
  const _str = (v, max) => v == null ? null : (String(v).trim().slice(0, max) || null);
  const plataOK = ['Card', 'Cash', 'Flota Card', 'DKV'];
  const tipOK = ['Motorină', 'AdBlue'];
  const plata = plataOK.includes(json && json.plata) ? json.plata : null;
  const tip = tipOK.includes(json && json.tip) ? json.tip : null;
  const data = json && /^\d{4}-\d{2}-\d{2}$/.test(json.data || '') ? json.data : null;
  return {
    kind,
    loc: _str(json && json.loc, 200),
    data,
    tip,
    litru: _num(json && json.litru),
    km: _num(json && json.km),
    plata,
    suma: _num(json && json.suma),
    valuta: _str(json && json.valuta, 8),
    produs: _str(json && json.produs, 200),
    confidence: (json && typeof json.confidence === 'number') ? json.confidence : null,
  };
}

// args[0]: { mimeType, data (base64) }
handlers.scanReceipt = async function (req, res, args) {
  try {
    const u = req.session && req.session.user;
    if (!u) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    // Sofer a saját menetleveléhez, Admin/Manager a kézi menetlevélhez használhatja.
    const allowed = u.pozicio === 'Sofer' || u.pozicio === 'Admin' || u.pozicio === 'Manager';
    if (!allowed) return res.json({ result: { ok: false, err: 'Acces interzis' } });

    const cid = u.company_id;
    if (!(await featureEnabled(cid, 'ai-kiolvasas'))) {
      return res.json({ result: { ok: false, err: 'Functie AI nedisponibila in pachetul curent.' } });
    }
    if (!process.env.GEMINI_API_KEY) {
      return res.json({ result: { ok: false, err: 'Serviciul AI nu este configurat.' } });
    }

    const a = (args && args[0]) ? args[0] : {};
    const mimeType = String(a.mimeType || '').toLowerCase();
    const base64 = String(a.data || '');
    const okMime = mimeType.startsWith('image/') || mimeType === 'application/pdf';
    if (!okMime) return res.json({ result: { ok: false, err: 'Format nesuportat (doar imagine sau PDF).' } });
    if (!base64) return res.json({ result: { ok: false, err: 'Fisier lipsa.' } });
    // Base64 nyers-méret becslés (b64_len * 3/4).
    const approxBytes = Math.floor(base64.length * 0.75);
    if (approxBytes > MAX_BYTES) return res.json({ result: { ok: false, err: 'Fisierul este prea mare (max 8 MB).' } });

    let lastErr;
    for (const model of MODELS) {
      try {
        const json = await callGemini(model, mimeType, base64);
        const fields = sanitize(json);
        try { await audit.fromReq(req, 'receipt.scan', 'receipt', null, { model, kind: fields.kind, confidence: fields.confidence }); } catch (_) {}
        return res.json({ result: { ok: true, fields, model } });
      } catch (e) {
        lastErr = e;
        // 429/503: kvóta/túlterhelés → következő modell (külön napi keret).
        if (e.status === 429 || e.status === 503) continue;
        // Egyéb hiba: azonnal állj.
        return res.json({ result: { ok: false, err: e.message || 'Eroare AI' } });
      }
    }
    return res.json({ result: {
      ok: false,
      err: 'Toate modelele AI sunt supraincarcate sau cota a fost epuizata. Reincearca mai tarziu sau introdu manual.',
      status: (lastErr && lastErr.status) || 429,
    } });
  } catch (e) {
    console.error('scanReceipt hiba:', e);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// Belső segéd — a teszt eléri, de RPC-n nem hívható (nem-enumerable).
Object.defineProperty(handlers, '_sanitize', { value: sanitize, enumerable: false });

module.exports = handlers;
