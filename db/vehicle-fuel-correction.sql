-- db/vehicle-fuel-correction.sql
-- Vontató-jármű üzemanyag-szint korrekciós érték (liter, +/-).
-- A GPS-eszköz (CargoTrack) által mért tartály-szint gyakran eltér a
-- valós szinttől (érzékelő-kalibráció, tartály-forma, üledék). Az admin
-- itt cégenként/járművenként megadhat egy fix offsetet, amivel a sofőr
-- oldali „⛽ GPS-üzemanyag" gomb kiigazítja a lekért értéket, MIELŐTT
-- a menetlevélbe kerül. Pl. GPS 500 L, korrekció -20 L → sofőr 480 L-t lát.
-- Pótkocsira NEM értelmezett (csak Vontato); a mező üresen hagyva → nincs
-- korrekció (a nyers GPS-érték megy).
-- Idempotens (ADD COLUMN IF NOT EXISTS).
ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS fuel_correction_l NUMERIC(6,1);

COMMENT ON COLUMN vehicles.fuel_correction_l IS
  'Üzemanyag-szint korrekció liter/L, +/-, a GPS-mért vs. valós szint eltérésre. NULL = nincs korrekció.';
