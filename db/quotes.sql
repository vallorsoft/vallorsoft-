-- ============================================================
--  VallorSoft — Árajánlatok (Quotes / Cotații)
--  Inkrementális migráció (idempotens) — automatikusan lefut induláskor.
--
--  Egy árajánlat (cotație) egy potenciális fuvarra: ügyfél, reláció,
--  ár, érvényesség. A "→ Fuvar" konverzió a MEGLÉVŐ fuvar-létrehozó
--  úton (comCreate) hoz létre fuvart, és az ajánlatot 'awarded'-re állítja.
--  Multi-tenant: minden lekérdezés company_id-szűrt, paraméteres SQL.
-- ============================================================

CREATE TABLE IF NOT EXISTS quotes (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  client_id INTEGER,                       -- opcionális hivatkozás a clients-re
  client_name TEXT,                        -- pillanatkép / szabad szöveg
  loc_from TEXT, loc_to TEXT,
  price NUMERIC(12,2), valuta TEXT DEFAULT 'EUR',
  status TEXT NOT NULL DEFAULT 'draft',    -- draft | sent | awarded | lost
  valid_until DATE,
  note TEXT,
  order_id TEXT,                           -- a konvertált fuvar azonosítója
  created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Idempotens védőhálók (ha a tábla már létezett egy korábbi verzióval)
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS company_id INTEGER;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS client_id INTEGER;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS client_name TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS loc_from TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS loc_to TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS price NUMERIC(12,2);
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS valuta TEXT DEFAULT 'EUR';
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft';
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS valid_until DATE;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS order_id TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_quotes_company ON quotes (company_id, status);
