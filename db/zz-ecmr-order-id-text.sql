-- ============================================================
--  VallorSoft — e-CMR: order_ecmr.order_id INTEGER → VARCHAR (idempotens)
--
--  HIBA: az orders.id szöveges kulcs (pl. 'CMD-MS8NDEHONVF'), az order_ecmr
--  viszont INTEGER-ként tárolta a fuvar-hivatkozást. Emiatt a lista/megnyitás
--  JOIN-ja (o.id = oe.order_id) „operator does not exist: varchar = integer"
--  hibát dobott, a létrehozás pedig a parseInt('CMD-…') = NaN miatt el sem
--  indult → az egész e-CMR modul használhatatlan volt.
--
--  A `zz-` előtag miatt a db/ecmr.sql UTÁN fut (a fájlnév-sorrendben). Újrafuttatva
--  (varchar → varchar) no-op. Érvényes sor a hibás típus miatt nem keletkezhetett,
--  a meglévő értékek szövegként megmaradnak.
-- ============================================================
ALTER TABLE order_ecmr ALTER COLUMN order_id TYPE VARCHAR(50) USING order_id::text;
CREATE INDEX IF NOT EXISTS idx_order_ecmr_company_order ON order_ecmr (company_id, order_id);
