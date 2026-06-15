-- Developer email sablonok + általános developer beállítások tárolása (kulcs-érték, JSONB)
-- Idempotens.
CREATE TABLE IF NOT EXISTS developer_settings (
  key        VARCHAR(80) PRIMARY KEY,
  value      JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMP DEFAULT now()
);
