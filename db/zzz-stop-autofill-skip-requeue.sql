-- ============================================================
--  VallorSoft — Elfelejtett állomás-gomb: a fel nem ismert / későn lenyomott
--  állomás többé nem akasztja meg a későbbi felismert állomások pótlását.
--  Inkrementális migráció (idempotens, egyszer fut): a nyitott (sofőr által még
--  nem lezárt), GPS-ből felismert állomású fuvarokat az utolsó 30 napból újra
--  sorba állítjuk, hogy a sofőr megkapja a jóváhagyó ablakot.
-- ============================================================
UPDATE stop_match_state st SET requeued = true, attempts = 0
 WHERE st.requeued = false
   AND st.order_id IN (
     SELECT DISTINCT s.order_id FROM order_stops s
      WHERE s.done_at IS NULL AND s.actual_lat IS NOT NULL
        AND s.match_status IN ('auto','suggested','confirmed')
        AND COALESCE(s.matched_at, NOW()) > NOW() - INTERVAL '30 days');
