-- ============================================================
--  VallorSoft — Elfelejtett állomás-gomb pótlása: hibás akadályok feloldása + újrasorolás
--  Inkrementális migráció (idempotens, egyszer fut).
--   1) A végellenőrzés eddig a sofőr KÉSŐN nyomott gombjához mérte a következő állomást
--      (nem a GPS szerinti távozáshoz), és egy korábbi, fel nem ismert azonos helyű állomás
--      (pl. „DN14B") minden későbbi azonos helyű állomást megakasztott. Az így visszavont
--      beírások „verify_fail" jelzése miatt ugyanaz az állás soha többé nem került beírásra —
--      ezt a két okot töröljük a nyitott állomásokról (a jó okúakat nem).
--   2) A javított cím-felismerés (szálloda / építkezés neve, betűs országút, házszámos utca)
--      és a mai napig tartó időablak miatt a folyamatban lévő fuvarokat újra sorba állítjuk.
--  A confirmed / rejected döntést és a sofőr gombnyomását az újrafuttatás nem írja felül.
-- ============================================================
UPDATE order_stops
   SET match_detail = (match_detail - 'verify_fail') - 'auto_skip'
 WHERE done_at IS NULL
   AND match_detail ? 'verify_fail'
   AND match_detail -> 'verify_fail' ->> 'reason' IN ('verify_order_time', 'verify_same_site_open');

UPDATE stop_match_state st SET requeued = true, attempts = 0
 WHERE st.order_id IN (
   SELECT DISTINCT s.order_id FROM order_stops s
     JOIN orders o ON o.id = s.order_id AND o.company_id = s.company_id
    WHERE o.status IN ('Alocat', 'In Curs', 'Parkolt', 'Raktarban')
      AND s.done_at IS NULL
      AND COALESCE(s.match_status, 'unmatched') NOT IN ('confirmed', 'rejected')
      AND o.created_at > NOW() - INTERVAL '60 days');
