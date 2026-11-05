-- ============================================================
--  VallorSoft — db/zzz-drop-osrm-route-results.sql
--  Útvonal-becslés KIZÁRÓLAG HERE kamionnal: az autós OSRM km/idő kamionra
--  félrevezető, ezért a korábban OSRM-mel (nem HERE-rel) tervezett tárolt
--  eredményeket töröljük. HERE-kulcsos cégnél a háttér-ütemező HERE-rel
--  újraszámolja; HERE nélkül „nincs adat (HERE kell)" jelenik meg.
--  Idempotens (a második futás már nem talál nem-HERE sort).
-- ============================================================

-- 1) Útvonal-eltérés (fuvar): nem HERE-terv → „nincs adat", a terv-értékek törölve
UPDATE order_route_deviation
   SET status = 'no_data', planned_km = NULL, diff_km = NULL, diff_pct = NULL, planned_geo = NULL,
       detail = jsonb_build_object('reason', 'no_here', 'v', COALESCE((detail->>'v')::int, 1)),
       checked_at = NOW() - INTERVAL '3 days'
 WHERE status <> 'no_data' AND COALESCE(source, '') <> 'here';

-- 2) Menetlevél útvonala: nem HERE-terv → „nincs adat" (a km-óra érték marad)
UPDATE waybill_route_check
   SET status = 'no_data', planned_km = NULL, loaded_km = NULL, empty_km = NULL, diff_km = NULL, diff_pct = NULL,
       planned_h = NULL, planned_geo = NULL,
       detail = jsonb_build_object('reason', 'no_here'),
       checked_at = NOW() - INTERVAL '3 days'
 WHERE status <> 'no_data' AND COALESCE(detail->>'src', '') <> 'here-truck';

-- 3) Fuvar automata km: a nem HERE-rel számolt automata km törölve (a kézzel
--    beírt km marad); a pontok koordinátái megmaradnak (geokódolás, nem OSRM).
--    prev_km: a régi automata érték — a HERE-újraszámolás ez alapján írhatja felül.
UPDATE orders
   SET km = CASE WHEN (route_geo->>'auto') = 'true' AND km IS NOT NULL AND (route_geo->>'km') IS NOT NULL
                      AND ABS(km - (route_geo->>'km')::numeric) < 1 THEN NULL ELSE km END,
       route_geo = (route_geo - 'km' - 'legs' - 'loaded_km' - 'empty_km' - 'durationSeconds' - 'free_reason')
                   || jsonb_build_object('src', 'none', 'prev_km', route_geo->'km')
 WHERE route_geo IS NOT NULL AND jsonb_typeof(route_geo) = 'object'
   AND COALESCE(route_geo->>'src', '') NOT IN ('here-truck', 'none');
