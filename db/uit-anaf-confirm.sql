-- db/uit-anaf-confirm.sql
-- Meglévő telepítéshez: az ANAF-visszaigazolás oszlopok hozzáadása az order_uit_codes-hoz.
-- (Friss telepítésnél a uit-migration.sql már tartalmazza ezeket.)
-- Futtatás:  psql "$DATABASE_URL" -f db/uit-anaf-confirm.sql

ALTER TABLE order_uit_codes ADD COLUMN IF NOT EXISTS anaf_confirmed    BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE order_uit_codes ADD COLUMN IF NOT EXISTS anaf_confirmed_at TIMESTAMPTZ;
