// services/invoicing.js
// Számlázás üzleti logika: fuvar+ügyfél -> szerkeszthető számla; kiállítás az aktív szolgáltatóval.
const { getAdapter } = require('./invoiceAdapter');
const { decrypt } = require('../lib/crypto');

const DEFAULT_LABEL = 'Transport marfă conform contractului/comenzii';

async function getInvoiceConfig(pool, companyId) {
  const { rows } = await pool.query(
    `SELECT credentials_enc, enabled, meta FROM company_integrations
     WHERE company_id=$1 AND category='invoicing' AND enabled=true LIMIT 1`, [companyId]);
  if (!rows.length) return null;
  const r = rows[0];
  const creds = r.credentials_enc ? JSON.parse(decrypt(r.credentials_enc)) : {};
  const m = r.meta || {};
  return {
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
  const result = await getAdapter(cfg.provider).emit(cfg.creds, payload);
  if (!result.ok) { const e = new Error(result.message || 'A számlázó hibát adott.'); e.status = 502; throw e; }

  const net = (payload.lines || []).reduce((s, l) => s + l.qty * l.unitPrice, 0);
  const tva = payload.reverseCharge ? 0 : (payload.lines || []).reduce((s, l) => s + l.qty * l.unitPrice * (l.vatRate / 100), 0);
  const c = payload.client || {};
  const { rows } = await pool.query(
    `INSERT INTO invoices (company_id, order_id, provider, serie, numar, total, valuta, tva, pdf_link, status,
       client_name, client_cui, client_tip, client_address, payload, created_by, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'issued',$10,$11,$12,$13,$14,$15,now()) RETURNING id`,
    [companyId, orderId, cfg.provider, result.serie, result.numar, net + tva, payload.currency, tva,
     result.pdf_link, c.name, c.cui, c.type, c.address, JSON.stringify(payload), userId]);
  return { id: rows[0].id, serie: result.serie, numar: result.numar, pdf_link: result.pdf_link };
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
  const a = getAdapter(cfg.provider);
  return a.listArticles ? a.listArticles(cfg.creds).catch(() => []) : [];
}

module.exports = { getInvoiceConfig, buildInvoiceFromOrder, emitInvoice, getStoredInvoice, getProviderLists, getProviderArticles };
