-- ============================================================
--  VallorSoft — invites.nume / invites.tel oszlopok pótlása
--  Idempotens migráció (többször lefuttatható).
--
--  Az invCreate handler a meghívott NEVÉT és TELEFONSZÁMÁT is menti
--  (a meghívó-e-mail a meghívott nevével köszön), de az oszlopok
--  hiányoztak a sémából → a meghívó-generálás "Szerver hiba"-val
--  bukott azokon a DB-ken, ahol nem lettek kézzel pótolva.
-- ============================================================

ALTER TABLE invites ADD COLUMN IF NOT EXISTS nume VARCHAR(255);
ALTER TABLE invites ADD COLUMN IF NOT EXISTS tel  VARCHAR(50);
