// routes/docArchive.js — fájl-letöltések (nem JSON):
//   GET /api/doc-archive/download      → a teljes cég-archívum ZIP (streamelt)
//   GET /api/waybill-download/:id      → egy korábban letöltött menetlevél-csomag PDF-je
// Admin/Manager; szigorúan a saját cég adatai; audit.
const express = require('express');
const router = express.Router();
const pool = require('../db');
const audit = require('../lib/audit');
const arch = require('../lib/docArchive');

const _am = (u) => u && ['Admin', 'Manager'].includes(u.pozicio) && u.company_id;
const _running = new Set();   // cégenként egyszerre egy archívum-készítés

router.get('/api/doc-archive/download', async (req, res) => {
  const u = req.session && req.session.user;
  if (!_am(u)) return res.status(403).send('Acces interzis');
  const cid = u.company_id;
  if (_running.has(cid)) return res.status(409).send('Arhiva se generează deja — așteaptă finalizarea descărcării.');
  _running.add(cid);
  let closed = false;
  res.on('close', () => { closed = true; });
  try {
    const d = new Date();
    const name = 'VallorSoft_arhiva_documente_' + arch.safe(String(cid), 10) + '_' + d.toISOString().slice(0, 10) + '.zip';
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="' + name + '"');
    res.setHeader('Cache-Control', 'no-store');
    audit.fromReq(req, 'doc_archive.download_start', 'company', cid, {});
    const r = await arch.writeArchive(res, u, { isAborted: () => closed });
    if (r.ok) audit.fromReq(req, 'doc_archive.download', 'company', cid, { archive_id: r.archive_id, files: r.files, bytes: r.bytes });
    res.end();
  } catch (err) {
    console.error('doc-archive hiba:', err);
    if (!res.headersSent) res.status(500).send('Eroare de server');
    else res.destroy(err);
  } finally {
    _running.delete(cid);
  }
});

router.get('/api/waybill-download/:id', async (req, res) => {
  try {
    const u = req.session && req.session.user;
    if (!_am(u)) return res.status(403).send('Acces interzis');
    const id = parseInt(req.params.id, 10) || 0;
    const r = await pool.query(
      `SELECT d.id, d.waybill_id, d.file_name, d.pdf_data, d.downloaded_at, f.numar_fisa
         FROM waybill_doc_downloads d LEFT JOIN fuvarlevelek f ON f.id = d.waybill_id
        WHERE d.id = $1 AND d.company_id = $2 AND d.expires_at > NOW()`, [id, u.company_id]);
    const row = r.rows[0];
    if (!row || !row.pdf_data) return res.status(404).send('Nu a fost găsit (sau a expirat după 1 an).');
    const name = arch.safe(row.file_name || ((row.numar_fisa || row.waybill_id) + '_documente.pdf'), 120);
    audit.fromReq(req, 'waybill_doc.redownload', 'waybill', row.waybill_id, { download_id: row.id });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="' + (name.endsWith('.pdf') ? name : name + '.pdf') + '"');
    res.setHeader('Cache-Control', 'no-store');
    return res.send(row.pdf_data);
  } catch (err) {
    console.error('waybill-download hiba:', err);
    return res.status(500).send('Eroare de server');
  }
});

module.exports = router;
