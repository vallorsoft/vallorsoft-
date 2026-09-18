-- ============================================================
--  VallorSoft — Kifizetés → járandóság RÉSZLEGES hozzárendelés (allokáció)
--  Idempotens migráció.
--
--  Cél: a Teljes/Részleges kifizetés vezetett folyamatában a kezelő
--  megadja, MELYIK járandóság-tételből MENNYI legyen kifizetve (akár egy
--  tétel részlegesen). A `driver_payment_group_items` mostantól tárolja a
--  RON-egyenértékben allokált összeget (`alloc_ron`).
--
--    alloc_ron IS NULL  → a tétel TELJESEN kifizetve (régi/„egész tétel"
--                         viselkedés — a multi-select csoportos kifizetés).
--    alloc_ron = szám   → ennyi RON-egyenérték lett erre a tételre allokálva
--                         ebből a csoportból (részleges is lehet).
--
--  Az egy-earning-egy-csoport (UNIQUE earning_id) megkötést ELEJTJÜK: egy
--  tételt több részletben (több csoportból) is ki lehet fizetni. A
--  túl-allokálás ellen a szerver (earningPaymentGroupCreate) őrködik.
-- ============================================================

ALTER TABLE driver_payment_group_items
  ADD COLUMN IF NOT EXISTS alloc_ron NUMERIC(12,2);

-- A régi inline UNIQUE (earning_id) megkötés eldobása (idempotens).
-- Az inline UNIQUE auto-neve általában <tábla>_earning_id_key.
DO $$
DECLARE
  cname TEXT;
BEGIN
  SELECT con.conname INTO cname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
   WHERE rel.relname = 'driver_payment_group_items'
     AND con.contype = 'u'
     AND pg_get_constraintdef(con.oid) ILIKE '%(earning_id)%'
   LIMIT 1;
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE driver_payment_group_items DROP CONSTRAINT %I', cname);
  END IF;
END$$;

-- Mostantól earning-enként több sor is lehet → index a gyors összesítéshez.
CREATE INDEX IF NOT EXISTS idx_driver_payment_group_items_earning
  ON driver_payment_group_items(earning_id);
