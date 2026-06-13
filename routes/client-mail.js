// routes/client-mail.js — Kliens-e-mail: logó, sablonok, küldés (Brevo), beszélgetés-napló.
const express = require('express');
const pool = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');
const { sendClientEmail } = require('../services/email');

const router = express.Router();
const own = (req) => req.session.user.company_id;

// ---------- PUBLIKUS logó (az e-mail kliensek ezt töltik be) ----------
router.get('/branding/logo/:file', async (req, res) => {
  try {
    const companyId = parseInt(String(req.params.file).replace(/\.(png|jpg|jpeg|webp)$/i, ''), 10);
    if (!companyId) return res.status(404).end();
    const { rows } = await pool.query(`SELECT logo_base64, logo_mime FROM company_branding WHERE company_id=$1`, [companyId]);
    if (!rows.length || !rows[0].logo_base64) return res.status(404).end();
    res.setHeader('Content-Type', rows[0].logo_mime || 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(Buffer.from(rows[0].logo_base64, 'base64'));
  } catch (e) { res.status(500).end(); }
});

// ---------- Logó: lekérdezés / feltöltés / törlés (UI) ----------
router.get('/api/branding/logo', requireLogin, requireRole('Admin', 'Manager'), async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT logo_base64, logo_mime, updated_at FROM company_branding WHERE company_id=$1`, [own(req)]);
    const has = !!(rows[0] && rows[0].logo_base64);
    res.json({ has, mime: has ? rows[0].logo_mime : null, dataUri: has ? `data:${rows[0].logo_mime};base64,${rows[0].logo_base64}` : null });
  } catch (e) { console.error('GET /api/branding/logo hiba:', e); res.status(500).json({ error: 'Eroare de server' }); }
});
router.post('/api/branding/logo', requireLogin, requireRole('Admin', 'Manager'), async (req, res) => {
  let b64 = String(req.body.base64 || '');
  const mime = String(req.body.mime || 'image/png');
  b64 = b64.replace(/^data:[^;]+;base64,/, '');
  if (!b64) return res.status(400).json({ error: 'Lipseste imaginea.' });
  if (b64.length > 4 * 1024 * 1024) return res.status(413).json({ error: 'Logo-ul este prea mare (max ~3 MB).' });
  try {
    await pool.query(
      `INSERT INTO company_branding (company_id, logo_base64, logo_mime, updated_at)
       VALUES ($1,$2,$3,now())
       ON CONFLICT (company_id) DO UPDATE SET logo_base64=$2, logo_mime=$3, updated_at=now()`,
      [own(req), b64, mime]);
    res.json({ ok: true });
  } catch (e) { console.error('POST /api/branding/logo hiba:', e); res.status(500).json({ error: 'Eroare de server' }); }
});
router.delete('/api/branding/logo', requireLogin, requireRole('Admin', 'Manager'), async (req, res) => {
  try { await pool.query(`DELETE FROM company_branding WHERE company_id=$1`, [own(req)]); res.json({ ok: true }); }
  catch (e) { console.error('DELETE /api/branding/logo hiba:', e); res.status(500).json({ error: 'Eroare de server' }); }
});

// ---------- E-mail sablonok (CRUD) ----------
router.get('/api/email-templates', requireLogin, requireRole('Admin', 'Manager'), async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT id, name, subject, body, updated_at FROM email_templates WHERE company_id=$1 ORDER BY name`, [own(req)]);
    res.json({ items: rows });
  } catch (e) { console.error('GET /api/email-templates hiba:', e); res.status(500).json({ error: 'Eroare de server' }); }
});
router.post('/api/email-templates', requireLogin, requireRole('Admin', 'Manager'), async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Numele sablonului este obligatoriu.' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO email_templates (company_id, name, subject, body, created_by) VALUES ($1,$2,$3,$4,$5)
       RETURNING id, name, subject, body, updated_at`,
      [own(req), name, String(req.body.subject || ''), String(req.body.body || ''), req.session.user.id]);
    res.json({ item: rows[0] });
  } catch (e) { console.error('POST /api/email-templates hiba:', e); res.status(500).json({ error: 'Eroare de server' }); }
});
router.put('/api/email-templates/:id', requireLogin, requireRole('Admin', 'Manager'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE email_templates SET name=$1, subject=$2, body=$3, updated_at=now()
         WHERE id=$4 AND company_id=$5 RETURNING id, name, subject, body, updated_at`,
      [String(req.body.name || '').trim(), String(req.body.subject || ''), String(req.body.body || ''), req.params.id, own(req)]);
    if (!rows.length) return res.status(404).json({ error: 'Nu a fost gasit.' });
    res.json({ item: rows[0] });
  } catch (e) { console.error('PUT /api/email-templates/:id hiba:', e); res.status(500).json({ error: 'Eroare de server' }); }
});
router.delete('/api/email-templates/:id', requireLogin, requireRole('Admin', 'Manager'), async (req, res) => {
  try { await pool.query(`DELETE FROM email_templates WHERE id=$1 AND company_id=$2`, [req.params.id, own(req)]); res.json({ ok: true }); }
  catch (e) { console.error('DELETE /api/email-templates/:id hiba:', e); res.status(500).json({ error: 'Eroare de server' }); }
});

// ---------- Beszélgetés-előzmény ----------
router.get('/api/client-mail', requireLogin, requireRole('Admin', 'Manager'), async (req, res) => {
  try {
    const params = [own(req)];
    let sql = `SELECT id, inbound_order_id, order_id, to_email, subject, body, status, error_message, sent_at FROM client_emails WHERE company_id=$1`;
    if (req.query.inbound_order_id) { params.push(req.query.inbound_order_id); sql += ` AND inbound_order_id=$2`; }
    else if (req.query.order_id) { params.push(req.query.order_id); sql += ` AND order_id=$2`; }
    sql += ` ORDER BY sent_at DESC LIMIT 100`;
    const { rows } = await pool.query(sql, params);
    res.json({ items: rows });
  } catch (e) { console.error('GET /api/client-mail hiba:', e); res.status(500).json({ error: 'Eroare de server' }); }
});

// ---------- Küldés (Brevo) + naplózás ----------
router.post('/api/client-mail/send', requireLogin, requireRole('Admin', 'Manager'), async (req, res) => {
  const to = String(req.body.to || '').trim();
  const subject = String(req.body.subject || '').trim();
  const html = String(req.body.html || '').trim();
  if (!to || !html) return res.status(400).json({ error: 'Destinatarul si mesajul sunt obligatorii.' });
  try {
    // cégnév (feladó neve) + logó URL
    let senderName = 'VallorSoft';
    try { const c = await pool.query(`SELECT * FROM companies WHERE id=$1`, [own(req)]); const r = c.rows[0] || {}; senderName = r.nume || r.name || r.denumire || senderName; } catch (_) {}
    const hasLogo = await pool.query(`SELECT 1 FROM company_branding WHERE company_id=$1 AND logo_base64 IS NOT NULL`, [own(req)]);
    const appUrl = process.env.APP_URL || '';
    const logoUrl = (hasLogo.rows.length && appUrl) ? `${appUrl}/branding/logo/${own(req)}.png` : null;

    // opcionális: a beérkező megrendelő PDF csatolása
    const attachments = [];
    if (req.body.attach_inbound_pdf && req.body.inbound_order_id) {
      const p = await pool.query(`SELECT pdf_name, pdf_data FROM inbound_orders WHERE id=$1 AND company_id=$2`, [req.body.inbound_order_id, own(req)]);
      if (p.rows.length && p.rows[0].pdf_data) attachments.push({ name: p.rows[0].pdf_name || 'comanda.pdf', contentBase64: p.rows[0].pdf_data.toString('base64') });
    }

    const result = await sendClientEmail({ to, subject, html, replyTo: req.session.user.email, senderName, logoUrl, attachments });

    await pool.query(
      `INSERT INTO client_emails (company_id, inbound_order_id, order_id, to_email, subject, body, status, error_message, sent_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [own(req), req.body.inbound_order_id || null, req.body.order_id || null, to, subject, html,
       result.ok ? 'sent' : 'error', result.ok ? null : result.error, req.session.user.id]);

    if (!result.ok) return res.status(502).json({ error: result.error });
    res.json({ ok: true });
  } catch (e) { console.error('POST /api/client-mail/send hiba:', e); res.status(500).json({ error: 'Eroare de server' }); }
});

module.exports = router;
