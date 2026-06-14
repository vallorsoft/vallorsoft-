-- db/order-etransport.sql
-- RO e-Transport (UIT) deklarációhoz szükséges áru-adatok a fuvarhoz.
-- A bruttó súly már megvan (orders.suly_kg). Itt:
--   nc_code        — Nomenclatura Combinată / HS-kód (áru-besorolás a deklarációhoz)
--   marfa_value    — áru értéke (a fuvardíjtól KÜLÖN; a deklarációba ez kell)
--   marfa_currency — az áru-érték pénzneme (alap RON)
--   needs_uit      — a diszpécser jelzi, hogy a fuvar UIT-kötelezett (nemzetközi
--                    fuvar VAGY belföldi kockázatos áru ≥2,5t járművön). A fuvarlistán
--                    ⚠️ jelez, ha needs_uit ÉS nincs aktív UIT-kód a fuvarhoz.
-- Mind opcionális, visszafelé kompatibilis. Futtatás: auto a szerver indulásakor.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS nc_code        VARCHAR(20);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS marfa_value    NUMERIC(14,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS marfa_currency VARCHAR(3) DEFAULT 'RON';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS needs_uit      BOOLEAN NOT NULL DEFAULT FALSE;
