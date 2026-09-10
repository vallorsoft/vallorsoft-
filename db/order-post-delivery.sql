-- db/order-post-delivery.sql
-- Fuvar dokumentum-nyomkövetés (post-delivery lifecycle): számlaszám, posta cím,
-- posta elküldve/átvéve, fizetési státusz külön a Finalizat után is követhető.
--
-- Az `orders.payment_status`/`paid_amount` (order-payments.sql) a MEGRENDELŐ
-- (ügyfél) fizetését jelzi belső bevitelre. Az itt bevezetett mezők a POST-
-- DELIVERY dokumentum-folyamatot követik: kiállított számla száma (nem
-- szükségszerűen a rendszeren belüli számlázás — kézi kiállításnál is), a
-- kifizetéshez tartozó cím (posta) és a levél-életciklus, illetve a fizetési
-- státusz külső forrásból (pl. FGO getInvoice lekérés) is származhat.
--
-- `payment_status_ext` fehérlista (kliens+szerver): 'pending' (alap),
--   'paid' (kifizetve — FGO OK vagy kézi), 'delayed' (túllépve a határidőt).
--
-- Auto-fut a szerver indulásakor (schema_migrations könyvelés).

ALTER TABLE orders ADD COLUMN IF NOT EXISTS invoice_no VARCHAR(50);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS postal_address TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS postal_sent_at DATE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS postal_received_at DATE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status_ext VARCHAR(20) DEFAULT 'pending';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_received_at DATE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS post_notes TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_ext_checked_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_ext_source VARCHAR(20); -- 'fgo' / 'manual' / null

CREATE INDEX IF NOT EXISTS idx_orders_invoice_no ON orders(company_id, invoice_no);
CREATE INDEX IF NOT EXISTS idx_orders_payment_ext ON orders(company_id, payment_status_ext);
