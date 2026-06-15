-- ============================================================
--  VallorSoft — sofőr neve a carrier járműhöz
-- ============================================================
ALTER TABLE carrier_vehicles
  ADD COLUMN IF NOT EXISTS sofer_nev VARCHAR(120);
