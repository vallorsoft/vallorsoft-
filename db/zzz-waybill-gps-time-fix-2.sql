-- Menetlevél-idő GPS-ellenőrzés: menetlevelenként PONTOSAN 2 ellenőrzés
-- (beküldéskor + 24 órával később), mindegyik 3 fordulós (3-ból 2 egyezés).
-- A számláló 0-ról indul, így a már egyszer (régi szabállyal) nézett
-- menetlevelek is megkapják a két új ellenőrzést.
ALTER TABLE fuvarlevelek ADD COLUMN IF NOT EXISTS time_check_count INTEGER NOT NULL DEFAULT 0;
DROP INDEX IF EXISTS idx_fuvarlevelek_time_check_pending;
CREATE INDEX IF NOT EXISTS idx_fuvarlevelek_time_check_due
  ON fuvarlevelek (time_check_count, time_check_at) WHERE time_check_count < 2;
