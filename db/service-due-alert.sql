-- ============================================================
--  VallorSoft — km-/dátum-alapú szerviz-esedékesség riasztás (idempotens)
--  A vehicle_service_log már tárolja a `next_due_km` és `next_due_date`
--  mezőket; ez a migráció csak a riasztás-ismétlés duplikáció-őréhez ad
--  egy `last_alert_at` oszlopot (ugyanúgy, mint a document_expiries-nél).
--  A scheduler hetente egyszer szól újra, amíg a szerviz esedékes marad.
-- ============================================================

ALTER TABLE vehicle_service_log ADD COLUMN IF NOT EXISTS last_alert_at DATE;
