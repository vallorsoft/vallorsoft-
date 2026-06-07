-- db/feature-flags.sql
-- Cégenkénti funkció-kapcsolók (előfizetés) + felhasználó-tiltás.
-- Idempotens. Futtatás: psql "$DATABASE_URL" -f db/feature-flags.sql
--
-- Logika: ha NINCS sor egy (company_id, feature_key) párra -> a funkció BE van kapcsolva
-- (alapból minden elérhető). A developer csak a KIKAPCSOLÁST rögzíti (enabled=false),
-- vagy explicit be is kapcsolhatja (enabled=true).

CREATE TABLE IF NOT EXISTS company_features (
  company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  feature_key TEXT    NOT NULL,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at  TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (company_id, feature_key)
);
CREATE INDEX IF NOT EXISTS idx_company_features_company ON company_features (company_id);

-- Felhasználó-tiltás (a blokkolt user nem tud bejelentkezni)
ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked BOOLEAN NOT NULL DEFAULT FALSE;
