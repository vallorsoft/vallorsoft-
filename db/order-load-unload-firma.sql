-- ============================================================
--  VallorSoft — Fuvar: külön felrakási / lerakási cégnév
--  Az orders eddig egyetlen cégmezőt tárolt (client = megrendelő).
--  A sofőrnek gyakran a KONKRÉT felrakó és lerakó CÉG neve kell
--  (feladó / címzett), a helyszín + időpont mellett.
--  Idempotens: IF NOT EXISTS.
-- ============================================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS firma_incarcare  VARCHAR(255);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS firma_descarcare VARCHAR(255);
