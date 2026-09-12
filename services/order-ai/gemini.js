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
  // Több felrakó / lerakó pont (multi-drop). Ha csak egy-egy van a
  // dokumentumban, a legacy loc_incarcare/firma_incarcare/data_incarcare
  // mezőket használjuk; ha többet, a `pickups`/`deliveries` tömböket.
  'pickups', 'deliveries',
];

const PROMPT_BASE =
  'Ești un extractor de date din comenzi de transport (RO/HU/EN). Din documentul/atributul primit, ' +
  'extrage DOAR un obiect JSON cu cheile exacte: ' + FIELDS.join(', ') + '. ' +
  'Reguli: datele în format ISO (YYYY-MM-DD); pret și km și greutate ca numere (fără text); ' +
  'valuta ca RON/EUR; rendszam = numere de înmatriculare; ' +
  'loc_incarcare / loc_descarcare = localitatea de încărcare / descărcare (primul punct); ' +
  'firma_incarcare / firma_descarcare = denumirea firmei de la locul de încărcare / descărcare (expeditor / destinatar), NU clientul care comandă; ' +
  'load_type = "FTL" pentru marfă completă sau "LTL" pentru grupaj (dacă nu reiese clar, null); ' +
  'hossz_cm / szel_cm / mag_cm = dimensiunile mărfii în CENTIMETRI (convertește din m/mm dacă e nevoie); ' +
  'IMPORTANT — MULTI-DROP: DACĂ SUNT MAI MULTE PUNCTE de încărcare SAU descărcare (ex. 2 încărcări + 5 descărcări, sau 1 încărcare + 3 descărcări), ' +
  'ESTE OBLIGATORIU să completezi pickups[] și deliveries[] cu obiecte { loc, firma, data } — CÂTE UN ELEMENT PENTRU FIECARE PUNCT (nu doar primul!). ' +
  'Citește documentul cu atenție: caută liste numerotate ("1. …", "2. …"), tabele cu mai multe rânduri de încărcare/descărcare, secțiuni "Loading points" / "Delivery points" / "Puncte de încărcare" cu mai multe adrese. ' +
  'Primul element din pickups[] trebuie să corespundă cu loc_incarcare/firma_incarcare/data_incarcare de mai sus; primul din deliveries[] cu loc_descarcare. ' +
  'Dacă documentul are un SINGUR punct de încărcare ȘI un singur punct de descărcare, lasă pickups/deliveries = null. ' +
  'câmpurile necunoscute = null. ' +
  'Adaugă "confidence" (0..1) = cât de sigur ești în ansamblu. Răspunde STRICT cu JSON, fără text în plus.';

// Few-shot: a hívó (handlers/orderScan.js) legutóbb megerősített (max 5)
// ügyfél-mintát adhat át; ezek a Gemini prompt-jához csatolódnak példaként,
// hogy azonos megbízó megrendelői konzisztensebben olvasódjanak (valuta,
// load_type, tipikus méretek, cégnév-formátum, stops-szám). Csak a STABIL
// mezőket mutatjuk példaként — a per-fuvar értékek (dátum/ár/km/rendszám)
// szándékosan kimaradnak, hogy a Gemini ne másolja őket.
function buildPromptWithSamples(samples) {
  if (!Array.isArray(samples) || !samples.length) return PROMPT_BASE;
  let extra = '\n\nEXEMPLE CONFIRMATE anterior de această firmă (aceleași clienți / expeditori au același format de comandă — folosește-le ca ghid pentru interpretarea câmpurilor stabile: valuta, load_type, cum sunt scrise cegnevele expeditor/destinatar, câte puncte de încărcare/descărcare are de obicei; NU copia dățile/prețurile/rendszamurile, extrage-le mereu din comanda curentă):\n';
  samples.forEach((s, i) => {
    const f = s.fields || {};
    const example = {
      valuta: f.valuta || null,
      load_type: f.load_type || null,
      hossz_cm: f.hossz_cm || null,
      szel_cm: f.szel_cm || null,
      mag_cm: f.mag_cm || null,
      firma_incarcare: f.firma_incarcare || null,
      firma_descarcare: f.firma_descarcare || null,
      typical_pickups: f.typical_pickups || null,
      typical_deliveries: f.typical_deliveries || null,
    };
    const label = s.template_label || 'client';
    extra += `${i + 1}. ${label} → ${JSON.stringify(example)}\n`;
  });
  return PROMPT_BASE + extra;
}

// A Gemini inline kérés-limitje ~20 MB — a base64 ~33%-kal nagyobb a nyersnél,
// ezért 10 MB fölötti fájlt nem küldünk inline (a kinyert szövegre esünk vissza).
const MAX_INLINE_PDF_BYTES = 10 * 1024 * 1024;

// { text, pdfBuffer, pdfName, fileBuffer, mimeType, samples } -> { fields, confidence, model }
// A `pdfBuffer`/`application/pdf` a régi (e-mail intake) hívási forma; a
// `fileBuffer`+`mimeType` a általános (kép vagy PDF) út — a kettő ugyanoda fut.
// A `samples` (opcionális) a cég korábbi megerősített ügyfél-sablonjai —
// few-shot példaként a Gemini system-prompthoz csatolva (lásd `buildPromptWithSamples`).
async function extract({ text, pdfBuffer, fileBuffer, mimeType, samples /*, pdfName */ }) {
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
    const systemPrompt = buildPromptWithSamples(samples);
    const { json, model } = await extractJson({ systemPrompt, parts });
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
// Belső segédek — teszt eléri, RPC-n nem hívható (nem-enumerable).
Object.defineProperty(module.exports, '_buildPromptWithSamples', { value: buildPromptWithSamples, enumerable: false });
Object.defineProperty(module.exports, '_PROMPT_BASE', { value: PROMPT_BASE, enumerable: false });
