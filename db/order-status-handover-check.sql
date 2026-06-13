-- db/order-status-handover-check.sql
-- A fuvar-státusz CHECK kibővítése a leadott-áru státuszokkal.
--
-- A schema.sql eredeti `orders_status_check`-je csak az alap státuszokat
-- engedte ('Disponibil','Alocat','Extern','In Curs','Finalizat','Anulat'),
-- a cargo-handover migráció viszont elfelejtette bővíteni — így egy FRISS
-- adatbázison (schema.sql + migrációk) az áru-leadás ('Parkolt'/'Raktarban')
-- DB-szinten elhasalt volna ("violates check constraint orders_status_check").
--
-- Idempotens: a meglévő constraintet eldobjuk és a teljes halmazzal újra
-- létrehozzuk. Futtatás: psql "$DATABASE_URL" -f db/order-status-handover-check.sql

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('Disponibil','Alocat','Extern','In Curs','Finalizat','Anulat','Parkolt','Raktarban'));
