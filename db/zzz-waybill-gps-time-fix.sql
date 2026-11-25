-- Menetlevél-pontok idejének GPS-ellenőrzése (lib/waybillTimeFix.js).
-- A sofőr által rosszul beírt fel-/lerakási időt a rendszer átírja, ha a
-- GPS-ből legalább 85%-os megbízhatósággal tudja a valós időt.
-- A sofőr eredeti értéke a pontban marad (time_driver / data_driver).
ALTER TABLE fuvarlevelek ADD COLUMN IF NOT EXISTS time_check_at TIMESTAMPTZ;
ALTER TABLE fuvarlevelek ADD COLUMN IF NOT EXISTS time_check    JSONB;
CREATE INDEX IF NOT EXISTS idx_fuvarlevelek_time_check_pending
  ON fuvarlevelek (id) WHERE time_check_at IS NULL;
