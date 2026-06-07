-- db/here-usage.sql
-- HERE térkép-szolgáltatás használat-mérés + árazás. Idempotens.
-- 4 alap szolgáltatás, közös 1000-es ingyenes pool/hó (a poolt az app számolja),
-- EUR árazás / 1000 tranzakció. Futtatás: psql "$DATABASE_URL" -f db/here-usage.sql

CREATE TABLE IF NOT EXISTS here_feature_flags (
  id              SERIAL PRIMARY KEY,
  feature_key     TEXT UNIQUE NOT NULL,
  display_name    TEXT,
  description     TEXT,
  enabled         BOOLEAN DEFAULT true,
  free_limit      INTEGER DEFAULT 0,          -- (a közös pool app-szinten 1000; ez nem használt)
  price_per_1000  NUMERIC(10,2) DEFAULT 0,    -- EUR / 1000 tranzakció
  markup_per_1000 NUMERIC(10,2) DEFAULT 0,
  vat_percent     NUMERIC(5,2)  DEFAULT 21.00,
  updated_at      TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE here_feature_flags ADD COLUMN IF NOT EXISTS markup_per_1000 NUMERIC(10,2) DEFAULT 0;
ALTER TABLE here_feature_flags ADD COLUMN IF NOT EXISTS vat_percent     NUMERIC(5,2)  DEFAULT 21.00;

CREATE TABLE IF NOT EXISTS here_usage_log (
  id                SERIAL PRIMARY KEY,
  feature_key       TEXT NOT NULL,
  transaction_count INTEGER NOT NULL DEFAULT 1,
  month_year        TEXT NOT NULL,             -- 'YYYY-MM'
  company_id        INTEGER,
  user_id           INTEGER,
  logged_at         TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE here_usage_log ADD COLUMN IF NOT EXISTS company_id INTEGER;
ALTER TABLE here_usage_log ADD COLUMN IF NOT EXISTS user_id    INTEGER;
CREATE INDEX IF NOT EXISTS idx_here_usage_company_month ON here_usage_log (company_id, month_year);
CREATE INDEX IF NOT EXISTS idx_here_usage_logged ON here_usage_log (logged_at);

-- A 4 alap szolgáltatás. A régi (prémium) kulcsokat eltávolítjuk.
DELETE FROM here_feature_flags WHERE feature_key NOT IN ('autocomplete','geocode','raster_tile','routing_truck');
INSERT INTO here_feature_flags (feature_key, display_name, description, price_per_1000, vat_percent, enabled)
SELECT * FROM (VALUES
  ('autocomplete',  'Autocomplete',                'Cím kereső javaslatok gépeléskor', 3.00, 21.00, true),
  ('geocode',       'Geokódolás',                  'Cím → koordináta feloldás',        1.30, 21.00, true),
  ('raster_tile',   'Térkép csempék',              'Térkép megjelenítés (csempék)',    0.10, 21.00, true),
  ('routing_truck', 'Teherjármű útvonaltervezés',  'Truck routing számítás',           3.00, 21.00, true)
) AS v(feature_key, display_name, description, price_per_1000, vat_percent, enabled)
WHERE NOT EXISTS (SELECT 1 FROM here_feature_flags f WHERE f.feature_key = v.feature_key);
