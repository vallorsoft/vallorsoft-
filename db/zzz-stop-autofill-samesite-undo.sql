-- ============================================================
--  VallorSoft — Elfelejtett gomb: ismétlődő hely a fuvarban (pl. a 4. = a 6. állomás)
--  Inkrementális migráció (idempotens, egyszer fut). A rendszer a mai GPS-állást
--  tévesen a KÉSŐBBI azonos helyű állomásra írta be, a korábbi nyitva maradt.
--  A még NEM jóváhagyott ilyen automatikus beírásokat visszavonjuk (a sofőr gombnyomását
--  nem érintjük), a tényleges címüket töröljük, és a fuvart újra sorba állítjuk —
--  a javított motor a korábbi állomásra teszi az állást.
-- ============================================================
WITH bad AS (
  SELECT s.id, s.order_id, s.company_id, s.auto_filled
    FROM order_stops s
   WHERE s.auto_filled IS NOT NULL AND s.auto_ack_at IS NULL AND s.done_at IS NOT NULL
     AND COALESCE(s.match_status,'') <> 'confirmed'
     AND EXISTS (SELECT 1 FROM order_stops p
                  WHERE p.order_id = s.order_id AND p.company_id = s.company_id AND p.id <> s.id
                    AND p.done_at IS NULL
                    AND (COALESCE(p.seq_index, 999999), p.stop_index) < (COALESCE(s.seq_index, 999999), s.stop_index)
                    AND lower(trim(COALESCE(p.loc,''))) = lower(trim(COALESCE(s.loc,'')))
                    AND lower(trim(COALESCE(p.firma,''))) = lower(trim(COALESCE(s.firma,'')))
                    AND (COALESCE(p.loc,'') <> '' OR COALESCE(p.firma,'') <> ''))
), undone AS (
  UPDATE order_stops s SET
         done_at = NULL,
         arrived_at = CASE WHEN bad.auto_filled = 'both' THEN NULL ELSE s.arrived_at END,
         auto_filled = NULL, auto_filled_at = NULL,
         actual_lat = NULL, actual_lng = NULL, actual_address = NULL, actual_city = NULL, actual_country = NULL,
         gps_arrived_at = NULL, gps_left_at = NULL, match_status = 'unmatched', match_score = NULL,
         updated_at = NOW()
    FROM bad WHERE s.id = bad.id
  RETURNING s.order_id, s.company_id, s.kind
), reopened AS (
  -- a visszavont lerakó miatt újra nyitott, automatikusan lezárt fuvar → In Curs
  UPDATE orders o SET status = 'In Curs', updated_at = NOW()
    FROM (SELECT DISTINCT order_id, company_id FROM undone WHERE kind = 'delivery') u
   WHERE o.id = u.order_id AND o.company_id = u.company_id AND o.status = 'Finalizat'
  RETURNING o.id
)
UPDATE stop_match_state st SET requeued = true, attempts = 0
 WHERE st.order_id IN (SELECT order_id FROM undone);
