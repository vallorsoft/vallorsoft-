-- ============================================================
--  VallorSoft — sofőr↔jármű hozzárendelés (idempotens)
--  A vontatóhoz alapértelmezett sofőr rendelhető (Belső sofőrök fül).
--  Egy jármű ↔ egy sofőr; a hozzárendelés tájékoztató jellegű
--  (a fuvar-kiosztást nem korlátozza, de a felület mutatja).
-- ============================================================

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS assigned_driver_email VARCHAR(255);
CREATE INDEX IF NOT EXISTS idx_vehicles_assigned_driver ON vehicles(company_id, assigned_driver_email);
