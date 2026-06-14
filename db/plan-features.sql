-- db/plan-features.sql
-- Csomag-szintű feature-kapcsolók: melyik funkció van benne egy csomagban.
-- Hierarchia: company_features (override) > plan_features (default) > true (ha egyik sem tiltja).
-- Idempotens.

CREATE TABLE IF NOT EXISTS plan_features (
  plan_id     INTEGER NOT NULL REFERENCES subscription_plans(id) ON DELETE CASCADE,
  feature_key VARCHAR(80) NOT NULL,
  enabled     BOOLEAN NOT NULL DEFAULT false,
  updated_at  TIMESTAMP DEFAULT now(),
  PRIMARY KEY (plan_id, feature_key)
);

-- Sofőr-szám külön limit (pl. Alap=2 sofőr, Normál=5, Prémium=NULL=korlátlan)
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS max_sofors INTEGER;
