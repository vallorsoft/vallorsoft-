-- db/billing-integrations.sql
-- Univerzális számlázó-integráció + előfizetési csomagok. Idempotens.
-- Futtatás: psql "$DATABASE_URL" -f db/billing-integrations.sql

CREATE TABLE IF NOT EXISTS billing_integrations (
  id           SERIAL PRIMARY KEY,
  company_id   INTEGER REFERENCES companies(id),
  provider     VARCHAR(50)  NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  credentials  JSONB        NOT NULL DEFAULT '{}',   -- { "enc": "<AES-256-GCM>" }
  is_active    BOOLEAN      DEFAULT false,
  created_at   TIMESTAMP    DEFAULT now(),
  updated_at   TIMESTAMP    DEFAULT now(),
  UNIQUE (company_id, provider)
);

CREATE TABLE IF NOT EXISTS subscription_plans (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  description TEXT,
  price_net   NUMERIC(10,2) NOT NULL DEFAULT 0,
  vat_percent NUMERIC(5,2)  NOT NULL DEFAULT 21.00,
  is_active   BOOLEAN       DEFAULT true,
  sort_order  INTEGER       DEFAULT 0,
  created_at  TIMESTAMP     DEFAULT now(),
  updated_at  TIMESTAMP     DEFAULT now()
);

ALTER TABLE companies ADD COLUMN IF NOT EXISTS subscription_plan_id INTEGER REFERENCES subscription_plans(id);

-- Alap csomagok (csak ha még üres a tábla)
INSERT INTO subscription_plans (name, description, price_net, sort_order)
SELECT * FROM (VALUES
  ('Alap',       'Alap csomag leírása',       0.00, 1),
  ('Normál',     'Normál csomag leírása',     0.00, 2),
  ('Prémium',    'Prémium csomag leírása',    0.00, 3),
  ('Enterprise', 'Enterprise csomag leírása', 0.00, 4)
) AS v(name, description, price_net, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM subscription_plans);
