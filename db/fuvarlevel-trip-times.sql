-- Menetlevél indulás/érkezés időpont + határátlépések (sofőr által megadott)
ALTER TABLE fuvarlevelek ADD COLUMN IF NOT EXISTS indulas_dt TIMESTAMPTZ;
ALTER TABLE fuvarlevelek ADD COLUMN IF NOT EXISTS erkezes_dt TIMESTAMPTZ;
ALTER TABLE fuvarlevelek ADD COLUMN IF NOT EXISTS hataratok JSONB;
