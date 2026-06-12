-- ============================================================
--  VallorSoft — CSV-import: ismeretlen oszlopok megőrzése (idempotens)
--  orders.import_extra JSONB: a fuvar-CSV importnál a NEM párosított
--  (a rendszer által nem ismert) oszlopok { fejléc: érték } párban — így
--  nem vész el adat. A szerkesztőben „Importált extra adatok" blokkban
--  megnézhető. Az importról a forrás-jelzéshez import_source is.
-- ============================================================

ALTER TABLE orders ADD COLUMN IF NOT EXISTS import_extra JSONB;
