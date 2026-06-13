-- db/stripe.sql
-- Stripe önkiszolgáló előfizetés (VÁZ). A csomaghoz Stripe ár-azonosító
-- (price_xxx), a céghez Stripe ügyfél-/előfizetés-azonosító. A funkció
-- alapból KI — csak STRIPE_SECRET_KEY (+ webhookhoz STRIPE_WEBHOOK_SECRET)
-- esetén él. Idempotens. Futtatás: psql "$DATABASE_URL" -f db/stripe.sql

ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS stripe_price_id TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
