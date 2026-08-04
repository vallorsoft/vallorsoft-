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

const orderAi = require('../services/order-ai');
const pdfx = require('../services/pdf-extract');
const { featureEnabled } = require('../lib/featureEnabled');
const audit = require('../lib/audit');

const handlers = {};

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
    });

    const fields = sanitize(r.fields);
    try {
      // Audit: CSAK metaadat (méret/típus/AI-használat/bizonyosság). A fájl
      // tartalma SOHA nem kerül audit-logba vagy DB-be ezen az úton — a
      // csatolás a kliens `orderDocUpload` hívásán megy, fuvar-id-hez kötve.
      await audit.fromReq(req, 'order.scan', 'order', null, {
        mime: mimeType, bytes: approxBytes, ai_used: r.ai_used,
        confidence: r.confidence, file_name: _str(a.fileName, 200),
      });
    } catch (_) { /* audit best-effort */ }

    return res.json({
      result: {
        ok: true,
        fields,
        confidence: typeof r.confidence === 'number' ? r.confidence : null,
        ai_used: !!r.ai_used,
      },
    });
  } catch (e) {
    // A hibaüzenet 300 karakteren csonkolva megy a kliensre (echo-back védelem).
    console.error('scanOrderDocument hiba:', e && e.message);
    return res.json({ result: { ok: false, err: String((e && e.message) || 'Eroare de server').slice(0, 300) } });
  }
};

module.exports = handlers;
