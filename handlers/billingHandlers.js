// ============================================================
//  VallorSoft — handlers/billingHandlers.js
//  Univerzális számlázó-integráció + előfizetési csomagok.
//  A credentials AES-256-GCM-mel titkosítva tárolódik, és SOHA
//  nem kerül vissza kliens oldalra (csak a mező-NEVEK).
// ============================================================
const pool = require('../db');
const billing = require('../services/billing');
const { encrypt, decrypt } = require('../lib/crypto');
const { computePool } = require('../lib/herePool');

const handlers = {};

function isDev(u) { return !!(u && (u.is_dev || u.pozicio === 'Developer')); }
function isAdminOrDev(u) { return !!(u && (u.pozicio === 'Admin' || u.is_dev || u.pozicio === 'Developer')); }

// Tárolt credentials visszafejtése objektummá ({enc:"..."} formátum).
function decodeStoredCreds(credentialsJsonb) {
  try {
    if (!credentialsJsonb || !credentialsJsonb.enc) return {};
    return JSON.parse(decrypt(credentialsJsonb.enc));
  } catch (e) { return {}; }
}

// ─── Elérhető számlázók (dinamikus űrlaphoz) ───────────────
handlers.getAvailableProviders = async function (req, res, args) {
  if (!req.session.user) return res.json({ result: [] });
  return res.json({ result: billing.PROVIDERS });
};

// ─── A cég aktív számlázó integrációja (credentials NÉLKÜL) ──
handlers.getCompanyBillingIntegration = async function (req, res, args) {
  try {
    if (!req.session.user) return res.json({ result: { ok: false, err: 'Nincs bejelentkezve' } });
    const cid = req.session.user.company_id;
    const r = await pool.query(
      'SELECT provider, display_name, is_active, created_at, updated_at, credentials FROM billing_integrations WHERE company_id = $1 AND is_active = TRUE LIMIT 1',
      [cid]
    );
    if (!r.rows.length) return res.json({ result: { ok: true, integration: null } });
    const row = r.rows[0];
    const creds = decodeStoredCreds(row.credentials);
    return res.json({ result: { ok: true, integration: {
      provider: row.provider, display_name: row.display_name, is_active: row.is_active,
      created_at: row.created_at, updated_at: row.updated_at,
      fields: Object.keys(creds), // CSAK a kulcsnevek, értékek soha
    } } });
  } catch (err) {
    console.error('getCompanyBillingIntegration hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
  }
};

// ─── Integráció mentése (titkosítva) — Admin vagy developer ──
handlers.saveBillingIntegration = async function (req, res, args) {
  try {
    if (!isAdminOrDev(req.session.user)) return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
    const a = Array.isArray(args) ? (args[0] || {}) : (args || {});
    const provider = String(a.provider || '').trim();
    const credentials = (a.credentials && typeof a.credentials === 'object') ? a.credentials : {};
    if (!billing.isValidProvider(provider)) return res.json({ result: { ok: false, err: 'Ismeretlen számlázó.' } });

    const cid = req.session.user.company_id;
    const display_name = billing.displayName(provider);
    const encrypted = encrypt(JSON.stringify(credentials));
    const credJson = JSON.stringify({ enc: encrypted });

    // Csak egy aktív integráció / cég: a többit inaktiváljuk.
    await pool.query('UPDATE billing_integrations SET is_active = FALSE WHERE company_id = $1 AND provider <> $2', [cid, provider]);
    await pool.query(
      `INSERT INTO billing_integrations (company_id, provider, display_name, credentials, is_active, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, TRUE, now())
       ON CONFLICT (company_id, provider)
       DO UPDATE SET display_name = $3, credentials = $4::jsonb, is_active = TRUE, updated_at = now()`,
      [cid, provider, display_name, credJson]
    );
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('saveBillingIntegration hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
  }
};

// ─── Kapcsolat tesztelése — Admin vagy developer ───────────
// args: { provider, credentials? }  (ha credentials adott, azt teszteli; különben a tároltat)
handlers.testBillingIntegration = async function (req, res, args) {
  try {
    if (!isAdminOrDev(req.session.user)) return res.json({ result: { ok: false, message: 'Nincs jogosultsag' } });
    const a = Array.isArray(args) ? (args[0] || {}) : (args || {});
    const provider = String(a.provider || '').trim();
    if (!billing.isValidProvider(provider)) return res.json({ result: { ok: false, message: 'Ismeretlen számlázó.' } });

    let creds = (a.credentials && typeof a.credentials === 'object') ? a.credentials : null;
    if (!creds) {
      const r = await pool.query('SELECT credentials FROM billing_integrations WHERE company_id = $1 AND provider = $2', [req.session.user.company_id, provider]);
      if (!r.rows.length) return res.json({ result: { ok: false, message: 'Nincs mentett integráció ehhez a számlázóhoz.' } });
      creds = decodeStoredCreds(r.rows[0].credentials);
    }
    const adapter = billing.getAdapter(provider, creds);
    const result = await adapter.testConnection();
    return res.json({ result: { ok: !!result.ok, message: result.message || (result.ok ? 'Kapcsolat sikeres.' : 'Sikertelen.') } });
  } catch (err) {
    console.error('testBillingIntegration hiba:', err);
    return res.json({ result: { ok: false, message: 'Szerver hiba: ' + err.message } });
  }
};

// ─── Előfizetési csomagok ──────────────────────────────────
handlers.getSubscriptionPlans = async function (req, res, args) {
  try {
    if (!req.session.user) return res.json({ result: { ok: false, err: 'Nincs bejelentkezve' } });
    const r = await pool.query(
      'SELECT id, name, description, price_net, vat_percent, is_active, sort_order FROM subscription_plans ORDER BY sort_order'
    );
    return res.json({ result: { ok: true, plans: r.rows } });
  } catch (err) {
    console.error('getSubscriptionPlans hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
  }
};

handlers.updateSubscriptionPlan = async function (req, res, args) {
  try {
    if (!isDev(req.session.user)) return res.json({ result: { ok: false, err: 'Csak developer' } });
    const a = Array.isArray(args) ? (args[0] || {}) : (args || {});
    const id = parseInt(a.id, 10);
    if (!id) return res.json({ result: { ok: false, err: 'Hiányzó csomag ID' } });
    const price = parseFloat(a.price_net);
    await pool.query(
      `UPDATE subscription_plans SET name = $1, description = $2, price_net = $3, is_active = $4, updated_at = now() WHERE id = $5`,
      [String(a.name || '').trim() || 'Csomag', a.description || null, Number.isFinite(price) ? price : 0, a.is_active !== false, id]
    );
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('updateSubscriptionPlan hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
  }
};

handlers.setCompanyPlan = async function (req, res, args) {
  try {
    if (!isDev(req.session.user)) return res.json({ result: { ok: false, err: 'Csak developer' } });
    const a = Array.isArray(args) ? (args[0] || {}) : (args || {});
    const companyId = parseInt(a.company_id, 10);
    const planId = a.plan_id ? parseInt(a.plan_id, 10) : null;
    if (!companyId) return res.json({ result: { ok: false, err: 'Hiányzó cég ID' } });
    await pool.query('UPDATE companies SET subscription_plan_id = $1 WHERE id = $2', [planId, companyId]);
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('setCompanyPlan hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
  }
};

// ─── Developer: cégek + számlázójuk + csomagjuk (áttekintő tábla) ──
handlers.getCompaniesBillingOverview = async function (req, res, args) {
  try {
    if (!isDev(req.session.user)) return res.json({ result: { ok: false, err: 'Csak developer' } });
    const r = await pool.query(`
      SELECT c.id, c.nev,
             c.subscription_plan_id,
             sp.name AS plan_name,
             bi.provider, bi.display_name AS billing_name, bi.created_at AS billing_since
      FROM companies c
      LEFT JOIN subscription_plans sp ON sp.id = c.subscription_plan_id
      LEFT JOIN billing_integrations bi ON bi.company_id = c.id AND bi.is_active = TRUE
      ORDER BY c.nev
    `);
    return res.json({ result: { ok: true, companies: r.rows } });
  } catch (err) {
    console.error('getCompaniesBillingOverview hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
  }
};

// ─── HERE szolgáltatási számla (előfizetés + HERE használat) ──
const HU_MONTHS = ['január', 'február', 'március', 'április', 'május', 'június', 'július', 'augusztus', 'szeptember', 'október', 'november', 'december'];
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function monthLabelHu(monthYear) {
  const m = /^(\d{4})-(\d{2})$/.exec(monthYear || '');
  if (!m) return monthYear || '';
  return m[1] + '. ' + (HU_MONTHS[parseInt(m[2], 10) - 1] || m[2]);
}
function addDaysISO(days) {
  const d = new Date(); d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// Számla-adatok összeállítása (előnézethez és kiállításhoz közös).
async function buildHereInvoice(companyId, monthYear) {
  const month = monthYear || new Date().toISOString().slice(0, 7);
  const cR = await pool.query(
    `SELECT c.id, c.nev AS name, c.subscription_plan_id,
            (SELECT u.email FROM users u WHERE u.company_id = c.id AND u.pozicio = 'Admin' ORDER BY u.id LIMIT 1) AS admin_email
     FROM companies c WHERE c.id = $1 LIMIT 1`, [companyId]);
  if (!cR.rows.length) { const e = new Error('Cég nem található.'); e._user = true; throw e; }
  const company = cR.rows[0];

  const pR = await pool.query(
    `SELECT sp.name, sp.description, sp.price_net, sp.vat_percent
     FROM subscription_plans sp JOIN companies c ON c.subscription_plan_id = sp.id WHERE c.id = $1`, [companyId]);
  const plan = pR.rows[0] || null;

  const iR = await pool.query(
    `SELECT provider, display_name, credentials FROM billing_integrations WHERE company_id = $1 AND is_active = true LIMIT 1`, [companyId]);
  const integration = iR.rows[0] || null;

  // HERE: a közös 1000-es pool feletti (fizetős) használat szolgáltatásonként (computePool).
  const hp = await computePool(companyId, month);
  const billableServices = hp.services.filter((s) => (s.billable_trx || 0) > 0);

  const label = monthLabelHu(month);
  const items = [];
  if (plan) {
    items.push({ name: 'VallorSoft ' + plan.name + ' csomag — ' + label, quantity: 1, unit: 'lună', price_net: round2(plan.price_net), vat_percent: parseFloat(plan.vat_percent) || 21 });
  }
  billableServices.forEach((s) => {
    const description = (s.users || []).map((u) => u.user_name + ' (' + u.user_role + '): ' + u.used + ' trz.').join(' | ');
    items.push({
      name: 'HERE ' + s.display_name + ' — ' + label,
      quantity: s.units, unit: '1000 tranzacții', price_net: s.price_eur, vat_percent: s.vat_percent,
      used: s.billable_trx, description: description, users: s.users,
    });
  });

  let net = 0, vat = 0;
  items.forEach((it) => { const line = it.quantity * it.price_net; net += line; vat += line * (it.vat_percent / 100); });
  const totals = { net: round2(net), vat: round2(vat), gross: round2(net + vat) };

  return {
    company, plan, integration, items, totals,
    month, month_label: label,
    issue_date: addDaysISO(0), due_date: addDaysISO(30),
    notes: 'VallorSoft HERE API szolgáltatás — ' + label + '. Automatikusan generált számla.',
    has_plan: !!plan, has_here: billableServices.length > 0,
  };
}

// Előnézet — NEM állít ki számlát.
handlers.previewHereInvoice = async function (req, res, args) {
  try {
    if (!isDev(req.session.user)) return res.json({ result: { ok: false, err: 'Csak developer' } });
    const a = Array.isArray(args) ? (args[0] || {}) : (args || {});
    const companyId = parseInt(a.company_id, 10);
    if (!companyId) return res.json({ result: { ok: false, err: 'Hiányzó cég ID' } });
    const d = await buildHereInvoice(companyId, a.month_year);
    return res.json({ result: {
      ok: true,
      company_name: d.company.name,
      provider: d.integration ? d.integration.provider : null,
      provider_name: d.integration ? d.integration.display_name : null,
      items: d.items, totals: d.totals,
      month_label: d.month_label, due_date: d.due_date,
      has_plan: d.has_plan, has_here: d.has_here,
    } });
  } catch (err) {
    console.error('previewHereInvoice hiba:', err);
    return res.json({ result: { ok: false, err: err._user ? err.message : 'Szerver hiba' } });
  }
};

// Számla kiállítása a cég aktív számlázóján keresztül.
handlers.generateHereInvoice = async function (req, res, args) {
  try {
    if (!isDev(req.session.user)) return res.json({ result: { ok: false, err: 'Csak developer' } });
    const a = Array.isArray(args) ? (args[0] || {}) : (args || {});
    const companyId = parseInt(a.company_id, 10);
    if (!companyId) return res.json({ result: { ok: false, err: 'Hiányzó cég ID' } });

    const d = await buildHereInvoice(companyId, a.month_year);
    if (!d.integration) return res.json({ result: { ok: false, err: 'Nincs aktív számlázó integráció ehhez a céghez.' } });
    if (!d.items.length) return res.json({ result: { ok: false, err: 'Nincs számlázható tétel (nincs csomag és nincs HERE használat).' } });

    let creds = {};
    try { creds = JSON.parse(decrypt(d.integration.credentials.enc)); } catch (e) { return res.json({ result: { ok: false, err: 'A számlázó hitelesítő adatai nem olvashatók.' } }); }

    const adapter = billing.loadAdapter(d.integration.provider, creds);
    const result = await adapter.createInvoice({
      client: { name: d.company.name, email: d.company.admin_email },
      items: d.items.map((it) => ({ name: it.name, quantity: it.quantity, unit: it.unit, price_net: it.price_net, vat_percent: it.vat_percent, description: it.description || undefined })),
      currency: 'EUR', issue_date: d.issue_date, due_date: d.due_date, notes: d.notes,
    });
    if (!result.ok) return res.json({ result: { ok: false, err: d.integration.provider + ': ' + (result.message || 'ismeretlen hiba') } });
    return res.json({ result: { ok: true, invoice_number: result.invoice_number, pdf_url: result.pdf_url || null, provider: d.integration.provider } });
  } catch (err) {
    console.error('generateHereInvoice hiba:', err);
    return res.json({ result: { ok: false, err: err._user ? err.message : ('Szerver hiba: ' + err.message) } });
  }
};

// ─── Cégenkénti HERE használat — közös 1000-es pool, felhasználó-szintű bontással (developer) ──
handlers.getHereUsageByCompany = async function (req, res, args) {
  try {
    if (!isDev(req.session.user)) return res.json({ result: { ok: false, err: 'Csak developer' } });
    const a = Array.isArray(args) ? (args[0] || {}) : (args || {});
    const cid = a.company_id ? parseInt(a.company_id, 10) : null;
    const month = (a.month_year && /^\d{4}-\d{2}$/.test(a.month_year)) ? a.month_year : null;

    // Mely cégeknek volt HERE-használata az adott hónapban (vagy egy konkrét cég).
    const params = []; let where = "l.month_year = COALESCE($1, TO_CHAR(NOW(), 'YYYY-MM'))";
    params.push(month);
    if (cid) { params.push(cid); where += ' AND l.company_id = $2'; }
    const cr = await pool.query(
      `SELECT DISTINCT c.id AS company_id, c.nev AS company_name
       FROM here_usage_log l JOIN companies c ON c.id = l.company_id
       WHERE ${where} ORDER BY c.nev`, params);

    const monthYear = month || new Date().toISOString().slice(0, 7);
    let gNet = 0, gVat = 0, gGross = 0;
    const out = [];
    for (const row of cr.rows) {
      const hp = await computePool(row.company_id, monthYear);
      // Csak a ténylegesen használt szolgáltatások (pool feletti + alatti egyaránt látszik)
      const services = hp.services.filter((s) => (s.total_used || 0) > 0);
      gNet += parseFloat(hp.total_net_eur); gVat += parseFloat(hp.total_vat_eur); gGross += parseFloat(hp.total_gross_eur);
      out.push({
        company_id: row.company_id, company_name: row.company_name,
        free_pool_total: hp.free_pool_total, free_pool_used: hp.free_pool_used, free_pool_remaining: hp.free_pool_remaining,
        services: services,
        subtotal_net: hp.total_net_eur, subtotal_vat: hp.total_vat_eur, subtotal_gross: hp.total_gross_eur,
      });
    }
    return res.json({ result: {
      ok: true, month: monthYear, companies: out,
      grand_total_net: gNet.toFixed(2), grand_total_vat: gVat.toFixed(2), grand_total_gross: gGross.toFixed(2),
    } });
  } catch (err) {
    console.error('getHereUsageByCompany hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
  }
};

module.exports = handlers;
