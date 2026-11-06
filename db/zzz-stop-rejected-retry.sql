-- ============================================================
--  VallorSoft — db/zzz-stop-rejected-retry.sql
--  Az irodában elvetett (✕) tényleges címekre a felismerő mostantól új helyet
--  keres (az elvetett hely nélkül), és a menetlevélre is ráírja. A már
--  elvetett állomások fuvarjait egyszer újrasoroljuk, hogy ők is kapjanak.
--  Idempotens (újrafutáskor csak újra sorba teszi ugyanazokat).
-- ============================================================
INSERT INTO stop_match_state (order_id, company_id, status, attempts, requeued)
SELECT DISTINCT s.order_id, s.company_id, 'queued', 0, true
  FROM order_stops s
 WHERE s.match_status = 'rejected'
ON CONFLICT (order_id) DO UPDATE SET requeued = true, attempts = 0;
