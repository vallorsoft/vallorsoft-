-- ============================================================
--  Útvonal-eltérés szakaszonként (lib/routeDeviation.js CALC_VERSION 4)
--  extra_km — a tűrésen túli többlet-km összege azokon a szakaszokon, ahol
--  lett volna rövidebb kamionos út (a tankolás / pihenő / parkoló miatti
--  kényszerű kitérők leszámítva). A diff_km marad a nyers megtett − tervezett.
--  A régi (v < 4) sorok az ütemezőben magától újraszámolódnak.
-- ============================================================
ALTER TABLE order_route_deviation ADD COLUMN IF NOT EXISTS extra_km NUMERIC(9,1);
