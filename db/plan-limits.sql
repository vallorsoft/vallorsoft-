-- db/plan-limits.sql
-- Előfizetési csomag-limitek (kikényszerítés). NULL = korlátlan (alapból minden
-- meglévő csomag korlátlan → visszafelé kompatibilis). A developer állítja a
-- csomag-szerkesztőben (updateSubscriptionPlan), a szerver a create-utakon
-- ellenőrzi (lib/planLimits). Idempotens.
-- Futtatás: psql "$DATABASE_URL" -f db/plan-limits.sql

ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS max_users INTEGER;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS max_vehicles INTEGER;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS max_orders_per_month INTEGER;
