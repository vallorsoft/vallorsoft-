-- ============================================================
--  VallorSoft — útdíj (toll) becslés (idempotens)
--  A fuvar-eredmény végre hiteles: az útdíj is levonódik.
--   - orders.toll_cost  : a fuvar útdíja EUR-ban (becsült vagy kézi).
--   - orders.toll_geo   : országonkénti bontás { total, byCountry:[...] }.
--   - toll_rates        : cégenkénti útdíj-ráták (ország, €/km vagy matrica).
--   - geo_country_cache : lat/lng-rács → ISO ország-kód (a km-bontáshoz,
--                         hogy a reverse-geokódolás bemelegedés után olcsó).
-- ============================================================

ALTER TABLE orders ADD COLUMN IF NOT EXISTS toll_cost NUMERIC(10,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS toll_geo  JSONB;

CREATE TABLE IF NOT EXISTS toll_rates (
  id           SERIAL PRIMARY KEY,
  company_id   INTEGER NOT NULL,
  country_code VARCHAR(2) NOT NULL,
  mode         VARCHAR(10) NOT NULL DEFAULT 'perkm',   -- 'perkm' | 'vignette'
  eur_per_km   NUMERIC(8,4),
  vignette_eur NUMERIC(10,2),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_toll_rates_cc ON toll_rates (company_id, country_code);

CREATE TABLE IF NOT EXISTS geo_country_cache (
  cell         VARCHAR(24) PRIMARY KEY,                 -- pl. "45.5,24.0" (0.5°-os rács)
  country_code VARCHAR(2),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
