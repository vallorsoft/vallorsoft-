// ============================================================
//  VallorSoft — handlers/orderAssignment.js
//  „Comanda de Transport" (megbízás/megrendelés) egy fuvarhoz.
//  Csak Extern VAGY sofőr-nélküli fuvarra készül; a fuvar-adatok
//  előtöltve jönnek, a többi mezőt (interval / paleti / DA-NU
//  csomag / TIP camion) admin/manager tölti ki a wizard-modalban.
//
//  Biztonsági alapelvek:
//    - Multi-tenant: minden SQL company_id-szűrt + paraméteres.
//    - Cross-tenant write védelem: get/save előtt ellenőrizzük a
//      fuvar tulajdonjogát (mint az e-CMR-nél, PR/audit AUDIT.md).
//    - Csak Admin/Manager (a felület sem mutatja Sofőrnek).
//    - `fields` JSONB fehérlista-validáció (nem szivárog kliens-
//      kulcs, a méret max 32 KB).
//    - Audit-napló minden íráson.
//    - Egy fuvarhoz EGY megbízás (UNIQUE INDEX + upsert).
// ============================================================
const pool = require('../db');
const audit = require('../lib/audit');

const handlers = {};

// Bemenet-korlátok / fehérlisták
const CUSTOM_NR_MAX = 60;
const CURRENCY_RE = /^[A-Z]{3}$/;
const FIELDS_MAX_BYTES = 32 * 1024;                          // ~32 KB JSONB max
const PDF_MAX_BYTES = 4 * 1024 * 1024;                       // ~3 MB tényleges (base64 4/3 arány) → 4 MB base64 karakter
const TRUCK_KINDS = ['standard','mega','frigo','prelata','duba','platforma','izoterm','walkingfloor','container','tautliner'];
const FLAG_KEYS   = ['doi_soferi','podea_goala','chingi','presuri','coltare','paleti_schimb','termodiagrama','cablu_vamal','adr'];
const STOP_FIELDS = ['stop_id','interval','paleti','tip_palet','kg','metri','referinta','instructiuni'];
const NUMBER_SOURCES = ['auto','custom'];

function _user(req){ return (req && req.session && req.session.user) || null; }
function _am(req){ const u=_user(req); return !!(u && ['Admin','Manager'].includes(u.pozicio)); }
function _s(x, n){ const s=x==null?'':String(x).trim().slice(0,n); return s || null; }

// A fuvar akkor jogosult a megbízásra, ha nincs belső sofőr KIOSZTVA,
// VAGY Extern státusz. A UI ezt szűri, de a szerver is védekezik.
function _isEligibleOrder(o){
  if (!o) return false;
  const hasInternalDriver = !!(o.email_sofer && String(o.email_sofer).trim());
  if (hasInternalDriver) return false;                       // belső sofőrhöz nem kell megbízás
  return true;
}

// A `fields` JSONB fehérlistán bontása. Ismeretlen kulcs → eldobva.
function _sanitizeFields(raw){
  const out = { stops: { pickups: [], deliveries: [] }, vehicle: {}, driver: {} };
  const r = (raw && typeof raw === 'object') ? raw : {};

  // Stops (pickup/delivery) — soronként fehérlistás mezők
  const rs = r.stops && typeof r.stops === 'object' ? r.stops : {};
  ['pickups','deliveries'].forEach(function(k){
    const arr = Array.isArray(rs[k]) ? rs[k] : [];
    out.stops[k] = arr.slice(0, 20).map(function(row){
      const clean = {};
      if (!row || typeof row !== 'object') return clean;
      STOP_FIELDS.forEach(function(f){
        if (Object.prototype.hasOwnProperty.call(row, f)) {
          const v = row[f];
          if (v == null) { clean[f] = null; return; }
          if (f === 'stop_id') { const n = parseInt(v, 10); clean[f] = Number.isFinite(n) && n > 0 ? n : null; return; }
          clean[f] = _s(v, 200);
        }
      });
      return clean;
    });
  });

  // Vehicle — TIP camion + truck_kinds fehérlista + flags (bool) + alte specificatii
  const rv = r.vehicle && typeof r.vehicle === 'object' ? r.vehicle : {};
  out.vehicle.tip_camion = _s(rv.tip_camion, 200);
  out.vehicle.alte_specificatii = _s(rv.alte_specificatii, 500);
  const rk = Array.isArray(rv.truck_kinds) ? rv.truck_kinds : [];
  out.vehicle.truck_kinds = rk.filter(function(k){ return TRUCK_KINDS.indexOf(String(k)) !== -1; }).slice(0, TRUCK_KINDS.length);
  const rf = rv.flags && typeof rv.flags === 'object' ? rv.flags : {};
  out.vehicle.flags = {};
  FLAG_KEYS.forEach(function(k){ if (Object.prototype.hasOwnProperty.call(rf, k)) out.vehicle.flags[k] = !!rf[k]; });

  // Driver — név + telefon (SZABADSZÖVEG; a rendszer előtölti orders.*-ból)
  const rd = r.driver && typeof r.driver === 'object' ? r.driver : {};
  out.driver.name = _s(rd.name, 200);
  out.driver.phone = _s(rd.phone, 60);

  return out;
}

// ── OLVASÁS ───────────────────────────────────────────────
// args: [orderId]
// Visszaad: az elmentett assignment (ha van) + a fuvar+carrier+stops
// előtöltő snapshotja, hogy a kliens ne kelljen újra kérdeznie.
handlers.orderAssignmentGet = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok:false, err:'Acces interzis' } });
    const cid = _user(req).company_id;
    const orderId = _s(Array.isArray(args) ? args[0] : (args && args.order_id), 20);
    if (!orderId) return res.json({ result: { ok:false, err:'Comanda lipsa' } });

    const or = await pool.query(
      `SELECT o.*, c.nev AS carrier_nev, c.cui AS carrier_cui, c.reg_com AS carrier_reg_com,
              c.adresa AS carrier_adresa, c.telefon AS carrier_telefon,
              c.email AS carrier_email, c.iban AS carrier_iban,
              c.payment_term_days AS carrier_payment_term_days
         FROM orders o
    LEFT JOIN carriers c ON c.id = o.carrier_id AND c.company_id = o.company_id
        WHERE o.id = $1 AND o.company_id = $2`,
      [orderId, cid]);
    if (!or.rows.length) return res.json({ result: { ok:false, err:'Comanda nu a fost gasita.' } });
    const order = or.rows[0];
    if (!_isEligibleOrder(order)) {
      return res.json({ result: { ok:false, err:'Comanda are sofer intern alocat.' } });
    }

    const sr = await pool.query(
      `SELECT id, kind, stop_index, seq_index, loc, firma, data, ref
         FROM order_stops
        WHERE order_id = $1 AND company_id = $2
        ORDER BY (kind = 'pickup') DESC, stop_index ASC`,
      [orderId, cid]);

    // Cég-adatok (fejléc jobb) + logó/pecsét-elérhetőség jelzés.
    const cor = await pool.query(
      `SELECT co.nev, co.igazgato_nev, co.email_contact, co.telefon,
              co.cui, co.reg_com, co.euid, co.adresa, co.iban, co.banca,
              co.capital_social, co.tva_platitor, co.website,
              co.order_assignment_template,
              cb.logo_base64 IS NOT NULL AS has_logo,
              cb.stamp_base64 IS NOT NULL AS has_stamp,
              cb.brand_color
         FROM companies co
    LEFT JOIN company_branding cb ON cb.company_id = co.id
        WHERE co.id = $1`,
      [cid]);
    const co = cor.rows[0] || {};

    // Meglévő assignment?
    const ar = await pool.query(
      `SELECT id, number_source, custom_number, carrier_id, carrier_snapshot,
              price, currency, payment_term_days, fields,
              rendered_at, signed_at, signed_by, updated_at
         FROM order_assignments WHERE order_id = $1 AND company_id = $2`,
      [orderId, cid]);
    const existing = ar.rows[0] || null;

    return res.json({ result: {
      ok: true,
      order: {
        id: order.id,
        fuvar_no: order.fuvar_no,
        client: order.client,
        ref: order.ref,
        load_type: order.load_type,
        suly_kg: order.suly_kg != null ? Number(order.suly_kg) : null,
        hossz_cm: order.hossz_cm != null ? Number(order.hossz_cm) : null,
        szel_cm:  order.szel_cm  != null ? Number(order.szel_cm)  : null,
        mag_cm:   order.mag_cm   != null ? Number(order.mag_cm)   : null,
        rendszam_camion: order.rendszam_camion,
        rendszam_camion_extern: order.rendszam_camion_extern,
        nume_sofer_extern: order.nume_sofer_extern,
        telefon_sofer_extern: order.telefon_sofer_extern,
        nume_sofer: order.nume_sofer,
        pret: order.pret != null ? Number(order.pret) : null,
        valuta: order.valuta,
        carrier_cost: order.carrier_cost != null ? Number(order.carrier_cost) : null,
        carrier_id: order.carrier_id
      },
      carrier: order.carrier_id ? {
        id: order.carrier_id,
        nev: order.carrier_nev,
        cui: order.carrier_cui,
        reg_com: order.carrier_reg_com,
        adresa: order.carrier_adresa,
        telefon: order.carrier_telefon,
        email: order.carrier_email,
        iban: order.carrier_iban,
        payment_term_days: order.carrier_payment_term_days
      } : null,
      stops: sr.rows,
      company: co,
      existing: existing
    } });
  } catch (err) {
    console.error('orderAssignmentGet hiba:', err);
    return res.json({ result: { ok:false, err:'Eroare de server' } });
  }
};

// Carriers legördülő a modalban (előtöltés + váltás).
// Csak cégre szűrt, aktív carrier-ek.
handlers.orderAssignmentCarriers = async function (req, res) {
  try {
    if (!_am(req)) return res.json({ result: { ok:false, err:'Acces interzis' } });
    const cid = _user(req).company_id;
    const r = await pool.query(
      `SELECT id, nev, cui, reg_com, adresa, telefon, email, iban, payment_term_days
         FROM carriers
        WHERE company_id = $1 AND COALESCE(aktiv,true) = true
        ORDER BY nev ASC LIMIT 500`, [cid]);
    return res.json({ result: { ok:true, items: r.rows } });
  } catch (err) {
    console.error('orderAssignmentCarriers hiba:', err);
    return res.json({ result: { ok:false, err:'Eroare de server' } });
  }
};

// ── MENTÉS (upsert) ────────────────────────────────────────
// args: [{ order_id, number_source, custom_number, carrier_id, price, currency,
//          payment_term_days, fields, rendered_pdf_base64? }]
handlers.orderAssignmentSave = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok:false, err:'Acces interzis' } });
    const me = _user(req);
    const cid = me.company_id;
    const a = (args && args[0]) || {};
    const orderId = _s(a.order_id, 20);
    if (!orderId) return res.json({ result: { ok:false, err:'Comanda lipsa' } });

    const ownR = await pool.query(
      'SELECT * FROM orders WHERE id = $1 AND company_id = $2',
      [orderId, cid]);
    if (!ownR.rows.length) return res.json({ result: { ok:false, err:'Comanda nu a fost gasita.' } });
    if (!_isEligibleOrder(ownR.rows[0])) {
      return res.json({ result: { ok:false, err:'Comanda are sofer intern alocat.' } });
    }

    // Fejléc-szám: forrás fehérlista + hossz-korlát.
    const numberSource = NUMBER_SOURCES.indexOf(a.number_source) !== -1 ? a.number_source : 'auto';
    const customNumber = numberSource === 'custom' ? _s(a.custom_number, CUSTOM_NR_MAX) : null;
    if (numberSource === 'custom' && !customNumber) {
      return res.json({ result: { ok:false, err:'Numarul comenzii este obligatoriu.' } });
    }

    // Carrier ellenőrzés + snapshot.
    let carrierId = a.carrier_id != null && a.carrier_id !== '' ? parseInt(a.carrier_id, 10) : null;
    if (!Number.isFinite(carrierId) || carrierId <= 0) carrierId = null;
    let carrierSnapshot = {};
    if (carrierId) {
      const cr = await pool.query(
        `SELECT nev, cui, reg_com, adresa, telefon, email, iban, payment_term_days
           FROM carriers WHERE id = $1 AND company_id = $2`, [carrierId, cid]);
      if (!cr.rows.length) return res.json({ result: { ok:false, err:'Subcontractor nu a fost gasit.' } });
      carrierSnapshot = cr.rows[0];
    } else {
      // Ha carrier nincs, engedjük megnevezés-szabad megbízást is (pl. ad-hoc);
      // a snapshot mezőket a kliens (fields) tudja a jövőben tükrözni.
      carrierSnapshot = {};
    }

    // Ár + fizetési feltételek — mind opcionális, de validáljuk.
    let price = null;
    if (a.price != null && a.price !== '') {
      const n = Number(a.price);
      if (!Number.isFinite(n) || n < 0 || n > 1e8) return res.json({ result: { ok:false, err:'Pret invalid.' } });
      price = Math.round(n * 100) / 100;
    }
    let currency = null;
    if (a.currency != null && a.currency !== '') {
      const c = String(a.currency).trim().toUpperCase();
      if (!CURRENCY_RE.test(c)) return res.json({ result: { ok:false, err:'Moneda invalida.' } });
      currency = c;
    }
    let payTerm = null;
    if (a.payment_term_days != null && a.payment_term_days !== '') {
      const n = parseInt(a.payment_term_days, 10);
      if (!Number.isFinite(n) || n < 0 || n > 365) return res.json({ result: { ok:false, err:'Termen de plata invalid.' } });
      payTerm = n;
    }

    // Fields fehérlista + JSON-méret korlát.
    const fields = _sanitizeFields(a.fields);
    const fieldsJson = JSON.stringify(fields);
    if (fieldsJson.length > FIELDS_MAX_BYTES) {
      return res.json({ result: { ok:false, err:'Datele sunt prea mari.' } });
    }

    // Renderelt PDF (opcionális) — csak base64 tartalom, méret-védve.
    let renderedPdf = null;
    if (a.rendered_pdf_base64 != null && a.rendered_pdf_base64 !== '') {
      let b64 = String(a.rendered_pdf_base64);
      b64 = b64.replace(/^data:[^;]+;base64,/, '');
      if (b64.length > PDF_MAX_BYTES) return res.json({ result: { ok:false, err:'PDF prea mare (max ~3 MB).' } });
      renderedPdf = b64;
    }

    // Upsert (egy fuvar = egy megbízás — a UNIQUE INDEX ezt garantálja).
    // A rendered_pdf_base64 CSAK akkor íródik, ha a kliens explicit küldte;
    // különben a régi megőrizve.
    const now = new Date();
    const existing = await pool.query(
      `SELECT id FROM order_assignments WHERE order_id = $1 AND company_id = $2`,
      [orderId, cid]);

    let saved;
    if (existing.rows.length) {
      const id = existing.rows[0].id;
      const params = [numberSource, customNumber, carrierId, JSON.stringify(carrierSnapshot),
                      price, currency, payTerm, fieldsJson, now];
      let sql = `UPDATE order_assignments SET
                   number_source=$1, custom_number=$2, carrier_id=$3, carrier_snapshot=$4::jsonb,
                   price=$5, currency=$6, payment_term_days=$7, fields=$8::jsonb, updated_at=$9`;
      let idx = 10;
      if (renderedPdf) {
        sql += `, rendered_pdf_base64=$${idx}, rendered_at=$${idx+1}`;
        params.push(renderedPdf, now); idx += 2;
      }
      sql += ` WHERE id=$${idx} AND company_id=$${idx+1} RETURNING id`;
      params.push(id, cid);
      const upd = await pool.query(sql, params);
      saved = upd.rows[0];
    } else {
      const params = [orderId, cid, numberSource, customNumber, carrierId,
                      JSON.stringify(carrierSnapshot), price, currency, payTerm, fieldsJson,
                      me.email || me.nume || null, now, now];
      let sql = `INSERT INTO order_assignments
        (order_id, company_id, number_source, custom_number, carrier_id, carrier_snapshot,
         price, currency, payment_term_days, fields, created_by, created_at, updated_at`;
      let placeholders = '$1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10::jsonb,$11,$12,$13';
      if (renderedPdf) {
        sql += `, rendered_pdf_base64, rendered_at`;
        placeholders += `,$14,$15`;
        params.push(renderedPdf, now);
      }
      sql += `) VALUES (${placeholders}) RETURNING id`;
      const ins = await pool.query(sql, params);
      saved = ins.rows[0];
    }

    audit.fromReq(req, 'orderAssignment.save', 'orderAssignment', saved.id,
      { order_id: orderId, carrier_id: carrierId, number_source: numberSource, has_pdf: !!renderedPdf });
    return res.json({ result: { ok:true, id: saved.id } });
  } catch (err) {
    console.error('orderAssignmentSave hiba:', err);
    return res.json({ result: { ok:false, err:'Eroare de server' } });
  }
};

// ── PDF lekérése (megjelenítéshez / letöltéshez) ───────────
// args: [orderId, which='rendered'|'signed']
handlers.orderAssignmentGetPdf = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok:false, err:'Acces interzis' } });
    const cid = _user(req).company_id;
    const orderId = _s(Array.isArray(args) ? args[0] : (args && args.order_id), 20);
    const which = (Array.isArray(args) ? args[1] : (args && args.which)) === 'signed' ? 'signed' : 'rendered';
    if (!orderId) return res.json({ result: { ok:false, err:'Comanda lipsa' } });
    const r = await pool.query(
      `SELECT rendered_pdf_base64, signed_pdf_base64
         FROM order_assignments WHERE order_id = $1 AND company_id = $2`,
      [orderId, cid]);
    if (!r.rows.length) return res.json({ result: { ok:false, err:'Nu exista comanda pentru aceasta cursa.' } });
    const row = r.rows[0];
    const b64 = which === 'signed' ? row.signed_pdf_base64 : row.rendered_pdf_base64;
    if (!b64) return res.json({ result: { ok:false, err:'PDF-ul nu a fost generat inca.' } });
    return res.json({ result: { ok:true, base64: b64, dataUri: 'data:application/pdf;base64,'+b64 } });
  } catch (err) {
    console.error('orderAssignmentGetPdf hiba:', err);
    return res.json({ result: { ok:false, err:'Eroare de server' } });
  }
};

// ── Aláírt + pecsételt PDF mentése (a client-side buildSignedPdf után) ──
// args: [{ order_id, signed_pdf_base64 }]
handlers.orderAssignmentSaveSigned = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok:false, err:'Acces interzis' } });
    const me = _user(req);
    const cid = me.company_id;
    const a = (args && args[0]) || {};
    const orderId = _s(a.order_id, 20);
    let b64 = a.signed_pdf_base64 != null ? String(a.signed_pdf_base64) : '';
    b64 = b64.replace(/^data:[^;]+;base64,/, '');
    if (!orderId) return res.json({ result: { ok:false, err:'Comanda lipsa' } });
    if (!b64) return res.json({ result: { ok:false, err:'PDF lipsa' } });
    if (b64.length > PDF_MAX_BYTES) return res.json({ result: { ok:false, err:'PDF prea mare (max ~3 MB).' } });

    // Cross-tenant védelem
    const ownR = await pool.query(
      'SELECT 1 FROM order_assignments WHERE order_id = $1 AND company_id = $2',
      [orderId, cid]);
    if (!ownR.rows.length) return res.json({ result: { ok:false, err:'Comanda nu a fost gasita.' } });

    await pool.query(
      `UPDATE order_assignments
         SET signed_pdf_base64=$1, signed_at=NOW(), signed_by=$2, updated_at=NOW()
       WHERE order_id=$3 AND company_id=$4`,
      [b64, me.email || me.nume || null, orderId, cid]);

    audit.fromReq(req, 'orderAssignment.saveSigned', 'orderAssignment', null,
      { order_id: orderId });
    return res.json({ result: { ok:true } });
  } catch (err) {
    console.error('orderAssignmentSaveSigned hiba:', err);
    return res.json({ result: { ok:false, err:'Eroare de server' } });
  }
};

// ── Fuvar dokumentumai közé mentés (order_documents) ──────
// A client által renderelt PDF-et (aláírt VAGY nem-aláírt) beteszi az
// order_documents-be, ott ugyanúgy látszik, mint bármely más dok.
// args: [{ order_id, base64, file_name?, signed? }]
handlers.orderAssignmentAttachToDocs = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok:false, err:'Acces interzis' } });
    const me = _user(req);
    const cid = me.company_id;
    const a = (args && args[0]) || {};
    const orderId = _s(a.order_id, 20);
    let b64 = a.base64 != null ? String(a.base64) : '';
    b64 = b64.replace(/^data:[^;]+;base64,/, '');
    if (!orderId) return res.json({ result: { ok:false, err:'Comanda lipsa' } });
    if (!b64) return res.json({ result: { ok:false, err:'PDF lipsa' } });
    if (b64.length > PDF_MAX_BYTES) return res.json({ result: { ok:false, err:'PDF prea mare (max ~3 MB).' } });

    // Cross-tenant védelem
    const ownR = await pool.query(
      'SELECT 1 FROM orders WHERE id = $1 AND company_id = $2', [orderId, cid]);
    if (!ownR.rows.length) return res.json({ result: { ok:false, err:'Comanda nu a fost gasita.' } });

    const fname = _s(a.file_name, 200) || ('Comanda-'+orderId+'.pdf');
    const signed = !!a.signed;

    // A data-uri prefix nem kell az `order_documents`-ben (a régi kód is nélkül tárolja).
    const insCols = signed ? 'signed_base64' : 'original_base64';
    const r = await pool.query(
      `INSERT INTO order_documents (order_id, file_name, ${insCols}, uploaded_by, company_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [orderId, fname, b64, me.nume || me.email, cid]);

    audit.fromReq(req, 'orderAssignment.attach', 'order_documents', r.rows[0].id,
      { order_id: orderId, signed });
    return res.json({ result: { ok:true, docId: r.rows[0].id } });
  } catch (err) {
    console.error('orderAssignmentAttachToDocs hiba:', err);
    return res.json({ result: { ok:false, err:'Eroare de server' } });
  }
};

// ── Törlés (megbízás visszavonása) ─────────────────────────
handlers.orderAssignmentDelete = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok:false, err:'Acces interzis' } });
    const cid = _user(req).company_id;
    const orderId = _s(Array.isArray(args) ? args[0] : (args && args.order_id), 20);
    if (!orderId) return res.json({ result: { ok:false, err:'Comanda lipsa' } });
    const r = await pool.query(
      `DELETE FROM order_assignments WHERE order_id = $1 AND company_id = $2 RETURNING id`,
      [orderId, cid]);
    if (!r.rows.length) return res.json({ result: { ok:false, err:'Nu a fost gasit' } });
    audit.fromReq(req, 'orderAssignment.delete', 'orderAssignment', r.rows[0].id,
      { order_id: orderId });
    return res.json({ result: { ok:true } });
  } catch (err) {
    console.error('orderAssignmentDelete hiba:', err);
    return res.json({ result: { ok:false, err:'Eroare de server' } });
  }
};

module.exports = handlers;
