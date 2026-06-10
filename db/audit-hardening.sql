-- ============================================================
-- VallorSoft — audit-hardening migráció (idempotens)
-- A 2026-06-10-i átfogó audit DB-integritási javításai:
--   1. push_subscriptions: unique index az endpoint_hash-en
--      (a routes/push.js ON CONFLICT (endpoint_hash) erre épít)
--   2. FK ON DELETE viselkedések (ügyfél-/cégtörlés ne szálljon el)
--   3. GIN index a fuvarlevelek.order_ids-re (sofőr-kezdőképernyő)
--   4. Dupla számla elleni részleges unique index
-- ============================================================

-- 1) push_subscriptions — duplikátumok takarítása, majd unique index.
--    (Az ON CONFLICT (endpoint_hash) eddig MINDIG hibára futott, mert
--    az index nem létezett — a fallback ág dolgozott helyette.)
DELETE FROM push_subscriptions a
  USING push_subscriptions b
  WHERE a.endpoint_hash IS NOT NULL
    AND a.endpoint_hash = b.endpoint_hash
    AND a.id < b.id;
CREATE UNIQUE INDEX IF NOT EXISTS uq_push_subs_endpoint
  ON push_subscriptions(endpoint_hash);

-- 2) FK ON DELETE viselkedések
-- orders.client_id: az ügyfél törlése ne blokkolódjon — a fuvar maradjon, hivatkozás nélkül.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_client_id_fkey;
ALTER TABLE orders ADD CONSTRAINT orders_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL;

-- billing_integrations.company_id: cégtörléskor a számlázó-beállítás is törlődjön.
ALTER TABLE billing_integrations DROP CONSTRAINT IF EXISTS billing_integrations_company_id_fkey;
ALTER TABLE billing_integrations ADD CONSTRAINT billing_integrations_company_id_fkey
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

-- companies.subscription_plan_id: csomag törlésekor a cég maradjon, hivatkozás nélkül.
ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_subscription_plan_id_fkey;
ALTER TABLE companies ADD CONSTRAINT companies_subscription_plan_id_fkey
  FOREIGN KEY (subscription_plan_id) REFERENCES subscription_plans(id) ON DELETE SET NULL;

-- 3) GIN index a menetlevél↔fuvar kapcsolat kereséséhez
--    (getMySoferOrders: f.order_ids ? o.id — minden sofőr-belépésnél fut)
CREATE INDEX IF NOT EXISTS idx_fuvarlevelek_order_ids
  ON fuvarlevelek USING gin (order_ids);

-- 4) Dupla számla elleni védelem: fuvaronként legfeljebb egy 'issued'
--    és egy 'storno' számla. (A services/invoicing.js tranzakciós sor-zárja
--    mellett ez a végső adatbázis-szintű biztosíték.)
DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_company_order_status
    ON invoices(company_id, order_id, status)
    WHERE status IN ('issued', 'storno');
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'uq_invoices_company_order_status: meglévő duplikátumok miatt nem hozható létre — kézi takarítás szükséges.';
END $$;
