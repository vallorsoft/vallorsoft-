// ============================================================
//  VallorSoft — routes/stripe-webhook.js
//  Stripe webhook (önkiszolgáló előfizetés VÁZ). A signature-ellenőrzéshez
//  RAW body kell, ezért EZT a route-ot a server.js az express.json ELŐTT
//  mountolja. Kulcs/secret nélkül 503 (not-configured).
// ============================================================
const express = require('express');
const router = express.Router();
const pool = require('../db');
const stripe = require('../lib/stripe');
const log = require('../lib/logger');

router.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe.isConfigured() || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(503).json({ ok: false, reason: 'not-configured' });
  }
  let event;
  try {
    event = stripe.client().webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    return res.status(400).json({ ok: false, err: 'invalid-signature' });
  }
  try {
    const obj = (event.data && event.data.object) || {};
    if (event.type === 'checkout.session.completed') {
      const cid = parseInt((obj.metadata && obj.metadata.company_id) || obj.client_reference_id, 10) || null;
      const planId = parseInt(obj.metadata && obj.metadata.plan_id, 10) || null;
      if (cid) {
        await pool.query(
          'UPDATE companies SET stripe_customer_id = $1, stripe_subscription_id = $2, subscription_status = $3 WHERE id = $4',
          [obj.customer || null, obj.subscription || null, 'active', cid]);
        if (planId) await pool.query('UPDATE companies SET subscription_plan_id = $1 WHERE id = $2', [planId, cid]).catch(() => {});
      }
    } else if (event.type === 'customer.subscription.deleted') {
      await pool.query("UPDATE companies SET subscription_status = 'cancelled' WHERE stripe_subscription_id = $1", [obj.id]).catch(() => {});
    }
    return res.json({ ok: true });
  } catch (e) {
    log.error('stripe-webhook hiba', { err: e.message });
    return res.status(500).json({ ok: false });
  }
});

module.exports = router;
