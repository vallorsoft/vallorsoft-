-- Menetlevél útvonal-pontjainak GPS km-óra állása (pillanatkép).
-- A háttér-ütemező tölti ki — a régi menetleveleknél is (visszamenőleg);
-- a nyomtatvány élőben számol, és ezt csak tartaléknak használja.
ALTER TABLE fuvarlevelek ADD COLUMN IF NOT EXISTS route_odo    JSONB;
ALTER TABLE fuvarlevelek ADD COLUMN IF NOT EXISTS route_odo_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_fuvarlevelek_route_odo_pending
  ON fuvarlevelek (id) WHERE route_odo_at IS NULL;
