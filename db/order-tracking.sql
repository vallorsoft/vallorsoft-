-- ============================================================
--  VallorSoft — ügyfél tracking-link (idempotens migráció)
--  A fuvar publikus, tokenes követő-oldala: /t/<token>
--  A token kérésre generálódik (getTrackingLink), kitalálhatatlan
--  (crypto random 32 hex), és csak minimális adatot ad ki.
-- ============================================================

ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_token VARCHAR(64);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_tracking ON orders(tracking_token);
