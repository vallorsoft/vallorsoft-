// ============================================================
//  VallorSoft — handlers/stripe.js
//  Önkiszolgáló előfizetés (VÁZ). RPC a /api/execute-on:
//    getStripeStatus            — Admin: konfigurált-e + cég Stripe-azonosítók
//    createSubscriptionCheckout — Admin: Stripe Checkout link a csomagra
//  Kulcs nélkül „not-configured" — a felület jelezhet.
// ============================================================
const pool = require('../db');
const stripe = require('../lib/stripe');

const handlers = {};

handlers.getStripeStatus = async function (req, res) {
  if (!req.session.user || req.session.user.pozicio !== 'Admin') {
    return res.json({ result: { ok: false, err: 'Acces interzis' } });
  }
  const cid = req.session.user.company_id;
  const r = await pool.query('SELECT stripe_customer_id, stripe_subscription_id FROM companies WHERE id = $1', [cid]).catch(() => ({ rows: [] }));
  const row = r.rows[0] || {};
  return res.json({ result: {
    ok: true,
    configured: stripe.isConfigured(),
    customer_id: row.stripe_customer_id || null,
    subscription_id: row.stripe_subscription_id || null,
  } });
};

handlers.createSubscriptionCheckout = async function (req, res, args) {
  try {
    if (!req.session.user || req.session.user.pozicio !== 'Admin') {
      return res.json({ result: { ok: false, err: 'Acces interzis' } });
    }
    if (!stripe.isConfigured()) {
      return res.json({ result: { ok: false, reason: 'not-configured' } });
    }
    const cid = req.session.user.company_id;
    const a = (args && args[0]) || {};
    const planId = parseInt(a.plan_id, 10);
    if (!planId) return res.json({ result: { ok: false, err: 'ID-ul pachetului lipsește' } });

    const pr = await pool.query('SELECT stripe_price_id FROM subscription_plans WHERE id = $1', [planId]);
    const priceId = pr.rows.length ? pr.rows[0].stripe_price_id : null;
    if (!priceId) return res.json({ result: { ok: false, err: 'Pachetul nu are un preț Stripe configurat.' } });

    const base = process.env.APP_URL || 'http://localhost:3000';
    const session = await stripe.client().checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: req.session.user.email,
      client_reference_id: String(cid),
      metadata: { company_id: String(cid), plan_id: String(planId) },
      success_url: base + '/admin?stripe=success',
      cancel_url: base + '/admin?stripe=cancel',
    });
    return res.json({ result: { ok: true, url: session.url } });
  } catch (err) {
    console.error('createSubscriptionCheckout hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

module.exports = handlers;
