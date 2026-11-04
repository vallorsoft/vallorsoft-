-- db/gps-toll-days.sql
-- GPS-nyomvonal alapú útdíj (HERE Route Import + tolls) napi cache-e + a
-- jármű EURO emissziós osztálya (a DE/AT km-díjat erősen befolyásolja).
-- Idempotens. Auto-fut induláskor (schema_migrations).

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS emission_class VARCHAR(10);
COMMENT ON COLUMN vehicles.emission_class IS 'EURO0..EURO6 / EEV — HERE útdíj (tolls[emissionType])';

CREATE TABLE IF NOT EXISTS gps_toll_days (
  id            SERIAL PRIMARY KEY,
  company_id    INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  rendszam      VARCHAR(30) NOT NULL,
  day           DATE NOT NULL,
  params_hash   VARCHAR(64) NOT NULL,          -- a felhasznált kamion-paraméterek ujjlenyomata
  params        JSONB,                          -- a felhasznált kamion-paraméterek
  point_count   INTEGER NOT NULL DEFAULT 0,     -- a gps_track_days pontszáma a számításkor (változás → újraszámolás)
  total_eur     NUMERIC(12,2) NOT NULL DEFAULT 0,
  km            NUMERIC(10,1),
  breakdown     JSONB NOT NULL DEFAULT '[]',    -- [{country, cost}]
  passes        JSONB NOT NULL DEFAULT '[]',    -- matricák/bérletek (nem km-díj)
  notices       JSONB NOT NULL DEFAULT '[]',
  here_calls    INTEGER NOT NULL DEFAULT 0,
  computed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, rendszam, day, params_hash)
);
CREATE INDEX IF NOT EXISTS idx_gps_toll_days_lookup ON gps_toll_days (company_id, rendszam, day);
