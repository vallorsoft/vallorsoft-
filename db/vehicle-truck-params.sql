-- db/vehicle-truck-params.sql
-- Teherjármű útvonaltervezési paraméterek (HERE routing) a vehicles táblához.
-- Idempotens (ADD COLUMN IF NOT EXISTS) — meglévő DB-n biztonságosan futtatható.
-- Futtatás:  psql "$DATABASE_URL" -f db/vehicle-truck-params.sql

ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS height_cm            INTEGER,
  ADD COLUMN IF NOT EXISTS width_cm             INTEGER,
  ADD COLUMN IF NOT EXISTS length_cm            INTEGER,
  ADD COLUMN IF NOT EXISTS weight_kg            INTEGER,
  ADD COLUMN IF NOT EXISTS weight_per_axle_kg   INTEGER,
  ADD COLUMN IF NOT EXISTS axle_count           INTEGER DEFAULT 2,
  ADD COLUMN IF NOT EXISTS trailer_count        INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS truck_type           VARCHAR(20) DEFAULT 'straight',
  ADD COLUMN IF NOT EXISTS tunnel_category      VARCHAR(1),
  ADD COLUMN IF NOT EXISTS hazardous_goods      VARCHAR(50),
  ADD COLUMN IF NOT EXISTS fuel_per_100km       NUMERIC(5,2);

COMMENT ON COLUMN vehicles.height_cm IS 'Jármű magassága cm-ben (HERE routing)';
COMMENT ON COLUMN vehicles.weight_kg IS 'Teljes tömeg kg-ban rakománnyal (HERE routing)';
COMMENT ON COLUMN vehicles.truck_type IS 'straight | tractor | lightTruck';
COMMENT ON COLUMN vehicles.tunnel_category IS 'B/C/D/E — veszélyes áru alagút kategória';
