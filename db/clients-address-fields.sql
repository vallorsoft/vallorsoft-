-- db/clients-address-fields.sql
-- Strukturált cím-mezők a clients táblához (az ANAF v9 adresa_sediu_social bontásból).
-- A meglévő összevont `adresa` oszlopot NEM bántjuk (visszafelé kompatibilis fallback).
-- Idempotens: ADD COLUMN IF NOT EXISTS — bármennyiszer lefuthat.

ALTER TABLE clients ADD COLUMN IF NOT EXISTS strada         TEXT;  -- utca
ALTER TABLE clients ADD COLUMN IF NOT EXISTS nr_strada      TEXT;  -- házszám (numar)
ALTER TABLE clients ADD COLUMN IF NOT EXISTS detalii_adresa TEXT;  -- detalii: bloc/scară/apartament
ALTER TABLE clients ADD COLUMN IF NOT EXISTS oras           TEXT;  -- helység/város (localitate)
ALTER TABLE clients ADD COLUMN IF NOT EXISTS cod_postal     TEXT;  -- irányítószám
