// ============================================================
//  VallorSoft — routes/accounting.js  (KÖNYVELŐI letöltések)
//   - POST /api/accounting/zip           → kijelölt VAGY havi dokumentumok ZIP-ben
//   - GET  /api/accounting/invoices.csv  → SAGA/WinMentor-barát CSV (kimenő/bejövő)
//  Jogosultság: Admin / Manager / Konyvelo.
// ============================================================
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { buildZip } = require('../lib/zip');

function guard(req, res, next) {
  if (!req.session || !req.session.user) return res.status(401).send('Bejelentkezés szükséges.');
  if (!['Admin', 'Manager', 'Konyvelo'].includes(req.session.user.pozicio)) return res.status(403).send('Nincs jogosultság.');
  next();
}
function dstr(d) { return d ? String(new Date(d).toISOString()).slice(0, 10) : ''; }
function b64ToBuf(s) {
  let data = String(s || '');
  const m = data.match(/^data:[^;]+;base64,(.*)$/);
  if (m) data = m[1];
  try { return Buffer.from(data, 'base64'); } catch (_) { return null; }
}

// egy dokumentum bájtjainak feloldása (src + id) — tenant-szűréssel
async function fetchDoc(cid, src, id) {
  if (src === 'order_doc') {
    const r = await pool.query('SELECT file_name, original_base64, signed_base64, order_id, created_at FROM order_documents WHERE id=$1 AND company_id=$2', [id, cid]);
    if (!r.rows.length) return null;
    const buf = b64ToBuf(r.rows[0].signed_base64 || r.rows[0].original_base64);
    return buf && { name: r.rows[0].file_name || 'dokumentum.pdf', buffer: buf, order_id: r.rows[0].order_id, created_at: r.rows[0].created_at };
  }
  if (src === 'pod') {
    const r = await pool.query('SELECT d.file_name, d.storage_url, d.order_id, d.created_at FROM documents d JOIN orders o ON o.id=d.order_id AND o.company_id=$2 WHERE d.id=$1', [id, cid]);
    if (!r.rows.length) return null;
    const buf = b64ToBuf(r.rows[0].storage_url);
    return buf && { name: r.rows[0].file_name || 'pod.jpg', buffer: buf, order_id: r.rows[0].order_id, created_at: r.rows[0].created_at };
  }
  if (src === 'carrier_doc') {
    const r = await pool.query('SELECT file_name, data_base64, order_id, created_at FROM carrier_documents WHERE id=$1 AND company_id=$2', [id, cid]);
    if (!r.rows.length) return null;
    const buf = b64ToBuf(r.rows[0].data_base64);
    return buf && { name: r.rows[0].file_name || 'feltoltes', buffer: buf, order_id: r.rows[0].order_id, created_at: r.rows[0].created_at };
  }
  return null;
}

// a havi (tartomány) összes dokumentum-referenciája
async function rangeRefs(cid, from, to) {
  const refs = [];
  const a = await pool.query('SELECT id FROM order_documents WHERE company_id=$1 AND created_at>=$2 AND created_at<=$3', [cid, from, to]);
  a.rows.forEach((r) => refs.push({ src: 'order_doc', id: r.id }));
  const b = await pool.query('SELECT d.id FROM documents d JOIN orders o ON o.id=d.order_id AND o.company_id=$1 WHERE d.created_at>=$2 AND d.created_at<=$3', [cid, from, to]);
  b.rows.forEach((r) => refs.push({ src: 'pod', id: r.id }));
  const c = await pool.query('SELECT id FROM carrier_documents WHERE company_id=$1 AND created_at>=$2 AND created_at<=$3', [cid, from, to]);
  c.rows.forEach((r) => refs.push({ src: 'carrier_doc', id: r.id }));
  return refs;
}

// Egyetlen dokumentum megnyitása/letöltése
router.get('/api/accounting/doc', guard, async (req, res) => {
  try {
    const cid = req.session.user.company_id;
    const d = await fetchDoc(cid, String(req.query.src || ''), parseInt(req.query.id, 10));
    if (!d) return res.status(404).send('Nem található.');
    const ext = (d.name.split('.').pop() || '').toLowerCase();
    const mime = ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png'
      : (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' : 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', 'inline; filename="' + encodeURIComponent(d.name) + '"');
    return res.send(d.buffer);
  } catch (err) { console.error('accounting doc hiba:', err); return res.status(500).send('Szerver hiba'); }
});

router.post('/api/accounting/zip', guard, async (req, res) => {
  try {
    const cid = req.session.user.company_id;
    const b = req.body || {};
    let refs = Array.isArray(b.refs) ? b.refs : null;
    if (!refs || !refs.length) {
      if (!b.from || !b.to) return res.status(400).send('Adj meg kijelölést vagy időszakot.');
      refs = await rangeRefs(cid, b.from + 'T00:00:00', b.to + 'T23:59:59');
    }
    refs = refs.slice(0, 1000); // fair-use
    const files = [];
    let total = 0;
    for (const ref of refs) {
      const d = await fetchDoc(cid, String(ref.src), parseInt(ref.id, 10));
      if (!d) continue;
      total += d.buffer.length;
      if (total > 300 * 1024 * 1024) break; // ~300 MB memória-korlát
      const folder = (d.order_id ? String(d.order_id) : 'egyeb').replace(/[\\/:*?"<>|]/g, '_');
      const dd = dstr(d.created_at);
      files.push({ name: folder + '/' + (dd ? dd + '_' : '') + d.name, buffer: d.buffer, date: d.created_at ? new Date(d.created_at) : null });
    }
    if (!files.length) return res.status(404).send('Nincs letölthető dokumentum a kijelölésben.');
    const zip = buildZip(files);
    const fn = 'vallorsoft-dokumentumok-' + (b.from || dstr(Date.now())) + '.zip';
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="' + fn + '"');
    return res.send(zip);
  } catch (err) {
    console.error('accounting zip hiba:', err);
    return res.status(500).send('Szerver hiba a ZIP készítésekor.');
  }
});

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function sendCsv(res, fileName, header, rows) {
  const lines = [header.map(csvCell).join(';')].concat(rows.map((r) => r.map(csvCell).join(';')));
  const body = '﻿' + lines.join('\r\n');  // BOM az Excelhez
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="' + fileName + '"');
  return res.send(body);
}

router.get('/api/accounting/invoices.csv', guard, async (req, res) => {
  try {
    const cid = req.session.user.company_id;
    const kind = req.query.kind === 'purchases' ? 'purchases' : 'sales';
    const to = req.query.to ? (req.query.to + 'T23:59:59') : new Date().toISOString();
    let from = req.query.from ? (req.query.from + 'T00:00:00') : null;
    if (!from) { const d = new Date(); d.setMonth(d.getMonth() - 1); from = d.toISOString(); }

    if (kind === 'sales') {
      const r = await pool.query(
        `SELECT created_at, serie, numar, client_name, client_cui, total, valuta, tva, provider, status, order_id
         FROM invoices WHERE company_id=$1 AND created_at>=$2 AND created_at<=$3 ORDER BY created_at`, [cid, from, to]);
      const rows = r.rows.map((x) => [dstr(x.created_at), [x.serie, x.numar].filter(Boolean).join('-'),
        x.client_name, x.client_cui, x.total, x.valuta, x.tva, x.provider, x.status, x.order_id]);
      return sendCsv(res, 'kimeno-szamlak.csv',
        ['Datum', 'Sorszam', 'Partner', 'CUI', 'Osszeg', 'Penznem', 'TVA%', 'Szolgaltato', 'Allapot', 'Fuvar'], rows);
    }
    // purchases (bejövő / alvállalkozói)
    const r = await pool.query(
      `SELECT ci.issue_date, ci.due_date, ci.invoice_number, c.nev AS partner, c.cui, ci.amount, ci.currency, ci.status, ci.paid_amount, ci.order_ids
       FROM carrier_invoices ci JOIN carriers c ON c.id=ci.carrier_id AND c.company_id=ci.company_id
       WHERE ci.company_id=$1 AND ci.created_at>=$2 AND ci.created_at<=$3 ORDER BY ci.issue_date NULLS LAST`, [cid, from, to]);
    const rows = r.rows.map((x) => {
      let oids = []; try { oids = Array.isArray(x.order_ids) ? x.order_ids : JSON.parse(x.order_ids || '[]'); } catch (_) { oids = []; }
      return [dstr(x.issue_date), dstr(x.due_date), x.invoice_number, x.partner, x.cui, x.amount, x.currency, x.status, x.paid_amount, oids.join(' ')];
    });
    return sendCsv(res, 'bejovo-szamlak.csv',
      ['Kelt', 'Hatarido', 'Szamlaszam', 'Alvallalkozo', 'CUI', 'Osszeg', 'Penznem', 'Allapot', 'Fizetve', 'Fuvarok'], rows);
  } catch (err) {
    console.error('accounting csv hiba:', err);
    return res.status(500).send('Szerver hiba a CSV készítésekor.');
  }
});

module.exports = router;
