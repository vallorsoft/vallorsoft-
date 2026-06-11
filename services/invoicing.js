// services/invoicing.js
// Számlázás üzleti logika: fuvar+ügyfél -> szerkeszthető számla; kiállítás az aktív szolgáltatóval.
//
// KÉT KONFIG-FORRÁS (K09 átkötés):
//   1. ÚJ (elsőbbség): billing_integrations — az univerzális számlázó-keretrendszer
//      (services/billing/, 5 provider). Aki itt állít be számlázót (SmartBill,
//      Oblio, FGO, ...), az ezzel állít ki fuvar-számlát is.
//   2. RÉGI (fallback): company_integrations category='invoicing' — a korábbi
//      FGO-specifikus út. A meglévő FGO-s cégek változatlanul működnek.
const { getAdapter } = require('./invoiceAdapter');
const billing = require('./billing');
const { decrypt } = require('../lib/crypto');

const DEFAULT_LABEL = 'Transport marfă conform contractului/comenzii';

async function getInvoiceConfig(pool, companyId) {
  // 1) ÚJ keretrendszer (billing_integrations) — ha van aktív, az nyer.
  const fw = await pool.query(
    `SELECT provider, credentials FROM billing_integrations
     WHERE company_id=$1 AND is_active=true LIMIT 1`, [companyId]);
  if (fw.rows.length && billing.isValidProvider(fw.rows[0].provider)) {
    let creds = {};
    try { creds = fw.rows[0].credentials && fw.rows[0].credentials.enc ? JSON.parse(decrypt(fw.rows[0].credentials.enc)) : {}; }
    catch (e) { console.error('billing_integrations credentials dekódolás hiba:', e.message); }
    // A számla-beállítások (sorozat, ÁFA, pénznem) a credentials-ben tárolódnak
    // (a provider-űrlap opcionális mezői) — hiányukra észszerű alapértékek.
    return {
      source: 'framework',
      provider: fw.rows[0].provider,
      creds,
      series: creds.serie ? [String(creds.serie).trim()] : [],
      vatPayer: creds.vat_payer !== false,
      defaultTva: creds.default_tva != null && creds.default_tva !== '' ? Number(creds.default_tva) : 21,
      currency: (creds.currency || 'RON').toUpperCase(),
      articleLabel: (creds.article_label || '').trim() || DEFAULT_LABEL,
      scadentaDays: creds.scadenta_days != null && creds.scadenta_days !== '' ? Number(creds.scadenta_days) : null,
    };
  }

  // 2) Régi (FGO-specifikus) konfig — visszafelé kompatibilitás.
  const { rows } = await pool.query(
    `SELECT credentials_enc, enabled, meta FROM company_integrations
     WHERE company_id=$1 AND category='invoicing' AND enabled=true LIMIT 1`, [companyId]);
  if (!rows.length) return null;
  const r = rows[0];
  const creds = r.credentials_enc ? JSON.parse(decrypt(r.credentials_enc)) : {};
  const m = r.meta || {};
  return {
    source: 'legacy',
    provider: m.provider,
    creds: { ...creds, PlatformaUrl: m.platform_url, environment: m.environment || 'test' },
    series: Array.isArray(m.series) && m.series.length ? m.series : (m.serie ? [m.serie] : []),
    vatPayer: m.vat_payer !== false,
    defaultTva: m.default_tva != null ? m.default_tva : 21,
    currency: m.currency || 'RON',
    articleLabel: m.article_label || DEFAULT_LABEL,
    scadentaDays: m.scadenta_days != null ? Number(m.scadenta_days) : null,
  };
}

// A legacy számla-payload ({serie, issueDate, client:{cui,...}, lines:[{qty,vatRate,unitPrice,...}]})
// átfordítása az univerzális keretrendszer createInvoice() formátumára.
function toFrameworkInvoice(payload) {
  const rc = !!payload.reverseCharge;
  return {
    serie: payload.serie || undefined,
    issue_date: payload.issueDate,
    due_date: payload.dueDate || payload.issueDate,
    currency: payload.currency || 'RON',
    notes: [payload.notes, rc ? 'Taxare inversă' : ''].filter(Boolean).join(' · '),
    client: {
      name: payload.client && payload.client.name,
      vat_code: payload.client && payload.client.cui,
      address: payload.client && payload.client.address,
      email: payload.client && payload.client.email,
    },
    items: (payload.lines || []).map((l) => ({
      name: l.name,
      description: l.description || undefined,
      unit: l.unit || 'BUC',
      quantity: l.qty,
      price_net: l.unitPrice,
      vat_percent: rc ? 0 : l.vatRate,
    })),
  };
}

// Kiállítás az aktív konfig szerinti úton. Egységes eredmény:
//   { ok, serie, numar, pdf_link, raw } | { ok:false, message }
async function emitViaProvider(cfg, payload) {
  if (cfg.source === 'framework') {
    const adapter = billing.getAdapter(cfg.provider, cfg.creds);
    const r = await adapter.createInvoice(toFrameworkInvoice(payload));
    if (!r.ok) return { ok: false, message: r.message };
    return {
      ok: true,
      serie: r.serie || payload.serie || null,
      numar: r.numar || r.invoice_number || null,
      pdf_link: r.pdf_url || null,
      raw: r.raw,
    };
  }
  return getAdapter(cfg.provider).emit(cfg.creds, payload);
}

function ymd(d) { return d.toISOString().slice(0, 10); }

// Szerkeszthető számla a fuvarból + ügyfélből (a modal ezt tölti be).
function buildInvoiceFromOrder(order, client, cfg) {
  const details = [];
  if (order.id) details.push('Comanda ' + order.id);
  if (order.loc_incarcare && order.loc_descarcare) details.push('ruta ' + order.loc_incarcare + ' → ' + order.loc_descarcare);
  if (order.rendszam_camion) details.push('camion ' + order.rendszam_camion);
  if (order.data_incarcare) details.push('încărcare ' + String(order.data_incarcare).slice(0, 10));
  const issue = new Date();
  const due = cfg.scadentaDays != null ? new Date(issue.getTime() + cfg.scadentaDays * 86400000) : null;
  return {
    serie: cfg.series[0] || '',
    seriesOptions: cfg.series,
    currency: cfg.currency,
    type: 'Factura',
    issueDate: ymd(issue),
    dueDate: due ? ymd(due) : '',
    text: '', notes: '',
    client: {
      name: client ? client.denumire : (order.client || ''),
      type: client ? (client.tip || 'PJ') : 'PJ',
      country: client ? (client.tara || 'RO') : 'RO',
      county: client ? client.judet : '',
      city: client ? client.localitate : '',
      cui: client ? client.cui_cif : '',
      regCom: client ? client.reg_com : '',
      address: client ? client.adresa : '',
    },
    lines: [{
      name: cfg.articleLabel,                       // Denumire = általános címke
      description: details.join(', '),              // Descriere = fuvaradatok
      unit: 'BUC', qty: 1,
      vatRate: cfg.vatPayer ? cfg.defaultTva : 0,
      unitPrice: Number(order.pret) || 0,           // NETTÓ
      code: '', gestiune: '', costCenter: '',
    }],
    reverseCharge: false,
  };
}

async function emitInvoice(pool, companyId, userId, orderId, payload) {
  const cfg = await getInvoiceConfig(pool, companyId);
  if (!cfg || !cfg.provider) { const e = new Error('Nincs bekapcsolt számlázó.'); e.status = 409; throw e; }

  // Dupla-számla védelem TRANZAKCIÓBAN, a fuvar sorára vett zárral:
  // két párhuzamos kérés közül a második megvárja az elsőt, és már látja
  // a beszúrt számlát — a szolgáltatónál sem készülhet két éles számla.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM orders WHERE id=$1 AND company_id=$2 FOR UPDATE', [orderId, companyId]);
    const existing = await client.query(
      `SELECT id, serie, numar, pdf_link FROM invoices
       WHERE company_id=$1 AND order_id=$2 AND status='issued' ORDER BY created_at DESC LIMIT 1`,
      [companyId, orderId]);
    if (existing.rows.length) {
      const ex = existing.rows[0];
      const e = new Error('Ehhez a fuvarhoz már van kiállított számla (' +
        [ex.serie, ex.numar].filter(Boolean).join('-') + '). Új számla nem készült.');
      e.status = 409; e.existing = ex;
      throw e;
    }

    const result = await emitViaProvider(cfg, payload);
    if (!result.ok) { const e = new Error(result.message || 'A számlázó hibát adott.'); e.status = 502; throw e; }

    const net = (payload.lines || []).reduce((s, l) => s + l.qty * l.unitPrice, 0);
    const tva = payload.reverseCharge ? 0 : (payload.lines || []).reduce((s, l) => s + l.qty * l.unitPrice * (l.vatRate / 100), 0);
    const c = payload.client || {};
    const { rows } = await client.query(
      `INSERT INTO invoices (company_id, order_id, provider, serie, numar, total, valuta, tva, pdf_link, status,
         client_name, client_cui, client_tip, client_address, payload, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'issued',$10,$11,$12,$13,$14,$15,now()) RETURNING id`,
      [companyId, orderId, cfg.provider, result.serie, result.numar, net + tva, payload.currency, tva,
       result.pdf_link, c.name, c.cui, c.type, c.address, JSON.stringify(payload), userId]);
    await client.query('COMMIT');
    return { id: rows[0].id, serie: result.serie, numar: result.numar, pdf_link: result.pdf_link };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function getStoredInvoice(pool, companyId, orderId) {
  const { rows } = await pool.query(
    `SELECT id, provider, serie, numar, total, valuta, pdf_link, status FROM invoices
     WHERE company_id=$1 AND order_id=$2 ORDER BY created_at DESC LIMIT 1`, [companyId, orderId]);
  return rows[0] || null;
}

// Provider-listák a modal legördülőihez (Tip, ÁFA) + mentett cikkek.
async function getProviderLists(pool, companyId) {
  const cfg = await getInvoiceConfig(pool, companyId);
  if (!cfg) return { tipfactura: [], tva: [] };
  // A keretrendszer-adaptereknek nincs nomenklátor-API-juk — a modal a
  // beépített alapértékeire esik vissza (Factura / 21-11-9-5-0).
  if (cfg.source === 'framework') return { tipfactura: [], tva: [] };
  const a = getAdapter(cfg.provider);
  const [tipfactura, tva] = await Promise.all([
    a.getNomenclator ? a.getNomenclator(cfg.creds, 'tipfactura').catch(() => []) : [],
    a.getNomenclator ? a.getNomenclator(cfg.creds, 'tva').catch(() => []) : [],
  ]);
  return { tipfactura, tva };
}
async function getProviderArticles(pool, companyId) {
  const cfg = await getInvoiceConfig(pool, companyId);
  if (!cfg) return [];
  if (cfg.source === 'framework') return [];
  const a = getAdapter(cfg.provider);
  return a.listArticles ? a.listArticles(cfg.creds).catch(() => []) : [];
}

// Storno (jóváíró) számla a MÁR kiállított számla alapján — minden adat ugyanaz,
// csak a mennyiség negatív. Egy fuvarhoz csak egy storno készülhet.
async function emitStorno(pool, companyId, userId, orderId) {
  const cfg = await getInvoiceConfig(pool, companyId);
  if (!cfg || !cfg.provider) { const e = new Error('Nincs bekapcsolt számlázó.'); e.status = 409; throw e; }

  // Dupla-storno védelem tranzakcióban, a fuvar sorára vett zárral (mint emitInvoice).
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM orders WHERE id=$1 AND company_id=$2 FOR UPDATE', [orderId, companyId]);

    const issued = await client.query(
      `SELECT * FROM invoices WHERE company_id=$1 AND order_id=$2 AND status='issued'
       ORDER BY created_at DESC LIMIT 1`, [companyId, orderId]);
    if (!issued.rows.length) { const e = new Error('Ehhez a fuvarhoz nincs kiállított számla, amit stornózni lehetne.'); e.status = 409; throw e; }
    const orig = issued.rows[0];

    const st = await client.query(
      `SELECT id FROM invoices WHERE company_id=$1 AND order_id=$2 AND status='storno' LIMIT 1`, [companyId, orderId]);
    if (st.rows.length) { const e = new Error('Ehhez a fuvarhoz már van storno számla.'); e.status = 409; throw e; }

    const base = orig.payload || {};
    const origRef = [orig.serie, orig.numar].filter(Boolean).join('-');
    const today = ymd(new Date());
    const stornoPayload = {
      ...base,
      issueDate: today,
      dueDate: today,
      notes: 'Stornare factura ' + origRef + (base.notes ? ' · ' + base.notes : ''),
      // minden tétel a kiállított számla alapján, de a mennyiség negatív
      lines: (base.lines || []).map((l) => ({ ...l, qty: -Math.abs(Number(l.qty) || 0) })),
    };

    const result = await emitViaProvider(cfg, stornoPayload);
    if (!result.ok) { const e = new Error(result.message || 'A számlázó hibát adott.'); e.status = 502; throw e; }

    const net = (stornoPayload.lines || []).reduce((s, l) => s + l.qty * l.unitPrice, 0);
    const tva = stornoPayload.reverseCharge ? 0 : (stornoPayload.lines || []).reduce((s, l) => s + l.qty * l.unitPrice * (l.vatRate / 100), 0);
    const c = stornoPayload.client || {};
    const { rows } = await client.query(
      `INSERT INTO invoices (company_id, order_id, provider, serie, numar, total, valuta, tva, pdf_link, status,
         provider_message, client_name, client_cui, client_tip, client_address, payload, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'storno',$10,$11,$12,$13,$14,$15,$16,now()) RETURNING id`,
      [companyId, orderId, cfg.provider, result.serie, result.numar, net + tva, stornoPayload.currency, tva,
       result.pdf_link, 'Storno: ' + origRef, c.name, c.cui, c.type, c.address, JSON.stringify(stornoPayload), userId]);
    await client.query('COMMIT');
    return { id: rows[0].id, serie: result.serie, numar: result.numar, pdf_link: result.pdf_link, storno_of: origRef };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Több fuvar számla-állapota egy kérésben (fuvar-lista indikátorhoz + modalhoz).
// Visszaad: { orderId: { invoiced, serie, numar, pdf_link, stornoed, storno_serie, storno_numar, storno_pdf, status } }
// A szolgáltató nyers válaszából defenzíven kinyerjük az e-Factura (ANAF SPV)
// státuszt. Az FGO /factura/getstatus a Factura objektumban adja (pl.
// StareEFactura / IndexIncarcare) — a mezőnevet kulcs-mintával keressük,
// hogy provider-verziók közti eltérés ne törje el.
function extractEFacturaStatus(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const scan = (obj, depth) => {
    if (!obj || typeof obj !== 'object' || depth > 3) return null;
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (/efactura|e_factura/i.test(k) && v != null && String(v).trim() !== '') {
        return String(v).trim().slice(0, 120);
      }
      if (v && typeof v === 'object') {
        const sub = scan(v, depth + 1);
        if (sub) return sub;
      }
    }
    // IndexIncarcare: az ANAF SPV feltöltési index — ha van, a számla be lett küldve
    for (const k of Object.keys(obj)) {
      if (/indexincarcare/i.test(k) && obj[k]) return 'trimisă (index: ' + obj[k] + ')';
    }
    return null;
  };
  return scan(raw, 0);
}

async function getInvoiceSummary(pool, companyId, orderIds) {
  const ids = (orderIds || []).filter(Boolean);
  if (!ids.length) return {};
  const { rows } = await pool.query(
    `SELECT id, order_id, serie, numar, pdf_link, status, efactura_status FROM invoices
     WHERE company_id=$1 AND order_id = ANY($2) ORDER BY created_at ASC`, [companyId, ids]);
  const out = {};
  for (const r of rows) {
    const o = out[r.order_id] || (out[r.order_id] = { invoiced: false, stornoed: false, serie: null, numar: null, pdf_link: null, status: null, efactura: null, inv_id: null });
    if (r.status === 'issued') { o.invoiced = true; o.inv_id = r.id; o.serie = r.serie; o.numar = r.numar; o.pdf_link = r.pdf_link; o.status = 'issued'; o.efactura = r.efactura_status || null; }
    if (r.status === 'storno') { o.stornoed = true; o.storno_serie = r.serie; o.storno_numar = r.numar; o.storno_pdf = r.pdf_link; o.status = 'storno'; }
  }
  return out;
}

module.exports = { getInvoiceConfig, buildInvoiceFromOrder, emitInvoice, emitStorno, getStoredInvoice, getInvoiceSummary, getProviderLists, getProviderArticles, toFrameworkInvoice, emitViaProvider, extractEFacturaStatus };
