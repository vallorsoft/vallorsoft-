// ============================================================
//  VallorSoft — handlers/orderScan.js
//  Fuvar-kiírás közbeni dokumentum-feltöltés → AI kiolvasás.
//
//  A diszpécser a „Fuvar kiírás" oldalon feltölt egy megrendelőt
//  (PDF vagy fotó: jpg/png/webp/heic), az AI kiolvassa a mezőket, és a
//  kiíró űrlap mezői előtöltődnek — a „Fuvarfeladat mentése" gombbal a
//  fuvar egy lépésben elkészül, a feltöltött fájl pedig a fuvar
//  dokumentumai közé kerül (a kliens a meglévő `orderDocUpload`-ot hívja
//  a mentés után).
//
//  UGYANAZ a rendszer, mint az e-mailben kapott megrendelések kiolvasása:
//  a prompt/mező-készlet + modell-lánc a KÖZÖS `services/order-ai`-ból jön
//  (nincs párhuzamos AI-logika). PDF-nél a szöveges kinyerés (pdf-extract)
//  is megtörténik → AI-hiba esetén a heurisztikus tartalék tölt, ahogy az
//  e-mail-úton.
//
//  Kapuk: bejelentkezés + Admin|Manager + `ai-kiolvasas` csomag-flag.
//  A GEMINI_API_KEY hiánya NEM hiba: ilyenkor a heurisztikus kiolvasás fut
//  (mint az e-mail-intake AI-kikapcsolt módban), `ai_used:false` jelzéssel.
//  Válasz fehérlistán validálva (nincs „kreatív" kulcs-szivárgás a kliensbe).
//  Base64 max 8 MB. Audit-naplózva (`order.scan`) — CSAK metaadat, a
//  feltöltött fájl tartalma SOHA nem kerül naplóba.
// ============================================================
'use strict';

const pool = require('../db');
const orderAi = require('../services/order-ai');
const pdfx = require('../services/pdf-extract');
const { featureEnabled } = require('../lib/featureEnabled');
const audit = require('../lib/audit');

const handlers = {};

// Hány egyedi ügyfél-mintát csatolunk few-shot példaként a prompthoz.
// A minta a STABIL mezőket tanulja (valuta/load_type/tipikus méretek/
// cégnév-formátum/tipikus stops-szám) — a változó mezőket (dátum/ár/km/
// rendszám) szándékosan kihagyja, hogy a Gemini ne másolja őket.
const FEWSHOT_MAX = 5;

// Base64-inline felső határ (nyers bájtban). A Gemini inline limitje ~20 MB,
// itt szigorúbban 8 MB — egy megrendelő-PDF/mobilfotó bőven belefér.
const MAX_BYTES = 8 * 1024 * 1024;

// Elfogadott formátumok. A Gemini multimodálisan olvassa mindet (a HEIC-et
// is), a PDF-ből ráadásul szöveget is kinyerünk a heurisztikus tartaléknak.
const OK_MIME = [
  'application/pdf',
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
];

const _str = (v, max) => (v == null ? null : (String(v).trim().slice(0, max) || null));
const _num = (v) => {
  if (v == null || v === '') return null;
  const n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const _int = (v) => { const n = _num(v); return n == null ? null : Math.round(n); };

// Dátum: a Gemini ISO-t ad (YYYY-MM-DD), de tolerálunk teljes időbélyeget is.
// Kimenet: 'YYYY-MM-DD' vagy 'YYYY-MM-DDTHH:mm' (a datetime-local mezőnek).
function _date(v) {
  const s = String(v || '').trim();
  let m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(s);
  if (m) return m[1] + 'T' + m[2];
  m = /^(\d{4}-\d{2}-\d{2})$/.exec(s);
  return m ? m[1] : null;
}

// CSAK az ismert, ellenőrzött mezők kerülnek vissza a kliensre, a fuvar-kiíró
// űrlap mező-nevein (a `greutate` → `suly_kg`, mint a jóváhagyás-úton).
function sanitize(f) {
  const j = f || {};
  const load = ['FTL', 'LTL'].includes(String(j.load_type || '').toUpperCase())
    ? String(j.load_type).toUpperCase() : null;
  const plate = (v) => {
    const s = _str(v, 20);
    return s ? s.toUpperCase() : null;
  };
  // Multi-drop: a pickups[]/deliveries[] tömböt is fehérlistázott mezőkre
  // szűkítjük, per-stop max 20 sorra korlátozva. Ha üres, kihagyjuk (a kliens
  // a top-szintű loc_incarcare/loc_descarcare-ból generál 1+1 stopot).
  const _stopSanit = (arr) => {
    if (!Array.isArray(arr)) return null;
    const out = arr.slice(0, 20).map((s) => ({
      loc:   _str(s && s.loc, 200),
      firma: _str(s && s.firma, 200),
      data:  _date(s && s.data),
    })).filter((s) => s.loc || s.firma || s.data);
    return out.length ? out : null;
  };
  return {
    client: _str(j.client, 200),
    client_cui: _str(j.client_cui, 30),
    ref: _str(j.ref, 120),
    loc_incarcare: _str(j.loc_incarcare, 200),
    loc_descarcare: _str(j.loc_descarcare, 200),
    firma_incarcare: _str(j.firma_incarcare, 200),
    firma_descarcare: _str(j.firma_descarcare, 200),
    data_incarcare: _date(j.data_incarcare),
    data_descarcare: _date(j.data_descarcare),
    pret: _num(j.pret),
    valuta: _str(j.valuta, 8),
    km: _num(j.km),
    suly_kg: _num(j.suly_kg != null && j.suly_kg !== '' ? j.suly_kg : j.greutate),
    load_type: load,
    hossz_cm: _int(j.hossz_cm),
    szel_cm: _int(j.szel_cm),
    mag_cm: _int(j.mag_cm),
    rendszam_camion: plate(j.rendszam_camion),
    rendszam_remorca: plate(j.rendszam_remorca),
    observatii: _str(j.observatii, 500),
    pickups:    _stopSanit(j.pickups),
    deliveries: _stopSanit(j.deliveries),
  };
}

// Template-kulcs a kliens/megbízó nevéből: az első jelentős szó lecsupaszítva.
// „Vallor Logistics SRL" → „vallor"; „DHL Freight" → „dhl"; „Kuehne + Nagel" → „kuehne".
// Diakritikák levágva, csak a legalább 3 karakteres, betűt tartalmazó szó számít
// (a „SC"/„SRL"/„RO" rövidítéseket kizárja). Ez ugyanaz a mintázat, mint a
// bon-scanner `normalizeMerchant`-je — konzisztencia miatt.
function normalizeTemplateKey(client) {
  if (!client) return '';
  const words = String(client).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/).filter((w) => w.length >= 3 && /[a-z]/.test(w));
  return (words[0] || '').slice(0, 60);
}

// A cég korábban MEGERŐSÍTETT sablonjait tölti be (max FEWSHOT_MAX egyedi
// template_key, a legutóbb frissítettek). A tábla hiánya (első futás /
// migráció még nem futott le) → üres tömb, a scanOrderDocument tovább megy
// hint nélkül.
async function loadCompanySamples(cid) {
  if (!cid) return [];
  try {
    const r = await pool.query(
      `SELECT DISTINCT ON (template_key) template_label, fields, updated_at
         FROM order_scan_samples
        WHERE company_id = $1
        ORDER BY template_key, updated_at DESC`,
      [cid]);
    return r.rows
      .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
      .slice(0, FEWSHOT_MAX);
  } catch (_) { return []; /* tábla hiányzik → csendes fallback */ }
}

// ─── args[0]: { mimeType, data (base64), fileName? } ───────────
handlers.scanOrderDocument = async function (req, res, args) {
  try {
    const u = req.session && req.session.user;
    if (!u || !['Admin', 'Manager'].includes(u.pozicio)) {
      return res.json({ result: { ok: false, err: 'Acces interzis' } });
    }
    const cid = u.company_id;
    if (!(await featureEnabled(cid, 'ai-kiolvasas'))) {
      return res.json({ result: { ok: false, err: 'Functie AI nedisponibila in pachetul curent.' } });
    }

    const a = (args && args[0]) ? args[0] : {};
    const mimeType = String(a.mimeType || '').toLowerCase();
    const base64 = String(a.data || '');
    if (!base64) return res.json({ result: { ok: false, err: 'Fisier lipsa.' } });
    if (!OK_MIME.includes(mimeType)) {
      return res.json({ result: { ok: false, err: 'Format nesuportat (doar PDF, JPG, PNG, WEBP sau HEIC).' } });
    }
    const approxBytes = Math.floor(base64.length * 0.75);
    if (approxBytes > MAX_BYTES) {
      return res.json({ result: { ok: false, err: 'Fisierul este prea mare (max 8 MB).' } });
    }

    let buf;
    try { buf = Buffer.from(base64, 'base64'); }
    catch (_) { return res.json({ result: { ok: false, err: 'Fisier invalid.' } }); }
    if (!buf || !buf.length) return res.json({ result: { ok: false, err: 'Fisier invalid.' } });

    // PDF-nél a szöveges kinyerés is megtörténik: ez az AI-hiba /
    // kulcs-hiány esetén futó heurisztikus tartalék bemenete.
    let text = '';
    if (mimeType === 'application/pdf') {
      try { const ex = await pdfx.extractText(buf); text = ex.text || ''; }
      catch (_) { /* a szöveg-kinyerés hibája ne buktassa a kiolvasást */ }
    }

    // Tanulás: a cég legutóbbi 5 egyedi ügyfél-sablonját few-shot példaként
    // hozzáfűzzük a system-prompthoz. Best-effort — hiba esetén hint nélkül fut.
    const samples = await loadCompanySamples(cid);

    // A gomb explicit felhasználói kérés → AI-t kérünk (a `services/order-ai`
    // magától a heurisztikára esik vissza, ha nincs GEMINI_API_KEY vagy az AI
    // hibázik). Az e-mail-intake cégenkénti AI-kapcsolója itt szándékosan nem
    // szűr: az a levelek automatikus feldolgozását szabályozza.
    const r = await orderAi.extractFields({
      text,
      fileBuffer: buf,
      mimeType,
      pdfName: _str(a.fileName, 200) || undefined,
      aiEnabled: true,
      samples,
    });

    const fields = sanitize(r.fields);
    try {
      // Audit: CSAK metaadat (méret/típus/AI-használat/bizonyosság/minta-szám).
      // A fájl tartalma SOHA nem kerül audit-logba vagy DB-be ezen az úton — a
      // csatolás a kliens `orderDocUpload` hívásán megy, fuvar-id-hez kötve.
      await audit.fromReq(req, 'order.scan', 'order', null, {
        mime: mimeType, bytes: approxBytes, ai_used: r.ai_used,
        confidence: r.confidence, file_name: _str(a.fileName, 200),
        samples_used: samples.length,
      });
    } catch (_) { /* audit best-effort */ }

    return res.json({
      result: {
        ok: true,
        fields,
        confidence: typeof r.confidence === 'number' ? r.confidence : null,
        ai_used: !!r.ai_used,
        learned_from: samples.length,
      },
    });
  } catch (e) {
    // A hibaüzenet 300 karakteren csonkolva megy a kliensre (echo-back védelem).
    console.error('scanOrderDocument hiba:', e && e.message);
    return res.json({ result: { ok: false, err: String((e && e.message) || 'Eroare de server').slice(0, 300) } });
  }
};

// ─── A diszpécser által MEGERŐSÍTETT (a fuvar ténylegesen mentésre került)
// kiolvasás eltárolása template-ként. A kliens a `createOrder` sikere után
// best-effort hívja (mint a bon-scanner rrAccept-nél); ha hibázik, a fuvar
// mentve marad, csak a tanulás nem történik meg erre az iterációra.
// args[0]: { fields }  — a sanitize-elt fuvar-mezők (a scan után átnézett
// vagy módosított értékek; a kliens a `orderScanFill`-nél kapott `fields`-ből
// és az űrlap tényleges értékeiből építi).
handlers.confirmOrderScanTemplate = async function (req, res, args) {
  try {
    const u = req.session && req.session.user;
    if (!u || !['Admin', 'Manager'].includes(u.pozicio)) {
      return res.json({ result: { ok: false, err: 'Acces interzis' } });
    }
    const cid = u.company_id;
    if (!cid) return res.json({ result: { ok: false, err: 'Firma lipsa' } });
    // Konzisztens az scanOrderDocument kapujával — a csomag-flag ide is szól.
    if (!(await featureEnabled(cid, 'ai-kiolvasas'))) {
      return res.json({ result: { ok: false, err: 'Functie AI nedisponibila.' } });
    }

    const a = (args && args[0]) ? args[0] : {};
    // Ugyanaz a fehérlista, mint a scanOrderDocument-nél — nem propagál semmi
    // extra kulcsot, és a kliens által beírt „kreatív" mezőket kiszűri.
    const fields = sanitize(a.fields || {});
    if (!fields.client) {
      // Nincs mit tárolni — a template-azonosítás értelmetlen ügyfél-név nélkül.
      return res.json({ result: { ok: true, noop: true } });
    }
    const templateKey = normalizeTemplateKey(fields.client);
    if (!templateKey) return res.json({ result: { ok: true, noop: true } });

    // A TANULT mezők: csak a STABIL-ak (a per-fuvar értékeket — dátum/ár/km/
    // rendszám — szándékosan kihagyjuk). A typical_pickups/deliveries a
    // multi-stop szerkezetet írja le: hányat vár egy tipikus megrendelő.
    const learned = {
      valuta: fields.valuta,
      load_type: fields.load_type,
      hossz_cm: fields.hossz_cm,
      szel_cm: fields.szel_cm,
      mag_cm: fields.mag_cm,
      firma_incarcare: fields.firma_incarcare,
      firma_descarcare: fields.firma_descarcare,
      typical_pickups: Array.isArray(fields.pickups) ? fields.pickups.length : (fields.loc_incarcare ? 1 : null),
      typical_deliveries: Array.isArray(fields.deliveries) ? fields.deliveries.length : (fields.loc_descarcare ? 1 : null),
    };

    try {
      await pool.query(
        `INSERT INTO order_scan_samples
           (company_id, template_key, template_label, fields, sample_count, created_at, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, 1, NOW(), NOW())
         ON CONFLICT (company_id, template_key) DO UPDATE
           SET fields = EXCLUDED.fields,
               template_label = EXCLUDED.template_label,
               sample_count = order_scan_samples.sample_count + 1,
               updated_at = NOW()`,
        [cid, templateKey, fields.client, JSON.stringify(learned)]);
    } catch (dbErr) {
      // Migráció még nem futott → csendes; a scanOrderDocument továbbra is
      // működik hint nélkül (defenzív, hogy a UI ne törjön el).
      console.warn('confirmOrderScanTemplate DB skip:', dbErr.message);
      return res.json({ result: { ok: true, noop: true } });
    }

    try {
      await audit.fromReq(req, 'order.scan.confirm', 'order_template', null, {
        template_key: templateKey,
      });
    } catch (_) { /* audit best-effort */ }

    return res.json({ result: { ok: true, template_key: templateKey } });
  } catch (e) {
    console.error('confirmOrderScanTemplate hiba:', e);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// Belső segédek — a teszt eléri, de RPC-n nem hívhatók (nem-enumerable).
Object.defineProperty(handlers, '_sanitize', { value: sanitize, enumerable: false });
Object.defineProperty(handlers, '_normalizeTemplateKey', { value: normalizeTemplateKey, enumerable: false });
Object.defineProperty(handlers, '_loadCompanySamples', { value: loadCompanySamples, enumerable: false });

module.exports = handlers;
