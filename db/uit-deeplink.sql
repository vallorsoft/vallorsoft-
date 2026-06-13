-- db/uit-deeplink.sql
-- UIT (e-Transport kód) megoldása ANAF-integráció NÉLKÜL: cégenként beállítható
-- CargoTrack (vagy más) deep-link URL-sablon, amibe a fuvar adatai behelyettesülnek
-- ({id},{rendszam},{remorca},{incarcare},{descarcare},{client},{km},{greutate}).
-- A diszpécser/sofőr egy kattintással „átléptetődik" a UIT-generálóba.
-- Idempotens. Futtatás: psql "$DATABASE_URL" -f db/uit-deeplink.sql

ALTER TABLE companies ADD COLUMN IF NOT EXISTS uit_deeplink_template TEXT;
