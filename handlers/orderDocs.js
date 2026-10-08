// handlers/orderDocs.js — Fuvar-dokumentumok (számla, CMR, POD, bármilyen
// dokumentum) feltöltése egy fuvarhoz kötve + utólagos keresés fuvar / ügyfél /
// típus / dátum szerint. A MEGLÉVŐ `order_documents` táblára épül (ugyanaz, amit
// a fuvar ⋯ „Dokumentumok" és az aláíró-motor használ); a letöltés a meglévő
// `orderDocGet` RPC-n megy. Migráció: db/order-documents-meta.sql.
//
// Kapuk: Admin/Manager, `company_id`-szűrt, paraméteres SQL, audit.

const pool = require('../db');
const audit = require('../lib/audit');
const { parseInvoiceText, normName, digits } = require('../lib/invoiceText');

const handlers = {};
const _am = (u) => u && ['Admin', 'Manager'].includes(u.pozicio);
const DOC_TYPES = ['invoice', 'cmr', 'pod', 'order', 'contract', 'customs', 'receipt', 'other'];
const MAX_B64 = 20 * 1024 * 1024; // ~15 MB fájl base64-ben
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Megengedett feltöltés: kép / PDF / gyakori irodai formátum (data URL).
const MIME_RE = /^data:(application\/pdf|image\/(png|jpe?g|webp|heic|heif)|text\/plain|text\/csv|application\/(msword|vnd\.openxmlformats-officedocument\.[a-z.]+|vnd\.ms-excel|zip|xml)|text\/xml);base64,/i;

function _clip(v, max) { if (v == null) return null; const s = String(v).trim(); return s ? s.slice(0, max) : null; }
function _date(v) { const s = String(v || '').trim().slice(0, 10); return DATE_RE.test(s) ? s : null; }
function _type(v) { const s = String(v || '').trim(); return DOC_TYPES.includes(s) ? s : 'other'; }

// orderDocSearch({ q?, order_id?, doc_type?, from?, to?, limit? })
// A dátum = a dokumentum saját dátuma, ha nincs → feltöltés napja.
handlers.orderDocSearch = async function (req, res, args) {
  try {
    if (!_am(req.session.user)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const a = (args && args[0]) || {};
    const cid = req.session.user.company_id;
    const where = ['o.company_id = $1'];
    const vals = [cid];
    const add = (sql, v) => { vals.push(v); where.push(sql.replace('?', '$' + vals.length)); };
    const oid = _clip(a.order_id, 40);
    if (oid) add('od.order_id = ?', oid);
    if (a.doc_type && DOC_TYPES.includes(a.doc_type)) add('od.doc_type = ?', a.doc_type);
    const from = _date(a.from), to = _date(a.to);
    if (from) add('COALESCE(od.doc_date, od.created_at::date) >= ?::date', from);
    if (to) add('COALESCE(od.doc_date, od.created_at::date) <= ?::date', to);
    const q = _clip(a.q, 100);
    if (q) {
      vals.push('%' + q.toLowerCase().replace(/[%_\\]/g, '\\$&') + '%');
      const p = '$' + vals.length;
      where.push(`(LOWER(COALESCE(o.fuvar_no,'')) LIKE ${p} OR LOWER(o.id) LIKE ${p}
        OR LOWER(COALESCE(o.client,'')) LIKE ${p} OR LOWER(COALESCE(od.file_name,'')) LIKE ${p}
        OR LOWER(COALESCE(od.ref_no,'')) LIKE ${p} OR LOWER(COALESCE(od.note,'')) LIKE ${p}
        OR LOWER(COALESCE(o.loc_incarcare,'')) LIKE ${p} OR LOWER(COALESCE(o.loc_descarcare,'')) LIKE ${p})`);
    }
    const lim = Math.min(Math.max(parseInt(a.limit, 10) || 300, 1), 1000);
    const r = await pool.query(
      `SELECT od.id, od.order_id, od.file_name, od.doc_type, od.ref_no, od.note, od.file_size,
              od.uploaded_by, od.created_at,
              to_char(COALESCE(od.doc_date, od.created_at::date), 'YYYY-MM-DD') AS doc_date,
              (od.signed_base64 IS NOT NULL) AS has_signed,
              o.fuvar_no, o.client, o.loc_incarcare, o.loc_descarcare, o.status,
              o.data_incarcare, o.data_descarcare
         FROM order_documents od
         JOIN orders o ON o.id = od.order_id
        WHERE ${where.join(' AND ')}
        ORDER BY COALESCE(od.doc_date, od.created_at::date) DESC, od.id DESC
        LIMIT ${lim}`, vals);
    return res.json({ result: { ok: true, rows: r.rows, types: DOC_TYPES, truncated: r.rows.length >= lim } });
  } catch (err) {
    console.error('orderDocSearch hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// orderDocOrderPick({ q }) — fuvar-választó a feltöltéshez (fuvar-szám / id /
// ügyfél / helyszín szerint), a cég fuvarjaiból, legfrissebb elöl.
handlers.orderDocOrderPick = async function (req, res, args) {
  try {
    if (!_am(req.session.user)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const a = (args && args[0]) || {};
    const vals = [req.session.user.company_id];
    let cond = '';
    const q = _clip(a.q, 100);
    if (q) {
      vals.push('%' + q.toLowerCase().replace(/[%_\\]/g, '\\$&') + '%');
      cond = `AND (LOWER(COALESCE(fuvar_no,'')) LIKE $2 OR LOWER(id) LIKE $2 OR LOWER(COALESCE(client,'')) LIKE $2
              OR LOWER(COALESCE(loc_incarcare,'')) LIKE $2 OR LOWER(COALESCE(loc_descarcare,'')) LIKE $2)`;
    }
    const r = await pool.query(
      `SELECT id, fuvar_no, client, loc_incarcare, loc_descarcare, data_incarcare, status
         FROM orders WHERE company_id = $1 AND status <> 'Anulat' ${cond}
        ORDER BY created_at DESC LIMIT 25`, vals);
    return res.json({ result: { ok: true, rows: r.rows } });
  } catch (err) {
    console.error('orderDocOrderPick hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// orderDocAdd({ order_id, file_name, data (data URL), doc_type, doc_date?, ref_no?, note? })
handlers.orderDocAdd = async function (req, res, args) {
  try {
    const u = req.session.user;
    if (!_am(u)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const a = (args && args[0]) || {};
    const orderId = _clip(a.order_id, 40);
    const fileName = _clip(a.file_name, 255);
    const data = typeof a.data === 'string' ? a.data : '';
    if (!orderId || !fileName || !data) return res.json({ result: { ok: false, err: 'Date lipsă (cursă / fișier).' } });
    if (data.length > MAX_B64) return res.json({ result: { ok: false, err: 'Fișierul este prea mare (max. 15 MB).' } });
    if (!MIME_RE.test(data)) return res.json({ result: { ok: false, err: 'Format de fișier neacceptat.' } });
    // Cross-tenant védelem: csak a saját cég fuvarjához.
    const own = await pool.query('SELECT 1 FROM orders WHERE id = $1 AND company_id = $2', [orderId, u.company_id]);
    if (!own.rows.length) return res.json({ result: { ok: false, err: 'Comanda nu a fost găsită.' } });
    const type = _type(a.doc_type);
    const size = Math.round((data.length - data.indexOf(',') - 1) * 0.75);
    const r = await pool.query(
      `INSERT INTO order_documents (order_id, file_name, original_base64, uploaded_by, company_id,
                                    doc_type, doc_date, ref_no, note, file_size)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::date, CURRENT_DATE),$8,$9,$10) RETURNING id`,
      [orderId, fileName, data, u.nume || u.email, u.company_id,
        type, _date(a.doc_date), _clip(a.ref_no, 100), _clip(a.note, 500), size]);
    audit.fromReq(req, 'order_doc.upload', 'order', orderId, { doc_id: r.rows[0].id, doc_type: type, file_name: fileName });
    return res.json({ result: { ok: true, docId: r.rows[0].id } });
  } catch (err) {
    console.error('orderDocAdd hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// orderDocUpdateMeta({ id, doc_type?, doc_date?, ref_no?, note?, order_id? })
// order_id megadásával át is köthető másik (saját) fuvarhoz.
handlers.orderDocUpdateMeta = async function (req, res, args) {
  try {
    const u = req.session.user;
    if (!_am(u)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const a = (args && args[0]) || {};
    const id = parseInt(a.id, 10);
    if (!id) return res.json({ result: { ok: false, err: 'Identificator lipsă' } });
    const cur = await pool.query(
      `SELECT od.order_id FROM order_documents od JOIN orders o ON o.id = od.order_id
        WHERE od.id = $1 AND o.company_id = $2`, [id, u.company_id]);
    if (!cur.rows.length) return res.json({ result: { ok: false, err: 'Nu a fost găsit' } });
    let orderId = cur.rows[0].order_id;
    const newOid = _clip(a.order_id, 40);
    if (newOid && newOid !== orderId) {
      const own = await pool.query('SELECT 1 FROM orders WHERE id = $1 AND company_id = $2', [newOid, u.company_id]);
      if (!own.rows.length) return res.json({ result: { ok: false, err: 'Comanda nu a fost găsită.' } });
      orderId = newOid;
    }
    await pool.query(
      `UPDATE order_documents SET order_id = $2, doc_type = $3, doc_date = COALESCE($4::date, doc_date),
              ref_no = $5, note = $6, company_id = $7, updated_at = NOW()
        WHERE id = $1`,
      [id, orderId, _type(a.doc_type), _date(a.doc_date), _clip(a.ref_no, 100), _clip(a.note, 500), u.company_id]);
    audit.fromReq(req, 'order_doc.update', 'order', orderId, { doc_id: id });
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('orderDocUpdateMeta hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// orderDocDelete({ id })
handlers.orderDocDelete = async function (req, res, args) {
  try {
    const u = req.session.user;
    if (!_am(u)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const id = parseInt(((args && args[0]) || {}).id, 10);
    if (!id) return res.json({ result: { ok: false, err: 'Identificator lipsă' } });
    const r = await pool.query(
      `DELETE FROM order_documents od USING orders o
        WHERE od.id = $1 AND o.id = od.order_id AND o.company_id = $2
        RETURNING od.order_id, od.file_name`, [id, u.company_id]);
    if (!r.rows.length) return res.json({ result: { ok: false, err: 'Nu a fost găsit' } });
    audit.fromReq(req, 'order_doc.delete', 'order', r.rows[0].order_id, { doc_id: id, file_name: r.rows[0].file_name });
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('orderDocDelete hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// orderDocInspect({ data, order_id? }) — számla-adatok kiolvasása AI NÉLKÜL a PDF
// szövegrétegéből (lib/invoiceText): számlaszám, kiállítás dátuma, vevő CUI/név; ha van
// fuvar, összeveti a fuvar megrendelőjével (és az alvállalkozóval). Csak olvas, nem ment.
handlers.orderDocInspect = async function (req, res, args) {
  try {
    const u = req.session.user;
    if (!_am(u)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const a = (args && args[0]) || {};
    const data = typeof a.data === 'string' ? a.data : '';
    if (!/^data:application\/pdf;base64,/i.test(data)) return res.json({ result: { ok: true, supported: false } });
    if (data.length > MAX_B64) return res.json({ result: { ok: false, err: 'Fișierul este prea mare (max. 15 MB).' } });
    const buf = Buffer.from(data.slice(data.indexOf(',') + 1), 'base64');
    const { text, scanned } = await require('../services/pdf-extract').extractText(buf);
    if (scanned) return res.json({ result: { ok: true, supported: true, scanned: true } });
    const inv = parseInvoiceText(text);
    const out = { ok: true, supported: true, scanned: false, invoice_no: inv.invoice_no, date: inv.date,
      client_name: inv.client_name, cuis: inv.cuis, match: 'unknown', expected: null, found: null };

    const cid = u.company_id;
    let own = '';
    try { const c = await pool.query('SELECT cui FROM companies WHERE id = $1', [cid]); own = digits(c.rows[0] && c.rows[0].cui); } catch (_) {}
    const others = inv.cuis.filter((x) => x !== own);
    out.found = { name: inv.client_name, cui: others[0] || null };

    const oid = _clip(a.order_id, 40);
    if (oid) {
      const o = await pool.query(
        `SELECT o.client, cl.denumire, cl.cui_cif, ca.nev AS carrier_nev, ca.cui AS carrier_cui
           FROM orders o
           LEFT JOIN clients cl ON cl.id = o.client_id AND cl.company_id = o.company_id
           LEFT JOIN carriers ca ON ca.id = o.carrier_id AND ca.company_id = o.company_id
          WHERE o.id = $1 AND o.company_id = $2`, [oid, cid]);
      if (!o.rows.length) return res.json({ result: { ok: false, err: 'Comanda nu a fost găsită.' } });
      const r = o.rows[0];
      const expName = r.denumire || r.client || '';
      const expCui = digits(r.cui_cif);
      out.expected = { name: expName || null, cui: expCui || null };
      const nt = normName(text);
      const nameIn = (n) => { const k = normName(n); return k.length >= 3 && (` ${nt} `).includes(` ${k} `); };
      if (expCui && inv.cuis.includes(expCui)) out.match = 'client';
      else if (r.carrier_cui && inv.cuis.includes(digits(r.carrier_cui))) { out.match = 'carrier'; out.expected.carrier = r.carrier_nev; }
      else if (expName && nameIn(expName)) out.match = 'client';
      else if (r.carrier_nev && nameIn(r.carrier_nev)) { out.match = 'carrier'; out.expected.carrier = r.carrier_nev; }
      else if (others.length || inv.client_name) out.match = 'mismatch';
    }
    return res.json({ result: out });
  } catch (err) {
    console.error('orderDocInspect hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

Object.defineProperty(handlers, 'DOC_TYPES', { value: DOC_TYPES, enumerable: false });
module.exports = handlers;
