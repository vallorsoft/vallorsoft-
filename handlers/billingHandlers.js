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
const stripe = require('../lib/stripe');
const { featureEnabled } = require('../lib/featureEnabled');
const audit = require('../lib/audit');
const { makeReactivateToken } = require('../lib/trialToken');

const handlers = {};

function isDev(u) { return !!(u && (u.is_dev || u.pozicio === 'Developer')); }
function isAdminOrDev(u) { return !!(u && (u.pozicio === 'Admin' || u.is_dev || u.pozicio === 'Developer')); }

// Üresen hagyott mezők (pl. a jelszó, amit újramentéskor nem írnak be újra)
// megtartják a korábban tárolt értéküket — különben pl. a számlasorozat
// átírása kitörölné az API-kulcsot.
function mergeWithStored(stored, incoming) {
  const merged = { ...(stored || {}) };
  for (const [k, v] of Object.entries(incoming || {})) {
    if (v !== '' && v != null) merged[k] = v;
  }
  return merged;
}

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
    if (!req.session.user) return res.json({ result: { ok: false, err: 'Nu sunteti autentificat' } });
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
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// ─── Integráció mentése (titkosítva) — Admin vagy developer ──
handlers.saveBillingIntegration = async function (req, res, args) {
  try {
    if (!isAdminOrDev(req.session.user)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = req.session.user.company_id;
    if (!isDev(req.session.user) && !(await featureEnabled(cid, 'szamlazas-integracio')))
      return res.json({ result: { ok: false, err: 'Functie nedisponibila in pachetul curent.' } });
    const a = Array.isArray(args) ? (args[0] || {}) : (args || {});
    const provider = String(a.provider || '').trim();
    const credentials = (a.credentials && typeof a.credentials === 'object') ? a.credentials : {};
    if (!billing.isValidProvider(provider)) return res.json({ result: { ok: false, err: 'Furnizor de facturare necunoscut.' } });

    const display_name = billing.displayName(provider);
    // Üres mezők nem törlik a tárolt értéket (jelszó-megőrzés újramentéskor).
    const prev = await pool.query('SELECT credentials FROM billing_integrations WHERE company_id = $1 AND provider = $2', [cid, provider]);
    const stored = prev.rows.length ? decodeStoredCreds(prev.rows[0].credentials) : {};
    const encrypted = encrypt(JSON.stringify(mergeWithStored(stored, credentials)));
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
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// ─── Kapcsolat tesztelése — Admin vagy developer ───────────
// args: { provider, credentials? }  (ha credentials adott, azt teszteli; különben a tároltat)
handlers.testBillingIntegration = async function (req, res, args) {
  try {
    if (!isAdminOrDev(req.session.user)) return res.json({ result: { ok: false, message: 'Acces interzis' } });
    if (!isDev(req.session.user) && !(await featureEnabled(req.session.user.company_id, 'szamlazas-integracio')))
      return res.json({ result: { ok: false, message: 'Functie nedisponibila in pachetul curent.' } });
    const a = Array.isArray(args) ? (args[0] || {}) : (args || {});
    const provider = String(a.provider || '').trim();
    if (!billing.isValidProvider(provider)) return res.json({ result: { ok: false, message: 'Furnizor de facturare necunoscut.' } });

    let creds = (a.credentials && typeof a.credentials === 'object') ? a.credentials : null;
    const r = await pool.query('SELECT credentials FROM billing_integrations WHERE company_id = $1 AND provider = $2', [req.session.user.company_id, provider]);
    const stored = r.rows.length ? decodeStoredCreds(r.rows[0].credentials) : null;
    if (!creds && !stored) return res.json({ result: { ok: false, message: 'Nu exista integrare salvata pentru acest furnizor de facturare.' } });
    // Részben kitöltött űrlap tesztelésénél az üres mezők a tároltból jönnek.
    creds = creds ? mergeWithStored(stored || {}, creds) : stored;
    const adapter = billing.getAdapter(provider, creds);
    const result = await adapter.testConnection();
    return res.json({ result: { ok: !!result.ok, message: result.message || (result.ok ? 'Kapcsolat sikeres.' : 'Sikertelen.') } });
  } catch (err) {
    console.error('testBillingIntegration hiba:', err);
    return res.json({ result: { ok: false, message: 'Eroare de server: ' + err.message } });
  }
};

// ─── Előfizetési csomagok ──────────────────────────────────
handlers.getSubscriptionPlans = async function (req, res, args) {
  try {
    if (!req.session.user) return res.json({ result: { ok: false, err: 'Nu sunteti autentificat' } });
    const r = await pool.query(
      'SELECT id, name, description, price_net, vat_percent, is_active, sort_order, max_users, max_vehicles, max_orders_per_month, max_sofors, stripe_price_id, features FROM subscription_plans ORDER BY sort_order'
    );
    return res.json({ result: { ok: true, plans: r.rows } });
  } catch (err) {
    console.error('getSubscriptionPlans hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

handlers.updateSubscriptionPlan = async function (req, res, args) {
  try {
    if (!isDev(req.session.user)) return res.json({ result: { ok: false, err: 'Doar developer' } });
    const a = Array.isArray(args) ? (args[0] || {}) : (args || {});
    const id = parseInt(a.id, 10);
    if (!id) return res.json({ result: { ok: false, err: 'ID-ul pachetului lipseste' } });
    const price = parseFloat(a.price_net);
    // 0 = TILTOTT (nincs engedély); NULL = korlátlan; negatív/üres = NULL (korlátlan)
    const lim = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : null; };
    const stripePrice = a.stripe_price_id != null ? (String(a.stripe_price_id).trim() || null) : null;
    // Marketing bullet-pointok: tömb vagy stringből soronként parsolt tömb → JSONB
    let featuresJson = '[]';
    if (Array.isArray(a.features)) {
      // Bilingual {ro,hu} objektumokat megtartjuk; string-eket trim+filter
      featuresJson = JSON.stringify(a.features.filter((s) => s && (typeof s === 'object' || String(s).trim())));
    } else if (typeof a.features === 'string') {
      featuresJson = JSON.stringify(a.features.split('\n').map((s) => s.trim()).filter(Boolean));
    }
    await pool.query(
      `UPDATE subscription_plans SET name=$1, description=$2, price_net=$3, is_active=$4,
              max_users=$5, max_vehicles=$6, max_orders_per_month=$7, stripe_price_id=$8,
              max_sofors=$9, features=$10, updated_at=now()
        WHERE id=$11`,
      [String(a.name || '').trim() || 'Csomag', a.description || null, Number.isFinite(price) ? price : 0, a.is_active !== false,
       lim(a.max_users), lim(a.max_vehicles), lim(a.max_orders_per_month), stripePrice,
       lim(a.max_sofors), featuresJson, id]
    );
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('updateSubscriptionPlan hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

handlers.setCompanyPlan = async function (req, res, args) {
  try {
    if (!isDev(req.session.user)) return res.json({ result: { ok: false, err: 'Doar developer' } });
    const a = Array.isArray(args) ? (args[0] || {}) : (args || {});
    const companyId = parseInt(a.company_id, 10);
    const planId = a.plan_id ? parseInt(a.plan_id, 10) : null;
    if (!companyId) return res.json({ result: { ok: false, err: 'ID-ul firmei lipseste' } });
    await pool.query('UPDATE companies SET subscription_plan_id = $1 WHERE id = $2', [planId, companyId]);
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('setCompanyPlan hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// ─── Developer: cégek + számlázójuk + csomagjuk (áttekintő tábla) ──
handlers.getCompaniesBillingOverview = async function (req, res, args) {
  try {
    if (!isDev(req.session.user)) return res.json({ result: { ok: false, err: 'Doar developer' } });
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
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
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
  if (!cR.rows.length) { const e = new Error('Firma nu a fost gasita.'); e._user = true; throw e; }
  const company = cR.rows[0];

  const pR = await pool.query(
    `SELECT sp.name, sp.description, sp.price_net, sp.vat_percent
     FROM subscription_plans sp JOIN companies c ON c.subscription_plan_id = sp.id WHERE c.id = $1`, [companyId]);
  const plan = pR.rows[0] || null;

  // FONTOS: a célcég számlázó-kulcsát NEM olvassuk be — a szolgáltatási számlát
  // a VallorSoft (developer) SAJÁT számlázója állítja ki (lásd generateHereInvoice).

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
    company, plan, items, totals,
    month, month_label: label,
    issue_date: addDaysISO(0), due_date: addDaysISO(30),
    notes: 'VallorSoft HERE API szolgáltatás — ' + label + '. Automatikusan generált számla.',
    has_plan: !!plan, has_here: billableServices.length > 0,
  };
}

// Előnézet — NEM állít ki számlát.
handlers.previewHereInvoice = async function (req, res, args) {
  try {
    if (!isDev(req.session.user)) return res.json({ result: { ok: false, err: 'Doar developer' } });
    const a = Array.isArray(args) ? (args[0] || {}) : (args || {});
    const companyId = parseInt(a.company_id, 10);
    if (!companyId) return res.json({ result: { ok: false, err: 'ID-ul firmei lipseste' } });
    const d = await buildHereInvoice(companyId, a.month_year);
    // A kiállító a VallorSoft (developer) SAJÁT számlázója — NEM a célcégé.
    const vR = await pool.query(
      `SELECT provider, display_name FROM billing_integrations WHERE company_id = $1 AND is_active = true LIMIT 1`,
      [req.session.user.company_id]);
    const issuer = vR.rows[0] || null;
    return res.json({ result: {
      ok: true,
      company_name: d.company.name,
      provider: issuer ? issuer.provider : null,
      provider_name: issuer ? issuer.display_name : null,
      items: d.items, totals: d.totals,
      month_label: d.month_label, due_date: d.due_date,
      has_plan: d.has_plan, has_here: d.has_here,
    } });
  } catch (err) {
    console.error('previewHereInvoice hiba:', err);
    return res.json({ result: { ok: false, err: err._user ? err.message : 'Eroare de server' } });
  }
};

// Számla kiállítása a cég aktív számlázóján keresztül.
handlers.generateHereInvoice = async function (req, res, args) {
  try {
    if (!isDev(req.session.user)) return res.json({ result: { ok: false, err: 'Doar developer' } });
    const a = Array.isArray(args) ? (args[0] || {}) : (args || {});
    const companyId = parseInt(a.company_id, 10);
    if (!companyId) return res.json({ result: { ok: false, err: 'ID-ul firmei lipseste' } });
    // Eladó = vevő TILOS: a developer nem állíthat ki számlát a saját cégének.
    if (companyId === req.session.user.company_id)
      return res.json({ result: { ok: false, err: 'Emitentul nu poate fi si client — nu se poate emite factura catre propria firma.' } });

    const d = await buildHereInvoice(companyId, a.month_year);
    if (!d.items.length) return res.json({ result: { ok: false, err: 'Nu exista pozitii facturabile (niciun pachet si niciun consum HERE).' } });

    // A számlát a VallorSoft (developer) SAJÁT számlázó-integrációja állítja ki —
    // SOHA nem a célcég kulcsával (egyetlen más cég kulcsához sem nyúlunk).
    const vR = await pool.query(
      `SELECT provider, credentials FROM billing_integrations WHERE company_id = $1 AND is_active = true LIMIT 1`,
      [req.session.user.company_id]);
    if (!vR.rows.length) return res.json({ result: { ok: false, err: 'Configurati mai intai integrarea de facturare VallorSoft (Developer → Integratii).' } });
    const issuer = vR.rows[0];

    let creds = {};
    try { creds = JSON.parse(decrypt(issuer.credentials.enc)); } catch (e) { return res.json({ result: { ok: false, err: 'Datele de facturare VallorSoft nu pot fi citite.' } }); }

    const adapter = billing.loadAdapter(issuer.provider, creds);
    const result = await adapter.createInvoice({
      client: { name: d.company.name, email: d.company.admin_email },
      items: d.items.map((it) => ({ name: it.name, quantity: it.quantity, unit: it.unit, price_net: it.price_net, vat_percent: it.vat_percent, description: it.description || undefined })),
      currency: 'EUR', issue_date: d.issue_date, due_date: d.due_date, notes: d.notes,
    });
    if (!result.ok) return res.json({ result: { ok: false, err: issuer.provider + ': ' + (result.message || 'eroare necunoscuta') } });
    return res.json({ result: { ok: true, invoice_number: result.invoice_number, pdf_url: result.pdf_url || null, provider: issuer.provider } });
  } catch (err) {
    console.error('generateHereInvoice hiba:', err);
    return res.json({ result: { ok: false, err: err._user ? err.message : ('Eroare de server: ' + err.message) } });
  }
};

// ─── Cégenkénti HERE használat — közös 1000-es pool, felhasználó-szintű bontással (developer) ──
handlers.getHereUsageByCompany = async function (req, res, args) {
  try {
    if (!isDev(req.session.user)) return res.json({ result: { ok: false, err: 'Doar developer' } });
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
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// ─── Csomag-szintű funkció-kapcsolók (plan_features) — developer ──
handlers.getPlanFeatures = async function (req, res, args) {
  try {
    if (!isDev(req.session.user)) return res.json({ result: { ok: false, err: 'Doar developer' } });
    const a = Array.isArray(args) ? (args[0] || {}) : (args || {});
    const planId = parseInt(a.plan_id, 10);
    if (!planId) return res.json({ result: { ok: false, err: 'ID-ul pachetului lipseste' } });
    const r = await pool.query('SELECT feature_key, enabled FROM plan_features WHERE plan_id = $1', [planId]);
    const features = {};
    r.rows.forEach((row) => { features[row.feature_key] = row.enabled; });
    return res.json({ result: { ok: true, features } });
  } catch (err) {
    console.error('getPlanFeatures hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

handlers.setPlanFeature = async function (req, res, args) {
  try {
    if (!isDev(req.session.user)) return res.json({ result: { ok: false, err: 'Doar developer' } });
    const a = Array.isArray(args) ? (args[0] || {}) : (args || {});
    const planId = parseInt(a.plan_id, 10);
    const key = String(a.feature_key || '').trim();
    if (!planId || !key) return res.json({ result: { ok: false, err: 'Parametri lipsa' } });
    if (a.enabled === null || a.enabled === undefined) {
      // törlés: vissza az alapértelmezett (true) állapotba
      await pool.query('DELETE FROM plan_features WHERE plan_id = $1 AND feature_key = $2', [planId, key]);
    } else {
      const enabled = a.enabled !== false && a.enabled !== 0;
      await pool.query(
        `INSERT INTO plan_features (plan_id, feature_key, enabled, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (plan_id, feature_key) DO UPDATE SET enabled = $3, updated_at = now()`,
        [planId, key, enabled]
      );
    }
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('setPlanFeature hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// ── getMySubscription — saját cég előfizetési státusza (Admin) ──
handlers.getMySubscription = async function(req, res) {
  if (!req.session || !req.session.user || req.session.user.pozicio !== 'Admin')
    return res.json({ result: { ok: false, err: 'Acces interzis' } });
  const cid = req.session.user.company_id;
  try {
    const r = await pool.query(
      `SELECT c.subscription_status, c.paid_until, c.subscription_plan_id, c.subscription_cancel_at,
              sp.name AS plan_name, sp.price_net, sp.stripe_price_id
       FROM companies c
       LEFT JOIN subscription_plans sp ON sp.id = c.subscription_plan_id
       WHERE c.id = $1`,
      [cid]
    );
    if (!r.rows.length) return res.json({ result: { ok: false } });
    const row = r.rows[0];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const paidUntil = row.paid_until ? new Date(row.paid_until) : null;
    const daysLeft = paidUntil ? Math.ceil((paidUntil - today) / 86400000) : null;
    // Lemondás akkor mondható le, ha aktív/trial és van hátralévő (fizetett) idő.
    const canCancel = (row.subscription_status === 'active' || row.subscription_status === 'trial')
      && !row.subscription_cancel_at && daysLeft != null && daysLeft > 0;
    return res.json({ result: {
      ok: true,
      status:            row.subscription_status,
      paid_until:        row.paid_until,
      days_left:         daysLeft,
      plan_name:         row.plan_name || null,
      plan_id:           row.subscription_plan_id,
      cancel_pending:    !!row.subscription_cancel_at,
      cancel_at:         row.subscription_cancel_at,
      can_cancel:        canCancel,
      stripe_configured: stripe.isConfigured(),
    }});
  } catch (err) {
    console.error('getMySubscription hiba:', err.message);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// ── Előfizetés lemondása (dezabonare) — türelmi idővel ───────────────────
// A státusz NEM lesz azonnal 'cancelled' (azt a login-kapu tiltaná); csak a
// subscription_cancel_at jelzőt tesszük be. A hozzáférés a paid_until-ig
// megmarad. Értesítő e-mail megy "M-am răzgândit" gombbal.
handlers.cancelSubscription = async function (req, res) {
  const u = req.session && req.session.user;
  if (!u || u.pozicio !== 'Admin') return res.json({ result: { ok: false, err: 'Acces interzis' } });
  const cid = u.company_id;
  try {
    const r = await pool.query(
      `SELECT nev, email_contact, subscription_status, paid_until, subscription_cancel_at
         FROM companies WHERE id=$1`, [cid]);
    if (!r.rows.length) return res.json({ result: { ok: false, err: 'Companie negăsită' } });
    const c = r.rows[0];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const paidUntil = c.paid_until ? new Date(c.paid_until) : null;
    const daysLeft = paidUntil ? Math.ceil((paidUntil - today) / 86400000) : null;

    if (c.subscription_cancel_at) {
      return res.json({ result: { ok: true, already: true, days_left: daysLeft, paid_until: c.paid_until } });
    }
    if (!(c.subscription_status === 'active' || c.subscription_status === 'trial') || !paidUntil || daysLeft == null || daysLeft <= 0) {
      return res.json({ result: { ok: false, err: 'Nu există un abonament activ de anulat.' } });
    }

    const upd = await pool.query(
      `UPDATE companies SET subscription_cancel_at=NOW(), cancel_lastday_notified=false
        WHERE id=$1 RETURNING subscription_cancel_at`, [cid]);
    const cancelAt = upd.rows[0].subscription_cancel_at;

    // Újraaktiváló link (M-am răzgândit) — a lemondás időpontjához kötött token.
    let reactivateUrl = null;
    try {
      const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
      const sec = Math.floor(new Date(cancelAt).getTime() / 1000);
      const tok = makeReactivateToken(cid, sec);
      if (appUrl) reactivateUrl = `${appUrl}/abonament/reactivare?cid=${cid}&tok=${tok}`;
    } catch (_) {}

    // Értesítő e-mail (RO) — best-effort, nem buktatja a lemondást.
    try {
      const { sendSubscriptionCancelEmail } = require('../services/email');
      if (c.email_contact) {
        await sendSubscriptionCancelEmail({
          to: c.email_contact, companyName: c.nev, paidUntil: c.paid_until,
          daysLeft: daysLeft, reactivateUrl: reactivateUrl, lastDay: false, companyId: cid,
        });
      }
    } catch (_) {}

    audit.fromReq(req, 'subscription.cancel', 'company', String(cid), { paid_until: c.paid_until });
    return res.json({ result: { ok: true, days_left: daysLeft, paid_until: c.paid_until } });
  } catch (err) {
    console.error('cancelSubscription hiba:', err.message);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// ── Lemondás visszavonása ("M-am răzgândit") — a konzolból ───────────────
handlers.reactivateSubscription = async function (req, res) {
  const u = req.session && req.session.user;
  if (!u || u.pozicio !== 'Admin') return res.json({ result: { ok: false, err: 'Acces interzis' } });
  const cid = u.company_id;
  try {
    await pool.query(
      `UPDATE companies SET subscription_cancel_at=NULL, cancel_lastday_notified=false WHERE id=$1`, [cid]);
    audit.fromReq(req, 'subscription.reactivate', 'company', String(cid), {});
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('reactivateSubscription hiba:', err.message);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// ── Admin oldali előfizetés-hosszabbítás ─────────────────────────────────

async function generatePaymentRef(companyId) {
  const ym = new Date().toISOString().slice(0, 7).replace('-', '');
  const base = `VS-${ym}-${String(companyId).padStart(4, '0')}`;
  const existing = await pool.query(
    'SELECT reference FROM payment_requests WHERE reference LIKE $1 ORDER BY created_at DESC LIMIT 5',
    [base + '%']
  );
  if (!existing.rows.length) return base;
  const last = existing.rows[0].reference;
  const m = last.match(/-(\d+)$/);
  return `${base}-${m ? parseInt(m[1]) + 1 : 2}`;
}

// Admin látja a saját cégének fizetési kérelmeit
handlers.getMyPaymentRequests = async function (req, res) {
  if (!req.session.user) return res.json({ result: { ok: false, err: 'Acces interzis' } });
  const cid = req.session.user.company_id;
  try {
    const r = await pool.query(
      `SELECT pr.*, sp.name AS plan_name
       FROM payment_requests pr
       LEFT JOIN subscription_plans sp ON sp.id = pr.plan_id
       WHERE pr.company_id = $1
       ORDER BY pr.created_at DESC LIMIT 50`,
      [cid]
    );
    return res.json({ result: { ok: true, requests: r.rows } });
  } catch (err) {
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// Admin küld előfizetés-kérelmet → fizetési email + developer értesítő
handlers.requestSubscriptionExtension = async function (req, res, args) {
  const u = req.session.user;
  if (!u || u.pozicio !== 'Admin') return res.json({ result: { ok: false, err: 'Acces interzis' } });
  const [planId, billing = 'monthly'] = args || [];
  const cid = u.company_id;
  try {
    const [compR, planR, bankR] = await Promise.all([
      pool.query('SELECT id, nev, email_contact FROM companies WHERE id=$1', [cid]),
      pool.query('SELECT id, name, price_net FROM subscription_plans WHERE id=$1', [planId]),
      pool.query("SELECT value FROM developer_settings WHERE key='bank_details'"),
    ]);
    if (!compR.rows.length || !planR.rows.length) {
      return res.json({ result: { ok: false, err: 'Companie sau pachet negăsit' } });
    }
    const company    = compR.rows[0];
    const planData   = planR.rows[0];
    const bankDetails = bankR.rows[0]?.value || null;
    const isAnnual   = billing === 'annual';
    const monthlyEur = parseFloat(planData.price_net) || 0;
    const amountEur  = isAnnual ? monthlyEur * 11 : monthlyEur;

    let bnrRate = null, amountRon = null, tvaRon = null, totalRon = null;
    try {
      const { fetchBnrEurRon } = require('../services/bnr');
      bnrRate = await fetchBnrEurRon();
      if (bnrRate) {
        amountRon = Math.round(amountEur * bnrRate * 100) / 100;
        tvaRon    = Math.round(amountRon * 0.21 * 100) / 100;
        totalRon  = Math.round((amountRon + tvaRon) * 100) / 100;
      }
    } catch (_) {}

    const reference = await generatePaymentRef(cid);

    await pool.query(
      `INSERT INTO payment_requests
         (company_id, plan_id, billing_type, reference, amount_eur, amount_ron, tva_ron, total_ron, bnr_rate, email_sent_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`,
      [cid, planId, billing, reference, amountEur, amountRon, tvaRon, totalRon, bnrRate]
    );

    const escH = (s) => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const appUrl = process.env.APP_URL || 'https://app.vallorsoft.com';
    const perioadas = isAnnual ? 'anual (11 luni facturate, 12 luni acces)' : 'lunar';

    // Email adminnak — fizetési részletek
    if (company.email_contact) {
      const { sendClientEmail } = require('../services/email');
      const bankHtml = bankDetails
        ? `<table style="width:100%;border-collapse:collapse;margin:10px 0;">
            <tr><td style="padding:4px 0;color:#475569;font-size:13px;">Titular cont</td><td style="font-weight:600;font-size:13px;">${escH(bankDetails.holder||'')}</td></tr>
            <tr><td style="padding:4px 0;color:#475569;font-size:13px;">IBAN</td><td style="font-weight:600;font-size:13px;font-family:monospace;">${escH(bankDetails.iban||'')}</td></tr>
            <tr><td style="padding:4px 0;color:#475569;font-size:13px;">Bancă</td><td style="font-weight:600;font-size:13px;">${escH(bankDetails.bank||'')}</td></tr>
            ${bankDetails.swift?`<tr><td style="padding:4px 0;color:#475569;font-size:13px;">SWIFT/BIC</td><td style="font-weight:600;font-size:13px;font-family:monospace;">${escH(bankDetails.swift)}</td></tr>`:''}</table>`
        : '<p style="color:#ef4444;font-size:13px;">Datele bancare nu sunt configurate. Contactați: vallorsoft@gmail.com</p>';
      const html = `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#0f172a;">
  <div style="background:linear-gradient(135deg,#6366f1,#3b82f6);padding:24px 28px;border-radius:12px 12px 0 0;">
    <h1 style="margin:0;color:#fff;font-size:20px;">vallor<span style="color:#c7d2fe;">Soft</span></h1>
    <p style="margin:6px 0 0;color:rgba(255,255,255,.8);font-size:13px;">Detalii plată</p>
  </div>
  <div style="background:#fff;padding:24px 28px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;">
    <p style="margin:0 0 14px;font-size:15px;">Ați solicitat abonamentul <strong>${escH(planData.name)}</strong> (${perioadas}) pentru <em>${escH(company.nev)}</em>.</p>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px 18px;margin-bottom:14px;">
      <div style="font-size:12px;color:#475569;font-weight:600;margin-bottom:8px;">REZUMAT PLATĂ</div>
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:3px 0;font-size:13px;color:#64748b;">Pachet</td><td style="text-align:right;font-size:13px;">${escH(planData.name)} (${perioadas})</td></tr>
        <tr><td style="padding:3px 0;font-size:13px;color:#64748b;">Preț net EUR</td><td style="text-align:right;font-size:13px;">€${amountEur.toFixed(2)}</td></tr>
        ${bnrRate?`<tr><td style="padding:3px 0;font-size:13px;color:#64748b;">Curs BNR</td><td style="text-align:right;font-size:13px;">${bnrRate.toFixed(4)} RON/€</td></tr>
        <tr><td style="padding:3px 0;font-size:13px;color:#64748b;">Preț net RON</td><td style="text-align:right;font-size:13px;">${amountRon.toFixed(2)} RON</td></tr>
        <tr><td style="padding:3px 0;font-size:13px;color:#64748b;">TVA 21%</td><td style="text-align:right;font-size:13px;">${tvaRon.toFixed(2)} RON</td></tr>`:''}
        <tr style="border-top:2px solid #6366f1;"><td style="padding:6px 0 3px;font-weight:700;">TOTAL</td>
          <td style="padding:6px 0 3px;font-weight:700;text-align:right;color:#6366f1;">${totalRon?totalRon.toFixed(2)+' RON':'€'+amountEur.toFixed(2)}</td></tr>
      </table>
    </div>
    <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:14px 18px;margin-bottom:14px;">
      <div style="font-size:12px;color:#166534;font-weight:700;margin-bottom:8px;">DATE CONT BANCAR</div>
      ${bankHtml}
    </div>
    <div style="background:rgba(99,102,241,.06);border:2px solid #6366f1;border-radius:8px;padding:14px;margin-bottom:14px;text-align:center;">
      <div style="font-size:11px;color:#6366f1;font-weight:700;letter-spacing:.5px;margin-bottom:4px;">REFERINȚĂ PLATĂ</div>
      <div style="font-size:24px;font-weight:800;font-family:monospace;letter-spacing:2px;">${escH(reference)}</div>
      <div style="font-size:12px;color:#475569;margin-top:4px;">Scrieți acest cod în câmpul „Observații" al ordinului de plată.</div>
    </div>
    <p style="font-size:13px;color:#475569;margin:0 0 14px;">Vă rugăm efectuați plata în termen de <strong>5 zile lucrătoare</strong>. Abonamentul va fi activat în maxim 24h de la confirmarea plății.</p>
    <a href="${appUrl}/admin" style="display:inline-block;background:linear-gradient(180deg,#3b82f6,#2563eb);color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:600;font-size:14px;">Intră în aplicație</a>
    <p style="margin:14px 0 0;font-size:12px;color:#94a3b8;">Întrebări? <a href="mailto:vallorsoft@gmail.com" style="color:#6366f1;">vallorsoft@gmail.com</a></p>
  </div>
</div>`;
      await sendClientEmail({
        to: company.email_contact,
        subject: `VallorSoft — Detalii plată: ${planData.name} · ${reference}`,
        html,
        companyId: cid, mailType: 'payment',
      }).catch(e => console.warn('[SubExt] admin email hiba:', e.message));
    }

    // Értesítő email a developernek
    try {
      const { sendDeveloperEmail } = require('../services/email');
      const devEmail = process.env.DEV_NOTIFY_EMAIL || 'vallorsoft@gmail.com';
      await sendDeveloperEmail(
        devEmail, 'VallorSoft System',
        `💸 Új fizetési kérelem: ${company.nev}`,
        `<p style="font-size:15px;margin:0 0 14px;"><strong>${escH(company.nev)}</strong> cég előfizetés-kérelmet nyújtott be.</p>
         <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:14px;">
           <tr><td style="padding:5px 0;color:#8a97a8;">Csomag</td><td style="font-weight:600;">${escH(planData.name)}</td></tr>
           <tr><td style="padding:5px 0;color:#8a97a8;">Időszak</td><td style="font-weight:600;">${isAnnual ? 'Éves (11 hó)' : 'Havi'}</td></tr>
           <tr><td style="padding:5px 0;color:#8a97a8;">Összeg</td><td style="font-weight:600;">€${amountEur.toFixed(2)}${totalRon ? ' = ' + totalRon.toFixed(2) + ' RON' : ''}</td></tr>
           <tr><td style="padding:5px 0;color:#8a97a8;">Referencia</td><td style="font-weight:700;font-family:monospace;color:#6366f1;font-size:16px;">${escH(reference)}</td></tr>
           <tr><td style="padding:5px 0;color:#8a97a8;">Dátum</td><td>${new Date().toLocaleString('ro-RO')}</td></tr>
         </table>
         <p style="font-size:13px;color:#8a97a8;margin:0;">Ellenőrizd a bankszámlán, majd <a href="${appUrl}/developer" style="color:#6366f1;">aktiváld a developer felületen</a>.</p>`,
        cid
      );
    } catch (e) { console.warn('[SubExt] developer értesítő hiba:', e.message); }

    return res.json({ result: { ok: true, reference, amountEur, amountRon, tvaRon, totalRon, bnrRate, bankDetails } });
  } catch (err) {
    console.error('[SubExt] hiba:', err.message);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

module.exports = handlers;
