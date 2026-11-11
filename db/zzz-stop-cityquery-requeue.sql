-- ============================================================
--  VallorSoft — Cím-felismerés: a „Hely neve, Utca, Település, …" formájú címek javítása
--  Inkrementális migráció (idempotens, egyszer fut). A motor eddig a tervezett cím ELSŐ
--  vesszős darabját vette településnek — a címkiegészítőből választott címnél ez a hely
--  neve (pl. „Policlinica AS"), nem a település („Arad") → rossz helyre geokódolt, és a
--  település környéki mentett helyek is kimaradtak. A nem lezárt (auto / suggested /
--  unmatched) állomású fuvarokat az utolsó 60 napból újra sorba állítjuk; a confirmed /
--  rejected döntést az újrafuttatás nem írja felül.
-- ============================================================
UPDATE stop_match_state st SET requeued = true, attempts = 0
 WHERE st.requeued = false
   AND st.order_id IN (
     SELECT DISTINCT s.order_id FROM order_stops s
      WHERE s.match_status IN ('auto','suggested','unmatched')
        AND COALESCE(s.matched_at, NOW()) > NOW() - INTERVAL '60 days');
