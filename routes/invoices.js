// routes/invoices.js — mount: app.use(require('./routes/invoices'));
const express = require('express');
const pool = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');
const svc = require('../services/invoicing');
const { getAdapter, listProviders } = require('../services/invoiceAdapter');
const billing = require('../services/billing');
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
    // Ha az univerzális számlázó-keretrendszer (billing_integrations) aktív,
    // a fuvar-számlázás AZON megy — a kártya ezt jelezni tudja.
    const fw = await pool.query(
      `SELECT provider FROM billing_integrations WHERE company_id=$1 AND is_active=true LIMIT 1`,
      [req.session.user.company_id]);
    res.json({
      providers: listProviders(), connected: !!a, provider: a ? a.provider : null,
      enabled: a ? a.enabled : false, meta: a ? a.meta : {},
      masked_key: a && a.credentials_enc ? mask(JSON.parse(decrypt(a.credentials_enc)).PrivateKey || '') : null,
      framework_active: fw.rows.length > 0,
      framework_provider: fw.rows.length ? fw.rows[0].provider : null,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/integrations/invoicing', requireLogin, requireRole('Admin'), async (req, res) => {
  const b = req.body || {};
  if (!b.provider) return res.status(400).json({ error: 'provider este obligatoriu.' });
  try {
    getAdapter(b.provider);
    const codUnic = (b.cod_unic || '').trim();
    let privateKey = (b.private_key || '').trim();
    // Ha a PrivateKey üresen jött (a jelszó-mezőt nem írták újra mentéskor), tartsuk meg a
    // korábban mentettet — különben egy újra-mentés kitörölné a kulcsot és elromlana a hash.
    if (!privateKey) {
      const prev = await pool.query(
        `SELECT credentials_enc FROM company_integrations WHERE company_id=$1 AND provider=$2 AND category=$3`,
        [req.session.user.company_id, b.provider, CATEGORY]);
      if (prev.rows.length && prev.rows[0].credentials_enc) {
        try { privateKey = JSON.parse(decrypt(prev.rows[0].credentials_enc)).PrivateKey || ''; } catch (_) {}
      }
    }
    const creds = JSON.stringify({ CodUnic: codUnic, PrivateKey: privateKey });
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

// ---- KAPCSOLAT TESZTELÉSE (a mentett konfiggal, valódi FGO-hívás) ----
router.post('/api/integrations/invoicing/test', requireLogin, requireRole('Admin'), async (req, res) => {
  try {
    const cfg = await svc.getInvoiceConfig(pool, req.session.user.company_id);
    if (!cfg || !cfg.provider) return res.status(409).json({ ok: false, error: 'Nu exista facturator salvat. Introduceti si salvati mai intai datele CodUnic + cheie.' });
    if (cfg.source === 'framework') {
      const r = await billing.getAdapter(cfg.provider, cfg.creds).testConnection();
      return res.json({ ok: !!r.ok, message: (r.message || '') + ' (facturator universal: ' + billing.displayName(cfg.provider) + ')' });
    }
    const adapter = getAdapter(cfg.provider);
    if (!adapter.testConnection) return res.json({ ok: true, message: 'Acest furnizor nu are test de conexiune.' });
    const r = await adapter.testConnection(cfg.creds);
    res.json({ ok: !!r.ok, message: r.message });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
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
    if (!cfg) return res.status(409).json({ error: 'Nu exista facturator activat.' });
    const ord = await pool.query(`SELECT * FROM orders WHERE id=$1 AND company_id=$2`, [req.params.id, req.session.user.company_id]);
    if (!ord.rows.length) return res.status(404).json({ error: 'Cursa nu a fost gasita.' });
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

// Teljes céges kimenő számla-lista (Kimenő számlák oldal). Multi-tenant: company_id-szűrt, paraméteres.
router.get('/api/invoices', requireLogin, async (req, res) => {
  try {
    const cid = req.session.user.company_id;
    const params = [cid];
    let dateFilter = '';
    const from = String(req.query.from || '').trim();
    const to = String(req.query.to || '').trim();
    if (from) { params.push(from); dateFilter += ` AND i.created_at >= $${params.length}`; }
    if (to) { params.push(to); dateFilter += ` AND i.created_at < $${params.length}`; }
    const { rows } = await pool.query(
      `SELECT i.id, i.order_id, i.serie, i.numar, i.total, i.valuta, i.tva,
              i.pdf_link, i.status, i.efactura_status, i.provider, i.client_name, i.created_at
       FROM invoices i
       WHERE i.company_id = $1${dateFilter}
       ORDER BY i.created_at DESC LIMIT 500`, params);
    res.json({ ok: true, invoices: rows });
  } catch (e) { res.status(500).json({ ok: false, error: 'Eroare de server.' }); }
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
    const cid = req.session.user.company_id;
    const inv = await pool.query(`SELECT * FROM invoices WHERE id=$1 AND company_id=$2`, [req.params.id, cid]);
    if (!inv.rows.length) return res.status(404).json({ error: 'Factura nu a fost gasita.' });
    const row = inv.rows[0];
    const cfg = await svc.getInvoiceConfig(pool, cid);
    if (!cfg) return res.json({ ok: false, message: 'Nu este configurata nicio integrare de facturare.' });

    // 1) Legacy adapter (pl. fgo) getStatus; 2) keretrendszer-adapter getInvoice(serie, numar).
    let st = null;
    let legacyAdapter = null;
    try { legacyAdapter = getAdapter(row.provider); } catch (_) { /* framework-provider */ }
    if (legacyAdapter && legacyAdapter.getStatus) {
      st = await legacyAdapter.getStatus(cfg.creds, { numar: row.numar, serie: row.serie });
    } else {
      try {
        const fw = billing.getAdapter(row.provider, cfg.creds);
        if (fw && typeof fw.getInvoice === 'function') {
          const r2 = await fw.getInvoice(row.serie || '', row.numar || '');
          st = r2.ok ? Object.assign({ ok: true }, r2.invoice, { raw: r2.raw }) : r2;
        }
      } catch (_) {}
    }
    if (!st) return res.json({ ok: false, message: 'Acest furnizor nu are interogare de status factura.' });
    if (!st.ok) return res.json(st);

    // e-Factura (ANAF SPV) státusz kinyerése + tárolása — ezt mutatja a
    // fuvarlista 📨 jelzője és a számla-modal.
    const ef = svc.extractEFacturaStatus(st.raw);
    const updateFields = [];
    const updateVals = [];
    let p = 1;
    if (ef && ef !== row.efactura_status) { updateFields.push('efactura_status=$' + p++); updateVals.push(ef); }
    if (st.raw) { updateFields.push('efactura_last_raw=$' + p++); updateVals.push(JSON.stringify(st.raw)); }
    updateFields.push('efactura_checked_at=$' + p++); updateVals.push(new Date());
    updateVals.push(row.id, cid);
    await pool.query(
      'UPDATE invoices SET ' + updateFields.join(', ') + ' WHERE id=$' + p++ + ' AND company_id=$' + p++,
      updateVals);
    res.json({ ok: true, value: st.value, paid: st.paid, efactura: ef || row.efactura_status || null });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

module.exports = router;
