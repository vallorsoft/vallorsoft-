-- ============================================================
--  VallorSoft — áru-leadás (fuvar-megszakítás) + raktár modul
--  + pótkocsi rakodási felület (idempotens)
--
--  Eset: a sofőr útközben leadja az árut (defekt, pótkocsi-csere):
--  az áru megrakott pótkocsin parkol VAGY raktárba kerül. A fuvar
--  'Parkolt' / 'Raktarban' státuszba lép, a felrakója a leadás
--  helye lesz, és kiosztásra vár (új vontató + sofőr).
-- ============================================================

-- Fuvar: áru-leadás állapota
ALTER TABLE orders ADD COLUMN IF NOT EXISTS handover_type VARCHAR(20);    -- 'trailer' | 'warehouse'
ALTER TABLE orders ADD COLUMN IF NOT EXISTS handover_loc TEXT;            -- hol van most az áru
ALTER TABLE orders ADD COLUMN IF NOT EXISTS handover_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS handover_status VARCHAR(20);  -- 'Fuggoben' = sofőr jelezte, visszaigazolásra vár
ALTER TABLE orders ADD COLUMN IF NOT EXISTS handover_by VARCHAR(255);     -- ki kezdeményezte (email)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS handover_payload JSONB;       -- a sofőr által beküldött részletek (visszaigazolásig)

-- Pótkocsi RAKODÁSI FELÜLETE — NEM azonos a length_cm/width_cm/height_cm
-- teljes járműmérettel (az a teherjármű-routingé)!
-- Alapértelmezés új bevitelnél (UI tölti elő): 1360 × 248 cm,
-- magasság standard: 260 cm, mega: 305 cm.
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS cargo_length_cm INTEGER;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS cargo_width_cm INTEGER;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS cargo_height_cm INTEGER;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS trailer_kind VARCHAR(10);   -- 'standard' | 'mega'

-- Raktár-tételek (raktárba adott áru)
CREATE TABLE IF NOT EXISTS warehouse_items (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  order_id TEXT NOT NULL,
  location TEXT NOT NULL,                 -- raktár helysége/címe
  qty INTEGER,                            -- darabszám
  qty_unit VARCHAR(20),                   -- 'paletta' | 'doboz' | 'egyeb'
  length_cm INTEGER,                      -- foglalt hely a kamionon
  width_cm INTEGER,
  height_cm INTEGER,
  weight_kg NUMERIC(10,2),
  doc_pages INTEGER,                      -- hány lapos a kísérő dokumentum
  note TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'Raktarban',  -- 'Raktarban' | 'Kiadva'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_warehouse_company ON warehouse_items(company_id, status);
CREATE INDEX IF NOT EXISTS idx_warehouse_order ON warehouse_items(order_id);
