-- ============================================================
--  VallorSoft — Alvállalkozó-csoportok (carrier groups)
--  Inkrementális migráció (idempotens) — automatikusan lefut induláskor.
--
--  A meglévő alvállalkozók (carriers) névvel ellátott csoportokba
--  rendezhetők szűréshez. Multi-tenant: minden csoport egy céghez tartozik.
-- ============================================================

CREATE TABLE IF NOT EXISTS carrier_groups (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- A carriers törzs hivatkozása a csoportra (NULL = nincs csoport)
ALTER TABLE carriers ADD COLUMN IF NOT EXISTS group_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_carrier_groups_company ON carrier_groups (company_id);
CREATE INDEX IF NOT EXISTS idx_carriers_group ON carriers (company_id, group_id);
