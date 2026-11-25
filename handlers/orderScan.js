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
const orderLearn = require('../lib/orderLearn');
const clientByCui = require('../lib/clientByCui');

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
      `SELECT DISTINCT ON (template_key) template_key, template_label, fields, updated_at,
              (to_jsonb(order_scan_samples) ->> 'cui') AS cui
         FROM order_scan_samples
        WHERE company_id = $1
        ORDER BY template_key, updated_at DESC`,
      [cid]);
    return r.rows
      .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
      .slice(0, 500);
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
    let docText;
    if (mimeType === 'application/pdf') {
      docText = '';
      try { const ex = await pdfx.extractText(buf); text = ex.text || ''; docText = text; }
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
      docText,
      fileBuffer: buf,
      mimeType,
      pdfName: _str(a.fileName, 200) || undefined,
      aiEnabled: true,
      samples,
      companyId: cid,
    });

    // ── Tanult címkék (lib/orderLearn): a megbízó felismerése (CUI / név), majd a
    //    javításokból tanult „ennél a megbízónál ez a felirat után áll" szabályok.
    //    ÉRTÉKET nem tanulunk — minden érték a friss dokumentumból jön.
    const fullText = String(r.text || text || '');
    let templateKey = orderLearn.identifyClient(fullText, samples) || normalizeTemplateKey(r.fields && r.fields.client);
    let applied = {};
    if (templateKey && fullText) {
      try {
        const rr = await pool.query(
          `SELECT id, field, anchor, mode, hits, misses FROM order_scan_rules
            WHERE company_id=$1 AND template_key=$2`, [cid, templateKey]);
        if (rr.rows.length) {
          const smp = samples.find((x) => x.template_key === templateKey);
          if (smp && !(r.fields && r.fields.client)) r.fields.client = smp.template_label;
          applied = orderLearn.applyRules(fullText, r.fields, rr.rows).applied;
        }
      } catch (_) { /* tábla hiányzik → tanulás nélkül */ }
    }
    const fields = sanitize(r.fields);
    // ── Megrendelő a CUI alapján: ha a cég ügyfelei közt megvan, azt kötjük a
    //    fuvarhoz; ha nincs, az ANAF-ból lekérjük és felvesszük (közös út a
    //    szöveges fuvarkiírással — lib/clientByCui). Best-effort.
    let clientInfo = null;
    if (fields.client_cui) {
      try {
        const cr = await clientByCui.ensureClientByCui(cid, fields.client_cui, { req, source: 'order_scan_anaf' });
        if (cr.client) {
          fields.client = cr.client.denumire;
          clientInfo = { id: cr.client.id, denumire: cr.client.denumire, cui_cif: cr.client.cui_cif || fields.client_cui, created: !!cr.created };
        } else if (cr.notFound) clientInfo = { not_found: true, cui: fields.client_cui };
        else if (cr.err) clientInfo = { anaf_error: cr.err, cui: fields.client_cui };
      } catch (_) { /* ügyfél-felvétel nélkül */ }
    }
    // A kiolvasás eltárolása a mentésig (a javításokból így tanulhatunk) — max. 3 napig.
    let scanId = null;
    try {
      await pool.query(`DELETE FROM order_scan_jobs WHERE company_id=$1 AND created_at < NOW() - INTERVAL '3 days'`, [cid]);
      const ins = await pool.query(
        `INSERT INTO order_scan_jobs (company_id, text, extracted, template_key, applied)
         VALUES ($1, $2, $3::jsonb, $4, $5::jsonb) RETURNING id`,
        [cid, fullText.slice(0, 200000), JSON.stringify(Object.assign({}, fields, { greutate: fields.suly_kg })),
          templateKey || null, JSON.stringify(applied)]);
      scanId = ins.rows[0].id;
    } catch (_) { /* migráció hiányzik → tanulás nélkül */ }
    try {
      // Audit: CSAK metaadat (méret/típus/AI-használat/bizonyosság/minta-szám).
      // A fájl tartalma SOHA nem kerül audit-logba vagy DB-be ezen az úton — a
      // csatolás a kliens `orderDocUpload` hívásán megy, fuvar-id-hez kötve.
      await audit.fromReq(req, 'order.scan', 'order', null, {
        mime: mimeType, bytes: approxBytes, ai_used: r.ai_used,
        confidence: r.confidence, ocr_used: !!r.ocr_used, file_name: _str(a.fileName, 200),
        samples_used: samples.length,
      });
    } catch (_) { /* audit best-effort */ }

    return res.json({
      result: {
        ok: true,
        fields,
        confidence: typeof r.confidence === 'number' ? r.confidence : null,
        ai_used: !!r.ai_used,
        ocr_used: !!r.ocr_used,
        learned_from: Object.keys(applied).length,
        scan_id: scanId,
        client: clientInfo,
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
    // Ugyanaz a fehérlista, mint a scanOrderDocument-nél.
    const fields = sanitize(a.fields || {});
    const final = Object.assign({}, fields, { greutate: fields.suly_kg });
    const templateKey = normalizeTemplateKey(fields.client);
    if (!templateKey) return res.json({ result: { ok: true, noop: true } });

    // A megbízó azonosítója (név + CUI) — a felismeréshez. ÉRTÉKET nem tárolunk
    // (a felrakó / lerakó / ár / méret fuvaronként más).
    try {
      await pool.query(
        `INSERT INTO order_scan_samples
           (company_id, template_key, template_label, fields, sample_count, created_at, updated_at, cui)
         VALUES ($1, $2, $3, '{}'::jsonb, 1, NOW(), NOW(), $4)
         ON CONFLICT (company_id, template_key) DO UPDATE
           SET template_label = EXCLUDED.template_label, fields = '{}'::jsonb,
               cui = COALESCE(EXCLUDED.cui, order_scan_samples.cui),
               sample_count = order_scan_samples.sample_count + 1, updated_at = NOW()`,
        [cid, templateKey, fields.client, fields.client_cui || null]);
    } catch (dbErr) {
      console.warn('confirmOrderScanTemplate DB skip:', dbErr.message);
      return res.json({ result: { ok: true, noop: true } });
    }

    // Tanulás a javításokból: a kiolvasás (order_scan_jobs) vs. a mentett fuvar.
    let learned = 0;
    const scanId = parseInt(a.scan_id, 10);
    if (scanId > 0) {
      try {
        const j = await pool.query(
          'SELECT text, extracted, applied FROM order_scan_jobs WHERE id=$1 AND company_id=$2', [scanId, cid]);
        const job = j.rows[0];
        if (job && job.text) {
          // A már alkalmazott szabályok visszajelzése: ha a diszpécser megtartotta
          // az értéket → +1 találat, ha javította → +1 tévedés.
          for (const [field, ruleId] of Object.entries(job.applied || {})) {
            const ok = orderLearn.sameValue(field, (job.extracted || {})[field], final[field]);
            await pool.query(
              `UPDATE order_scan_rules SET ${ok ? 'hits = hits + 1' : 'misses = misses + 1'}, updated_at = NOW()
                WHERE id=$1 AND company_id=$2`, [ruleId, cid]);
          }
          await pool.query('DELETE FROM order_scan_rules WHERE company_id=$1 AND template_key=$2 AND misses > hits', [cid, templateKey]);
          const rules = orderLearn.learnRules(job.text, job.extracted || {}, final);
          for (const r of rules) {
            await pool.query(
              `INSERT INTO order_scan_rules (company_id, template_key, field, anchor, mode)
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT (company_id, template_key, field, anchor, mode)
               DO UPDATE SET hits = order_scan_rules.hits + 1, updated_at = NOW()`,
              [cid, templateKey, r.field, r.anchor.slice(0, 80), r.mode]);
            learned++;
          }
        }
        await pool.query('DELETE FROM order_scan_jobs WHERE id=$1 AND company_id=$2', [scanId, cid]);
      } catch (e) { console.warn('order-scan tanulás kihagyva:', e.message); }
    }

    try {
      await audit.fromReq(req, 'order.scan.confirm', 'order_template', null, {
        template_key: templateKey, learned_rules: learned,
      });
    } catch (_) { /* audit best-effort */ }

    return res.json({ result: { ok: true, template_key: templateKey, learned } });
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
