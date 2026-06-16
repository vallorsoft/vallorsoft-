-- ============================================================
--  VallorSoft — e-CMR (digitális CMR fuvarlevél többfeles aláírással)
--  Inkrementális migráció (idempotens) — automatikusan lefut induláskor.
--
--  Egy e-CMR egy fuvarhoz (order) tartozik, és legfeljebb 3 fél írja alá:
--  feladó (sender), fuvarozó (carrier), címzett (consignee).
--
--  GDPR / megőrzés: az aláírások (név + IP + időbélyeg) jogi
--  fuvar-dokumentum személyes adatai — a CMR/számla mintájára a
--  számviteli/fuvarozási jog szerint őrizendők (Legea 82/1991 → 5 év).
--  A `*_ip` és `*_signed_at` a jogi bizonyíték része. A céges
--  developer-export tartalmazza (routes/developer-export.js).
-- ============================================================

CREATE TABLE IF NOT EXISTS order_ecmr (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  order_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',     -- draft | partial | completed | cancelled
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT,                          -- a létrehozó email/neve

  -- Feladó (sender) aláírás
  sender_name TEXT,
  sender_signed_at TIMESTAMPTZ,
  sender_ip TEXT,
  sender_sig TEXT,                          -- opcionális rajzolt aláírás (data URL)

  -- Fuvarozó (carrier) aláírás
  carrier_name TEXT,
  carrier_signed_at TIMESTAMPTZ,
  carrier_ip TEXT,
  carrier_sig TEXT,

  -- Címzett (consignee) aláírás
  consignee_name TEXT,
  consignee_signed_at TIMESTAMPTZ,
  consignee_ip TEXT,
  consignee_sig TEXT
);

-- Idempotens védőhálók (ha a tábla már létezett egy korábbi verzióval)
ALTER TABLE order_ecmr ADD COLUMN IF NOT EXISTS company_id INTEGER;
ALTER TABLE order_ecmr ADD COLUMN IF NOT EXISTS order_id INTEGER;
ALTER TABLE order_ecmr ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft';
ALTER TABLE order_ecmr ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE order_ecmr ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE order_ecmr ADD COLUMN IF NOT EXISTS sender_name TEXT;
ALTER TABLE order_ecmr ADD COLUMN IF NOT EXISTS sender_signed_at TIMESTAMPTZ;
ALTER TABLE order_ecmr ADD COLUMN IF NOT EXISTS sender_ip TEXT;
ALTER TABLE order_ecmr ADD COLUMN IF NOT EXISTS sender_sig TEXT;
ALTER TABLE order_ecmr ADD COLUMN IF NOT EXISTS carrier_name TEXT;
ALTER TABLE order_ecmr ADD COLUMN IF NOT EXISTS carrier_signed_at TIMESTAMPTZ;
ALTER TABLE order_ecmr ADD COLUMN IF NOT EXISTS carrier_ip TEXT;
ALTER TABLE order_ecmr ADD COLUMN IF NOT EXISTS carrier_sig TEXT;
ALTER TABLE order_ecmr ADD COLUMN IF NOT EXISTS consignee_name TEXT;
ALTER TABLE order_ecmr ADD COLUMN IF NOT EXISTS consignee_signed_at TIMESTAMPTZ;
ALTER TABLE order_ecmr ADD COLUMN IF NOT EXISTS consignee_ip TEXT;
ALTER TABLE order_ecmr ADD COLUMN IF NOT EXISTS consignee_sig TEXT;

CREATE INDEX IF NOT EXISTS idx_order_ecmr_company_order ON order_ecmr (company_id, order_id);
