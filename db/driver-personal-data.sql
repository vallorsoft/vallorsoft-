-- ============================================================
--  VallorSoft — sofőr személyes adatok (idempotens)
--  A „Decont oficial" hivatalos elszámolás fejlécéhez / a
--  munkaügyi + könyvelési nyilvántartáshoz. A sofőr adatlapján
--  egyszer megadva, minden későbbi Decont oficial-ra bekerül.
--  Minden mező opcionális, VARCHAR-ként tároljuk (nemzetközi
--  CNP / ID formátumok — nincs beépített validáció, csak hossz-
--  korlát a kliens+szerver oldalon).
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS contract_no VARCHAR(60),
  ADD COLUMN IF NOT EXISTS cnp         VARCHAR(30),
  ADD COLUMN IF NOT EXISTS id_series   VARCHAR(10),
  ADD COLUMN IF NOT EXISTS id_number   VARCHAR(20);
