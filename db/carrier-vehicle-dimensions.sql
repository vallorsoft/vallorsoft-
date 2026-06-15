-- ============================================================
--  VallorSoft — pótkocsi rakodási méretek a carrier_vehicles táblán
-- ============================================================
ALTER TABLE carrier_vehicles ADD COLUMN IF NOT EXISTS trailer_kind VARCHAR(10);   -- 'standard' | 'mega'
ALTER TABLE carrier_vehicles ADD COLUMN IF NOT EXISTS cargo_length_cm INTEGER;
ALTER TABLE carrier_vehicles ADD COLUMN IF NOT EXISTS cargo_width_cm INTEGER;
ALTER TABLE carrier_vehicles ADD COLUMN IF NOT EXISTS cargo_height_cm INTEGER;
