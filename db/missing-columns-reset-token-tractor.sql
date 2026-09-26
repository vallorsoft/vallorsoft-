-- ============================================================
--  VallorSoft — hiányzó oszlopok pótlása (idempotens, csak ADD IF NOT EXISTS)
--
--  Ezekre a kód évek óta hivatkozik, de sem a schema.sql, sem egyetlen
--  migráció nem hozta létre őket → friss telepítésen (és minden olyan DB-n,
--  ahol kézzel sem vették fel) az alábbi funkciók „Eroare de server"-rel
--  hasaltak el:
--    * users.reset_token / reset_token_expiry → „Elfelejtett jelszó" +
--      jelszó-visszaállító link (routes/auth.js /api/forgot-password, /api/reset-password)
--    * orders.tractor_id / trailer_id → Útvonaltervező fuvar-lista
--      (handlers/routePlannerHandlers.js getOrdersForRoutePlanning)
--  Ahol az oszlop már létezik, a sor no-op.
-- ============================================================
ALTER TABLE users  ADD COLUMN IF NOT EXISTS reset_token        VARCHAR(128);
ALTER TABLE users  ADD COLUMN IF NOT EXISTS reset_token_expiry TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_users_reset_token ON users (reset_token) WHERE reset_token IS NOT NULL;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS tractor_id INTEGER;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS trailer_id INTEGER;
