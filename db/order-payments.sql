-- ============================================================
--  VallorSoft — fizetés-követés + statisztika jogosultságok
--  Idempotens migráció (többször lefuttatható).
--
--  1) orders: fizetés-követés a Finalizat fuvarokhoz
--     - payment_status: 'unpaid' | 'partial' | 'paid'
--     - paid_amount:    eddig beszedett összeg (részfizetések göngyölve)
--     - paid_at:        az utolsó fizetés rögzítésének időpontja
--  2) user_permissions: admin által adható, felhasználónkénti
--     jogosultságok (perm_key='stats_finance' → Pénzügy riport láthatóság
--     Manager számára; Admin mindig lát mindent)
-- ============================================================

ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status VARCHAR(10) DEFAULT 'unpaid';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_amount    NUMERIC(12,2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_at        TIMESTAMP;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method VARCHAR(30);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_note   TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_payment ON orders(company_id, payment_status);

-- Felhasználónkénti jogosultságok (admin kapcsolja a cégén belül).
-- Hiányzó sor = NINCS engedély (szigorú alapértelmezés — a pénzügyi
-- adatok láthatóságát az adminnak explicit ki kell osztania).
CREATE TABLE IF NOT EXISTS user_permissions (
  id          SERIAL PRIMARY KEY,
  company_id  INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
  perm_key    TEXT NOT NULL,
  enabled     BOOLEAN DEFAULT FALSE,
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, perm_key)
);

CREATE INDEX IF NOT EXISTS idx_user_permissions_company ON user_permissions(company_id);
