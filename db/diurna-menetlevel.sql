-- Menetlevél-alapú diurna: indulás/érkezés datetime + kézi határátlépések
ALTER TABLE fuvarlevelek
  ADD COLUMN IF NOT EXISTS indulas_dt TIMESTAMP,
  ADD COLUMN IF NOT EXISTS erkezes_dt TIMESTAMP,
  ADD COLUMN IF NOT EXISTS hataratok JSONB DEFAULT '[]'::jsonb;
