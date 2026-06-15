-- Jogi oldal visszaigazolások naplója (minden felhasználó-típusra)
-- Idempotens.
CREATE TABLE IF NOT EXISTS legal_consents (
  id              SERIAL PRIMARY KEY,
  user_type       VARCHAR(20) NOT NULL,  -- 'user' | 'client_user' | 'carrier_user'
  user_id         INTEGER NOT NULL,
  page_key        VARCHAR(40) NOT NULL,
  version         TIMESTAMPTZ NOT NULL,
  acknowledged_at TIMESTAMPTZ DEFAULT now(),
  ip              VARCHAR(45)
);
CREATE UNIQUE INDEX IF NOT EXISTS legal_consents_unique
  ON legal_consents(user_type, user_id, page_key, version);
