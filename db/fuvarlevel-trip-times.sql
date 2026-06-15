-- Menetlevél indulás/érkezés időpontok és határátlépések tárolása
ALTER TABLE fuvarlevelek
  ADD COLUMN IF NOT EXISTS indulas_dt TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS erkezes_dt TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS hataratok JSONB DEFAULT '[]'::jsonb;
