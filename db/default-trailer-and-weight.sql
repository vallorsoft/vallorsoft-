-- ============================================================
--  VallorSoft — vontató↔pótkocsi alapértelmezett pár + fuvar-súly
--  (idempotens)
--
--  1) vehicles.default_trailer_id — a vontatóhoz rendelt alapértelmezett
--     pótkocsi (Belső sofőrök fül). Fuvar-kiíráskor / tervezőtáblás-radaros
--     kiosztáskor a hiányzó pótkocsi automatikusan kitöltődik belőle
--     (autoPairTrailer). Csak ÜRES mezőt tölt, felül nem ír.
--  2) orders.suly_kg — a fuvar (rész)rakományának súlya. A Visszfuvar-
--     radar az átfedő (részrakományos) fuvarok súlyát összegzi és jelez,
--     ha túllépi a pótkocsi rakható tömegét (MAX_PARTIAL_PAYLOAD_KG).
-- ============================================================

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS default_trailer_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_vehicles_default_trailer ON vehicles(company_id, default_trailer_id);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS suly_kg NUMERIC(10,2);
