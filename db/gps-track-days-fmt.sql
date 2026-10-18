-- GPS útvonal-előzmény: pont-formátum verzió (2 = tartály-szint + irány is mentve).
-- A régi (1) napokat az ütemező / a lekérdezés teljesen újratölti.
ALTER TABLE gps_track_days ADD COLUMN IF NOT EXISTS fmt SMALLINT NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_gps_track_days_fmt ON gps_track_days (company_id, rendszam, fmt);
