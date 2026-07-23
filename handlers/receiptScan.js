// ============================================================
//  VallorSoft — handlers/receiptScan.js
//  Bon (fuvarozói tankolás/vásárlás) fotózás → Gemini kiolvasás → a
//  visszaadott mezők a sofőr menetlevél-piszkozatában egy új tankolás
//  vagy vásárlás sorba töltődnek.
//
//  ── TANULÁS (few-shot per-cég + per-merchant) ────────────────
//  Amikor a sofőr a review-modalban ELFOGADJA (rrAccept) az AI által
//  kiolvasott + általa átnézett/javított mezőket, a confirmReceiptExtraction
//  handler upsert-tel eltárolja a cég `receipt_scan_samples` tábláján a
//  merchant kulcs alapján (loc első szava normalizálva). A KÖVETKEZŐ
//  scanReceipt hívások a Gemini prompt-jába few-shot példaként odacsatolják
//  a cég legutóbbi (max 5) egyedi merchant-mintáját → a Gemini pattern-
//  matching-je konzisztensebb (ugyanaz a MOL/OMV/Kaufland bon mindig
//  ugyanúgy értelmezve).
//
//  Kapuk: bejelentkezés + Sofer|Admin|Manager + `ai-bon-scan` csomag-flag
//  (KÜLÖN az e-mail-kiolvasás `ai-kiolvasas` flag-jétől — az admin/manager
//  önmagának is engedélyezheti/tilthatja a Menetlevelek fülről) +
//  GEMINI_API_KEY env. Válasz fehérlistán validálva. Base64 max 8 MB.
//  Audit-naplózva (receipt.scan / receipt.confirm).
// ============================================================
'use strict';

const pool = require('../db');
const { extractJson } = require('../lib/geminiJson');
const { featureEnabled } = require('../lib/featureEnabled');
const audit = require('../lib/audit');

const handlers = {};

// Base64-inline felső határ. Mobil-fotó bőven belefér; nagyobb PDF-et is
// visszautasítunk (a Gemini inline limitje ~20 MB, itt szigorúbb: 8 MB nyers).
const MAX_BYTES = 8 * 1024 * 1024;

// Hány egyedi merchant mintát csatolunk few-shot példaként a prompthoz.
// 5 × ~150 token = ~750 token overhead → gemini-flash-nél elhanyagolható.
const FEWSHOT_MAX = 5;

const RECEIPT_PROMPT_BASE =
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

// Merchant azonosító a `loc` első jelentős szavából. "MOL Arad" → "mol";
// "OMV Petrom Bucuresti" → "omv"; "Kaufland" → "kaufland". Diakritikák
// levágva, csak a legalább 3 karakteres szavakat vesszük figyelembe (a
// "SC"/"SRL" jellegű rövidítéseket kiszűri).
function normalizeMerchant(loc) {
  if (!loc) return '';
  // Legalább 3 hosszú + LEGALÁBB egy betű (a pure-number szó — pl. bon-
  // szám vagy IP — nem merchant-név; és a rövidítéseket — SC/SRL/SA —
  // kizárjuk).
  const words = String(loc).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/).filter((w) => w.length >= 3 && /[a-z]/.test(w));
  return (words[0] || '').slice(0, 60);
}

// A cég korábban MEGERŐSÍTETT mintáit tölti be (max FEWSHOT_MAX egyedi
// merchant, a legutóbb frissítettek). Ha a tábla még nincs meg (első
// futás), üres tömböt ad — a scanReceipt tovább megy hint nélkül.
async function loadCompanySamples(cid) {
  if (!cid) return [];
  try {
    // Merchantonként a LEGFRISSEBB mintát; utána updated_at szerint sorbarakva
    // top-N. (DISTINCT ON + ORDER BY kényszere miatt kétlépcsős.)
    const r = await pool.query(
      `SELECT DISTINCT ON (merchant_key) merchant_label, fields, updated_at
         FROM receipt_scan_samples
        WHERE company_id = $1
        ORDER BY merchant_key, updated_at DESC`,
      [cid]);
    return r.rows
      .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
      .slice(0, FEWSHOT_MAX);
  } catch (_) { return []; /* tábla hiányzik → csendes fallback */ }
}

// A minták FEW-SHOT beépítése a system-promptba. Csak a STABIL mezőket
// (kind/loc/tip/plata/valuta/produs) mutatjuk példaként — a változókat
// (data/suma/litru/km) nem, hogy a Gemini ne másolja őket.
function buildSystemPrompt(samples) {
  if (!samples || !samples.length) return RECEIPT_PROMPT_BASE;
  let extra = '\n\nEXEMPLE CONFIRMATE anterior de această firmă (aceleași lanțuri au același format de bon — folosește-le ca ghid pentru poziția și interpretarea câmpurilor; NU copia sumele/datele, extrage-le mereu din bonul curent):\n';
  samples.forEach((s, i) => {
    const f = s.fields || {};
    const example = {
      kind: f.kind || null,
      loc: f.loc || null,
      tip: f.tip || null,
      plata: f.plata || null,
      valuta: f.valuta || null,
      produs: f.produs || null,
    };
    const label = s.merchant_label || f.loc || 'merchant';
    extra += `${i + 1}. ${label} → ${JSON.stringify(example)}\n`;
  });
  return RECEIPT_PROMPT_BASE + extra;
}

// ─── args[0]: { mimeType, data (base64) } ─────────────────────
handlers.scanReceipt = async function (req, res, args) {
  try {
    const u = req.session && req.session.user;
    if (!u) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const allowed = u.pozicio === 'Sofer' || u.pozicio === 'Admin' || u.pozicio === 'Manager';
    if (!allowed) return res.json({ result: { ok: false, err: 'Acces interzis' } });

    const cid = u.company_id;
    if (!(await featureEnabled(cid, 'ai-bon-scan'))) {
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
    const approxBytes = Math.floor(base64.length * 0.75);
    if (approxBytes > MAX_BYTES) return res.json({ result: { ok: false, err: 'Fisierul este prea mare (max 8 MB).' } });

    // Tanulás: a cég legutóbbi 5 egyedi merchant-mintáját few-shot példaként
    // hozzáfűzzük a system-prompthoz.
    const samples = await loadCompanySamples(cid);
    const systemPrompt = buildSystemPrompt(samples);
    const parts = [
      { inlineData: { mimeType, data: base64 } },
      { text: 'Extrage datele bonului fiscal.' },
    ];

    try {
      const { json, model } = await extractJson({ systemPrompt, parts });
      const fields = sanitize(json);
      try {
        // Audit-napló: CSAK metaadat (modell + kind + confidence + minta-szám).
        // A base64 kép SOHA nem kerül audit-logba / DB-be — csak a Gemini
        // hívás alatt él memóriában, utána GC.
        await audit.fromReq(req, 'receipt.scan', 'receipt', null, {
          model, kind: fields.kind, confidence: fields.confidence, samples_used: samples.length,
        });
      } catch (_) { /* audit best-effort */ }
      return res.json({ result: { ok: true, fields, model, learned_from: samples.length } });
    } catch (e) {
      // Diagnosztika: minden AI-hiba naplózva a szerveren (bővített részletek)
      // — a base64 SOHA nem kerül a naplóba (csak státusz + üzenet + attempts).
      console.warn('scanReceipt AI hiba:', {
        status: e.status, msg: e.message, attempts: e.attempts,
      });
      // A kliensnek: 300 karakterre CSONKOLT üzenet + státusz (echo-back védelem).
      const msg = String(e.message || 'Eroare AI').slice(0, 300);
      return res.json({ result: { ok: false, err: msg, status: e.status || 500 } });
    }
  } catch (e) {
    console.error('scanReceipt hiba:', e);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// ─── A sofőr által MEGERŐSÍTETT extraktum eltárolása template-ként.
// A kliens rrAccept-je best-effort hívja; ha hibázik, a sofőr sem szenvedi
// meg (a menetlevél-piszkozatba már bekerült a sor).
// args[0]: { fields }
handlers.confirmReceiptExtraction = async function (req, res, args) {
  try {
    const u = req.session && req.session.user;
    if (!u) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const allowed = u.pozicio === 'Sofer' || u.pozicio === 'Admin' || u.pozicio === 'Manager';
    if (!allowed) return res.json({ result: { ok: false, err: 'Acces interzis' } });

    const cid = u.company_id;
    if (!cid) return res.json({ result: { ok: false, err: 'Firma lipsa' } });
    // A tanulás-tároláson is legyen a csomag-kapu — konzisztens az scanReceipt-tel.
    if (!(await featureEnabled(cid, 'ai-bon-scan'))) {
      return res.json({ result: { ok: false, err: 'Functie AI nedisponibila.' } });
    }

    const a = (args && args[0]) ? args[0] : {};
    const fields = sanitize(a.fields || {});
    if (!fields.kind || !fields.loc) {
      // Nincs mit tárolni — a merchant azonosítás értelmetlen loc nélkül.
      return res.json({ result: { ok: true, noop: true } });
    }
    const merchant = normalizeMerchant(fields.loc);
    if (!merchant) return res.json({ result: { ok: true, noop: true } });

    try {
      await pool.query(
        `INSERT INTO receipt_scan_samples
           (company_id, merchant_key, merchant_label, fields, sample_count, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 1, NOW(), NOW())
         ON CONFLICT (company_id, merchant_key) DO UPDATE
           SET fields = EXCLUDED.fields,
               merchant_label = EXCLUDED.merchant_label,
               sample_count = receipt_scan_samples.sample_count + 1,
               updated_at = NOW()`,
        [cid, merchant, fields.loc, JSON.stringify(fields)]);
    } catch (dbErr) {
      // A tábla hiányzik / DB-hiba → csendes; a scanReceipt továbbra is
      // működik hint nélkül (defenzív, hogy a UI ne törjön el).
      console.warn('confirmReceiptExtraction DB skip:', dbErr.message);
      return res.json({ result: { ok: true, noop: true } });
    }

    try {
      await audit.fromReq(req, 'receipt.confirm', 'receipt', null, {
        merchant, kind: fields.kind,
      });
    } catch (_) { /* audit best-effort */ }

    return res.json({ result: { ok: true, merchant } });
  } catch (e) {
    console.error('confirmReceiptExtraction hiba:', e);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// ─── ÖNKISZOLGÁLÓ FEATURE-KAPCSOLÓ + TANULT MINTÁK KEZELÉS ─────
//
// A developer bármelyik cégre bekapcsolhatja a `company_features`-be
// tetszőleges kulcsot; itt egy KORLÁTOZOTT (fehérlistás) admin/manager
// self-service utat adunk arra a SAJÁT kulcsra, ami az ő cégük napi
// üzemeltetéséhez kell (jelenleg: `ai-bon-scan`). Így nem kell a
// developerre várniuk, ha ki akarják kapcsolni a bon-scanner AI-t.
// A developer felület továbbra is ELSŐBBSÉGET élvez (ő minden kulcsot
// kezelhet); ez csak a saját cégüknek szól, csak erre az EGY kulcsra.

const SELF_ALLOWED_KEYS = ['ai-bon-scan'];

function _isAdminOrManager(u) {
  return !!(u && (u.pozicio === 'Admin' || u.pozicio === 'Manager'));
}

// A jelenlegi feature-állapot lekérése (cég-override + a plan default is).
// A UI a kapcsolót ez alapján rajzolja ki. Read-only, Admin/Manager.
handlers.getBonScanSettings = async function (req, res /*, args */) {
  try {
    const u = req.session && req.session.user;
    if (!_isAdminOrManager(u)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = u.company_id;
    // A featureEnabled() a teljes hierarchiát (company_features >
    // plan_features > default:true) figyelembe véve ad választ.
    const enabled = await featureEnabled(cid, 'ai-bon-scan');
    // Ha van cég-szintű override, jelöljük — a UI mutathatja: „a cég
    // felülírta a csomag alapértékét".
    let override = null;
    try {
      const r = await pool.query(
        'SELECT enabled FROM company_features WHERE company_id = $1 AND feature_key = $2',
        [cid, 'ai-bon-scan']);
      if (r.rows.length) override = r.rows[0].enabled;
    } catch (_) { /* company_features nem létezik / DB hiba → null */ }

    // A cég betanult mintáinak listája (merchantonként egy sor); a UI
    // itt mutatja, mit tanult meg a rendszer eddig, és honnan törölhet.
    let samples = [];
    try {
      const r2 = await pool.query(
        `SELECT id, merchant_key, merchant_label, fields, sample_count, updated_at
           FROM receipt_scan_samples
          WHERE company_id = $1
          ORDER BY updated_at DESC`,
        [cid]);
      samples = r2.rows;
    } catch (_) { /* migráció még nem futott → üres lista */ }

    return res.json({ result: { ok: true, enabled: !!enabled, override, samples } });
  } catch (e) {
    console.error('getBonScanSettings hiba:', e);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// A saját cégére Admin/Manager BE/KI-kapcsolja a `ai-bon-scan` flag-et.
// Csak fehérlistás kulcs. Audit-naplózva. A developer felett-nem-áll (a
// cég-override rögzül; a developer később felülírhatja).
handlers.setBonScanEnabled = async function (req, res, args) {
  try {
    const u = req.session && req.session.user;
    if (!_isAdminOrManager(u)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = u.company_id;
    const a = (args && args[0]) ? args[0] : {};
    // A fehérlista védi a hívást — a jelenlegi API csak `ai-bon-scan`-t
    // enged; nem lehet ezen keresztül más flag-et állítani.
    const key = SELF_ALLOWED_KEYS.includes(a.key) ? a.key : 'ai-bon-scan';
    const enabled = !!a.enabled;
    try {
      await pool.query(
        `INSERT INTO company_features (company_id, feature_key, enabled, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (company_id, feature_key) DO UPDATE
           SET enabled = EXCLUDED.enabled, updated_at = NOW()`,
        [cid, key, enabled]);
    } catch (dbErr) {
      console.warn('setBonScanEnabled DB hiba:', dbErr.message);
      return res.json({ result: { ok: false, err: 'Eroare la salvarea setării' } });
    }
    try { await audit.fromReq(req, 'feature.set', 'company_feature', String(cid), { key, enabled }); } catch (_) {}
    return res.json({ result: { ok: true, key, enabled } });
  } catch (e) {
    console.error('setBonScanEnabled hiba:', e);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// A sofőr főoldali gombja csak akkor jelenjen meg, ha a cégnél ez a flag
// be van kapcsolva ÉS van API-kulcs — így nem lát értelmetlen gombot,
// amitől mindig hibaüzenetet kapna. Bejelentkezett user (Sofer|Admin|
// Manager). Nem szivárog cég-belső infó (csak a bool).
handlers.getMyBonScanEnabled = async function (req, res /*, args */) {
  try {
    const u = req.session && req.session.user;
    if (!u) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const allowed = u.pozicio === 'Sofer' || u.pozicio === 'Admin' || u.pozicio === 'Manager';
    if (!allowed) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = u.company_id;
    const flag = await featureEnabled(cid, 'ai-bon-scan');
    const hasKey = !!process.env.GEMINI_API_KEY;
    // A UI a `usable`-t nézi (a két feltétel együtt); a `flag` és `hasKey`
    // csak diagnosztikai (a bug-jelentőnek hasznos).
    return res.json({ result: { ok: true, enabled: !!flag, hasKey, usable: !!(flag && hasKey) } });
  } catch (e) {
    console.error('getMyBonScanEnabled hiba:', e);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// Betanult minta törlése (pl. a Gemini rossz merchant-neve alá tanult).
// Csak Admin/Manager és csak a SAJÁT cégük mintáit (WHERE company_id=$).
handlers.deleteBonScanSample = async function (req, res, args) {
  try {
    const u = req.session && req.session.user;
    if (!_isAdminOrManager(u)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = u.company_id;
    const id = parseInt((args && args[0] && args[0].id), 10);
    if (!Number.isFinite(id) || id <= 0) return res.json({ result: { ok: false, err: 'ID lipsă / invalid.' } });
    let rowCount = 0;
    try {
      const r = await pool.query(
        'DELETE FROM receipt_scan_samples WHERE id = $1 AND company_id = $2',
        [id, cid]);
      rowCount = r.rowCount || 0;
    } catch (dbErr) {
      console.warn('deleteBonScanSample DB hiba:', dbErr.message);
      return res.json({ result: { ok: false, err: 'Eroare la ștergere' } });
    }
    if (!rowCount) return res.json({ result: { ok: false, err: 'Nu s-a găsit sau nu aparține firmei tale.' } });
    try { await audit.fromReq(req, 'receipt.sample.delete', 'receipt_sample', String(id), {}); } catch (_) {}
    return res.json({ result: { ok: true, deleted: rowCount } });
  } catch (e) {
    console.error('deleteBonScanSample hiba:', e);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// Belső segédek — a teszt eléri, de RPC-n nem hívhatók (nem-enumerable).
Object.defineProperty(handlers, '_sanitize', { value: sanitize, enumerable: false });
Object.defineProperty(handlers, '_normalizeMerchant', { value: normalizeMerchant, enumerable: false });
Object.defineProperty(handlers, '_buildSystemPrompt', { value: buildSystemPrompt, enumerable: false });
Object.defineProperty(handlers, '_loadCompanySamples', { value: loadCompanySamples, enumerable: false });
Object.defineProperty(handlers, '_SELF_ALLOWED_KEYS', { value: SELF_ALLOWED_KEYS, enumerable: false });

module.exports = handlers;
