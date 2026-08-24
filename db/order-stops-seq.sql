-- ============================================================
--  VallorSoft — order_stops.seq_index (interleaved sorrend megőrzés)
--  Inkrementális, idempotens migráció — automatikusan lefut induláskor.
--  ------------------------------------------------------------
--  Eddig a fuvar felrakói és lerakói két KÜLÖN sorrendben éltek
--  (kind-en belül stop_index) → a kliens által beírt „2 felrakó,
--  5 lerakó, 3 felrakó, 1 lerakó" interleaved sorrend elveszett,
--  a sofőrnek is elöl az összes felrakó, hátul az összes lerakó
--  jelent meg. Új `seq_index` (globális sorrend a fuvaron belül,
--  0-alapú) megőrzi a bevitel sorrendjét.
--
--  A kind-en belüli `stop_index` MEGMARAD (a régi mirror-trigger
--  és a per-kind indexelés — pl. felrakó#1 vs #2 — arra épül).
--  Az új `seq_index` csak sorrendezésre és megjelenítésre való.
-- ============================================================

ALTER TABLE order_stops ADD COLUMN IF NOT EXISTS seq_index INTEGER;

-- Backfill: minden meglévő stop-nak seq_index = a régi „pickups először,
-- delivery-k utána" sorrend (bit-azonos a régi UI-val). Csak a NULL sorokat
-- érinti, tehát ismételt migráció-futtatás nem borogatja a felhasználó által
-- utólag átírt sorrendet.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY order_id
           ORDER BY CASE kind WHEN 'pickup' THEN 0 ELSE 1 END,
                    stop_index,
                    id
         ) - 1 AS seq
    FROM order_stops
   WHERE seq_index IS NULL
)
UPDATE order_stops o
   SET seq_index = r.seq
  FROM ranked r
 WHERE o.id = r.id;

CREATE INDEX IF NOT EXISTS idx_order_stops_seq ON order_stops(order_id, seq_index);
