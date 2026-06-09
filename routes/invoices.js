// routes/invoices.js — mount: app.use(require('./routes/invoices'));
const express = require('express');
const pool = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');
const svc = require('../services/invoicing');
const { getAdapter, listProviders } = require('../services/invoiceAdapter');
const { encrypt, decrypt, mask } = require('../lib/crypto');

const router = express.Router();
const CATEGORY = 'invoicing';

// ---- BEÁLLÍTÁS ----
router.get('/api/integrations/invoicing', requireLogin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT provider, enabled, status, meta, credentials_enc FROM company_integrations
       WHERE company_id=$1 AND category=$2`, [req.session.user.company_id, CATEGORY]);
    const a = rows.find(r => r.enabled) || rows[0] || null;
    res.json({
      providers: listProviders(), connected: !!a, provider: a ? a.provider : null,
      enabled: a ? a.enabled : false, meta: a ? a.meta : {},
      masked_key: a && a.credentials_enc ? mask(JSON.parse(decrypt(a.credentials_enc)).PrivateKey || '') : null,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/integrations/invoicing', requireLogin, requireRole('Admin'), async (req, res) => {
  const b = req.body || {};
  if (!b.provider) return res.status(400).json({ error: 'provider kötelező.' });
  try {
    getAdapter(b.provider);
    const creds = JSON.stringify({ CodUnic: (b.cod_unic || '').trim(), PrivateKey: (b.private_key || '').trim() });
    const series = String(b.series || b.serie || '').split(',').map(s => s.trim()).filter(Boolean);
    const meta = {
      provider: b.provider, series, serie: series[0] || '',
      vat_payer: b.vat_payer !== false, default_tva: b.default_tva != null ? Number(b.default_tva) : 21,
      currency: b.currency || 'RON', environment: b.environment || 'test',
      article_label: (b.article_label || '').trim() || undefined,
      scadenta_days: b.scadenta_days != null && b.scadenta_days !== '' ? Number(b.scadenta_days) : undefined,
      platform_url: `${req.protocol}://${req.get('host')}`,
    };
    await pool.query(`UPDATE company_integrations SET enabled=false WHERE company_id=$1 AND category=$2`,
      [req.session.user.company_id, CATEGORY]);
    await pool.query(
      `INSERT INTO company_integrations (company_id, provider, category, enabled, credentials_enc, status, meta, updated_at)
       VALUES ($1,$2,$3,true,$4,'connected',$5,now())
       ON CONFLICT (company_id, provider) DO UPDATE SET enabled=true, credentials_enc=$4, status='connected', meta=$5, updated_at=now()`,
      [req.session.user.company_id, b.provider, CATEGORY, encrypt(creds), JSON.stringify(meta)]);
    res.json({ ok: true });
  } catch (e) { res.status(e.code === 'PROVIDER_NOT_IMPLEMENTED' ? 400 : 500).json({ error: e.message }); }
});

// ---- PROXY: nomenklátorok (Tip, ÁFA) + mentett cikkek ----
router.get('/api/integrations/invoicing/nomenclator', requireLogin, async (req, res) => {
  try { res.json(await svc.getProviderLists(pool, req.session.user.company_id)); }
  catch (e) { res.status(502).json({ error: e.message, tipfactura: [], tva: [] }); }
});
router.get('/api/integrations/invoicing/articles', requireLogin, async (req, res) => {
  try { res.json({ articles: await svc.getProviderArticles(pool, req.session.user.company_id) }); }
  catch (e) { res.status(502).json({ error: e.message, articles: [] }); }
});

// ---- SZÁMLÁZÁS A FUVARNÁL ----
router.post('/api/orders/:id/invoice/preview', requireLogin, async (req, res) => {
  try {
    const cfg = await svc.getInvoiceConfig(pool, req.session.user.company_id);
    if (!cfg) return res.status(409).json({ error: 'Nincs bekapcsolt számlázó.' });
    const ord = await pool.query(`SELECT * FROM orders WHERE id=$1 AND company_id=$2`, [req.params.id, req.session.user.company_id]);
    if (!ord.rows.length) return res.status(404).json({ error: 'Fuvar nem található.' });
    let client = null;
    if (ord.rows[0].client_id) {
      const c = await pool.query(`SELECT * FROM clients WHERE id=$1 AND company_id=$2`, [ord.rows[0].client_id, req.session.user.company_id]);
      client = c.rows[0] || null;
    }
    res.json({ invoice: svc.buildInvoiceFromOrder(ord.rows[0], client, cfg), vatPayer: cfg.vatPayer });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/orders/:id/invoice/emit', requireLogin, requireRole('Admin', 'Manager'), async (req, res) => {
  try {
    const r = await svc.emitInvoice(pool, req.session.user.company_id, req.session.user.id, req.params.id, req.body.invoice);
    res.json({ ok: true, ...r });
  } catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message }); }
});

// Storno (jóváíró) számla — csak a már kiállított számla alapján, mennyiség negatív.
router.post('/api/orders/:id/invoice/storno', requireLogin, requireRole('Admin', 'Manager'), async (req, res) => {
  try {
    const r = await svc.emitStorno(pool, req.session.user.company_id, req.session.user.id, req.params.id);
    res.json({ ok: true, ...r });
  } catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message }); }
});

// Számla-állapot összesítő több fuvarra (fuvar-lista indikátor + modal).
router.get('/api/invoices/summary', requireLogin, async (req, res) => {
  try {
    const ids = String(req.query.order_ids || '').split(',').map(s => s.trim()).filter(Boolean);
    res.json({ summary: await svc.getInvoiceSummary(pool, req.session.user.company_id, ids) });
  } catch (e) { res.status(500).json({ error: e.message, summary: {} }); }
});

router.get('/api/orders/:id/invoice', requireLogin, async (req, res) => {
  try { res.json({ invoice: await svc.getStoredInvoice(pool, req.session.user.company_id, req.params.id) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/invoices/:id/status', requireLogin, async (req, res) => {
  try {
    const inv = await pool.query(`SELECT * FROM invoices WHERE id=$1 AND company_id=$2`, [req.params.id, req.session.user.company_id]);
    if (!inv.rows.length) return res.status(404).json({ error: 'Számla nem található.' });
    const cfg = await svc.getInvoiceConfig(pool, req.session.user.company_id);
    res.json(await getAdapter(inv.rows[0].provider).getStatus(cfg.creds, { numar: inv.rows[0].numar, serie: inv.rows[0].serie }));
  } catch (e) { res.status(502).json({ error: e.message }); }
});

module.exports = router;
