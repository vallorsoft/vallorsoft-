-- ============================================================
--  VallorSoft — Elfelejtett gomb: ismétlődő hely a fuvarban, a tervezett nap ELŐTTI állással
--  Inkrementális migráció (idempotens, egyszer fut). Ha egy hely többször szerepel a fuvarban
--  (pl. az 5. = a 7. állomás, csak holnap), a holnapi állomást a rendszer egy MAI GPS-állással
--  írta be, és ezzel a fuvart is lezárta. A még NEM jóváhagyott ilyen beírásokat visszavonjuk
--  (a sofőr gombnyomását nem érintjük), a lezárt fuvart In Curs-ra állítjuk, és újrasoroljuk.
-- ============================================================
WITH bad AS (
  SELECT s.id, s.order_id, s.company_id, s.auto_filled
    FROM order_stops s
   WHERE s.auto_filled IS NOT NULL AND s.auto_ack_at IS NULL AND s.done_at IS NOT NULL
     AND COALESCE(s.match_status,'') <> 'confirmed'
     AND s.data IS NOT NULL
     AND (COALESCE(s.gps_left_at, s.done_at) AT TIME ZONE 'Europe/Bucharest')::date < s.data
     AND EXISTS (SELECT 1 FROM order_stops p
                  WHERE p.order_id = s.order_id AND p.company_id = s.company_id AND p.id <> s.id
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
  RETURNING s.order_id, s.company_id
), reopened AS (
  UPDATE orders o SET status = 'In Curs', updated_at = NOW()
    FROM (SELECT DISTINCT order_id, company_id FROM undone) u
   WHERE o.id = u.order_id AND o.company_id = u.company_id AND o.status = 'Finalizat'
  RETURNING o.id
)
UPDATE stop_match_state st SET requeued = true, attempts = 0
 WHERE st.order_id IN (SELECT order_id FROM undone);
