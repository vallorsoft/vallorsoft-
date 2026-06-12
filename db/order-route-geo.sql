-- ============================================================
--  VallorSoft — fuvar útvonal-előnézet metaadat (idempotens)
--  orders.route_geo JSONB: a fuvar-kiíráskor térkép alapján számolt
--  útvonal { waypoints:[{type,address,lat,lng}], polyline:[[lat,lng]],
--  km, durationSeconds }. A köztespontok CSAK a km-számítás és az
--  útvonal-előnézet miatt vannak — NEM megállók (nem order_legs).
-- ============================================================

ALTER TABLE orders ADD COLUMN IF NOT EXISTS route_geo JSONB;
