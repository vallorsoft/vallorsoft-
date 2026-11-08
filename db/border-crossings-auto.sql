-- Határátlépés AUTOMATIKUSAN a GPS-ből (Románia-geozóna, lib/roBorder.js).
-- A gps_track_days pontsorából felismert ki-/belépés a border_crossings-ba
-- kerül source='auto' jelöléssel. A sofőr gombja (source NULL / 'driver')
-- megmarad, de ahol van GPS-adat, a diurna az automatikus sorokból számol.
ALTER TABLE border_crossings ADD COLUMN IF NOT EXISTS company_id INTEGER;
ALTER TABLE border_crossings ADD COLUMN IF NOT EXISTS rendszam   VARCHAR(20);
ALTER TABLE border_crossings ADD COLUMN IF NOT EXISTS source     VARCHAR(12);
ALTER TABLE border_crossings ADD COLUMN IF NOT EXISTS ignored    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE border_crossings ADD COLUMN IF NOT EXISTS gap_sec    INTEGER;

CREATE INDEX IF NOT EXISTS idx_border_auto_plate
  ON border_crossings (company_id, rendszam, created_at) WHERE source = 'auto';

-- Visszamenőleges cég-horgony a meglévő (sofőr-gombos) sorokra
UPDATE border_crossings bc SET company_id = u.company_id
  FROM users u
 WHERE bc.company_id IS NULL AND LOWER(u.email) = LOWER(bc.email_sofer);

-- A felismerő melyik GPS-napot dolgozta már fel (updated_at-tel összevetve)
ALTER TABLE gps_track_days ADD COLUMN IF NOT EXISTS border_scanned_at TIMESTAMPTZ;
