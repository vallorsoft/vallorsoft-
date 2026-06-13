// ============================================================
//  Stripe váz — gating kulcs nélkül (no-op / not-configured)
// ============================================================
const request = require('supertest');
const express = require('express');
const stripeLib = require('../../lib/stripe');
const h = require('../../handlers/stripe');

function makeRes() { const res = { body: null }; res.json = (o) => { res.body = o; return res; }; res.status = () => res; return res; }

describe('Stripe váz (kulcs nélkül)', () => {
  test('isConfigured false STRIPE_SECRET_KEY nélkül', () => {
    const old = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    expect(stripeLib.isConfigured()).toBe(false);
    if (old !== undefined) process.env.STRIPE_SECRET_KEY = old;
  });

  test('createSubscriptionCheckout kulcs nélkül → reason:not-configured', async () => {
    const old = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    const res = makeRes();
    await h.createSubscriptionCheckout({ session: { user: { pozicio: 'Admin', company_id: 1, email: 'a@x.hu' } } }, res, [{ plan_id: 1 }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.reason).toBe('not-configured');
    if (old !== undefined) process.env.STRIPE_SECRET_KEY = old;
  });

  test('createSubscriptionCheckout nem-admin → tiltva', async () => {
    const res = makeRes();
    await h.createSubscriptionCheckout({ session: { user: { pozicio: 'Manager', company_id: 1 } } }, res, [{ plan_id: 1 }]);
    expect(res.body.result.ok).toBe(false);
  });

  test('webhook konfiguráció nélkül → 503 not-configured', async () => {
    const oldS = process.env.STRIPE_SECRET_KEY, oldW = process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const app = express();
    app.use(require('../../routes/stripe-webhook'));
    const r = await request(app).post('/api/stripe/webhook').send({ a: 1 });
    expect(r.status).toBe(503);
    if (oldS !== undefined) process.env.STRIPE_SECRET_KEY = oldS;
    if (oldW !== undefined) process.env.STRIPE_WEBHOOK_SECRET = oldW;
  });
});
