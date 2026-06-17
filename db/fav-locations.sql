-- ============================================================
--  VallorSoft — Kedvenc helyszínek (favorite locations)
--  Inkrementális migráció (idempotens) — automatikusan lefut induláskor.
--
--  Gyakran használt felrakó/lerakó helyek mentése a fuvar-űrlap gyors
--  kitöltéséhez. Multi-tenant: minden helyszín egy céghez tartozik.
--  Nem személyes adat (cég-telephelyek/címek).
-- ============================================================

CREATE TABLE IF NOT EXISTS favorite_locations (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  label TEXT NOT NULL,
  address TEXT NOT NULL,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  type TEXT DEFAULT 'both',          -- load | unload | both
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_favorite_locations_company ON favorite_locations (company_id);
