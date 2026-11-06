-- ============================================================
--  VallorSoft — a GPS szerinti cím újra-rátétele a menetlevelekre (egyszeri)
--  A fuvar szerkesztése eddig új azonosítót adott az állomásoknak, így a
--  menetlevél pontjai (puncte[].stopId) elárvultak, és a tényleges cím csak
--  egy részükre került rá. A lib/stopWaybill már dátum / sorrend alapján is
--  összeköti az elárvult pontokat — ehhez a rátételt egyszer újra lefuttatjuk
--  (az ütemező applyPending köre dolgozza fel). Idempotens.
-- ============================================================
UPDATE order_stops
   SET waybill_apply = true
 WHERE match_status = 'confirmed' AND actual_address IS NOT NULL AND waybill_apply IS DISTINCT FROM true;

UPDATE order_stops
   SET waybill_applied_at = NULL
 WHERE waybill_apply = true AND actual_address IS NOT NULL
   AND COALESCE(match_status,'') <> 'rejected';
