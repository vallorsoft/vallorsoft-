-- ============================================================
--  VallorSoft — Valorcalc integráció (költség-kalkulátor)
--  Multi-tenant, idempotens. Új main-menü: 📊 Költség-kalkulátor.
--
--  A Vallorcalc Truck/Trailer/Driver MODELLEK NEM másolódnak be —
--  a meglévő `vehicles` + `users pozicio=Sofer` az igazságforrás.
--  Csak a Vallorcalc-specifikus "költség-tételek" + "kalkuláció"
--  + "kalkulátor-beállítások" táblák jönnek létre.
-- ============================================================

-- ── 1. Jármű-költség-tételek (vontató + pótkocsi közösen a `vehicles`-ből) ──
CREATE TABLE IF NOT EXISTS vehicle_cost_items (
  id             BIGSERIAL PRIMARY KEY,
  company_id     INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  vehicle_id     INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  name           VARCHAR(200) NOT NULL,
  basis_type     VARCHAR(10) NOT NULL DEFAULT 'time', -- 'km' | 'time'
  interval_km    NUMERIC(12,2),
  interval_months INTEGER,
  amount_lei     NUMERIC(14,2) NOT NULL,
  is_gross       BOOLEAN NOT NULL DEFAULT TRUE,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vci_company ON vehicle_cost_items(company_id);
CREATE INDEX IF NOT EXISTS idx_vci_vehicle ON vehicle_cost_items(vehicle_id);

-- ── 2. Sofőr-költség-tételek (a `users pozicio=Sofer` sorra) ──
--    A Vallorcalc DriverCostItem interval nélkül volt — a motor
--    éves nettó / munkahetek × tripWeeks alapon számol. Itt is így.
CREATE TABLE IF NOT EXISTS driver_cost_items (
  id           BIGSERIAL PRIMARY KEY,
  company_id   INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  driver_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         VARCHAR(200) NOT NULL,
  amount_lei   NUMERIC(14,2) NOT NULL, -- ÉVES nettó/bruttó összeg
  is_gross     BOOLEAN NOT NULL DEFAULT TRUE,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dci_company ON driver_cost_items(company_id);
CREATE INDEX IF NOT EXISTS idx_dci_driver ON driver_cost_items(driver_id);

-- ── 3. Cég-szintű fix költség-tételek (aktív vontatók számára osztva) ──
CREATE TABLE IF NOT EXISTS company_cost_items (
  id             BIGSERIAL PRIMARY KEY,
  company_id     INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name           VARCHAR(200) NOT NULL,
  basis_type     VARCHAR(10) NOT NULL DEFAULT 'time', -- 'km' | 'time'
  interval_months INTEGER DEFAULT 12,
  amount_lei     NUMERIC(14,2) NOT NULL,
  is_gross       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cci_company ON company_cost_items(company_id);

-- ── 4. Cégenkénti kalkulátor-beállítások (a Vallorcalc SystemSettings) ──
--    A `companies.eur_ron_rate` (BNR fallback) MÁR MEGVAN — nem
--    duplikáljuk. Itt csak a kalkulátor-specifikus beállítások.
CREATE TABLE IF NOT EXISTS company_calc_settings (
  company_id             INTEGER PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  annual_km_target       NUMERIC(12,2) NOT NULL DEFAULT 120000,
  working_weeks_per_year INTEGER NOT NULL DEFAULT 48,
  excisa_discount_lei    NUMERIC(14,2),
  excisa_discount_type   VARCHAR(10), -- 'gross' | 'net'
  fuel_discount_lei      NUMERIC(14,2),
  fuel_discount_type     VARCHAR(10),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 5. Mentett kalkulációk (fuvarhoz linkelhető) ──
--    order_id NULL → manuális kalkuláció (nincs Vallorsoft-fuvar mögötte)
--    order_id NOT NULL → adott fuvarra készült ár-ajánló
CREATE TABLE IF NOT EXISTS cost_calculations (
  id                 BIGSERIAL PRIMARY KEY,
  company_id         INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  name               VARCHAR(200),
  source_mode        VARCHAR(20) NOT NULL DEFAULT 'manual', -- 'manual' | 'vallorsoft'
  order_id           VARCHAR(50) REFERENCES orders(id) ON DELETE SET NULL,
  serial_no          VARCHAR(30) UNIQUE,
  -- referencia adat (mit használtunk a számításhoz)
  truck_vehicle_id   INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  trailer_vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  driver_ids         JSONB DEFAULT '[]'::jsonb,
  start_date         DATE,
  trip_days          INTEGER,
  trip_km            NUMERIC(12,2),
  fuel_method        VARCHAR(20), -- 'per_liter' | 'fixed'
  fuel_l_per_100km   NUMERIC(6,2),
  fuel_price_gross   NUMERIC(8,4),
  fuel_total_gross   NUMERIC(14,2),
  excisa_applied     BOOLEAN NOT NULL DEFAULT FALSE,
  fuel_discount_applied BOOLEAN NOT NULL DEFAULT FALSE,
  tolls_json         JSONB DEFAULT '[]'::jsonb,
  active_trucks      INTEGER NOT NULL DEFAULT 1,
  freight_revenue_input    NUMERIC(14,2),
  freight_revenue_currency VARCHAR(3), -- 'lei' | 'eur'
  freight_revenue_is_gross BOOLEAN NOT NULL DEFAULT TRUE,
  freight_revenue_lei      NUMERIC(14,2),
  freight_revenue_eur      NUMERIC(14,2),
  bnr_eur_lei              NUMERIC(8,4) NOT NULL,
  -- teljes eredmény (a motor visszatérése JSON-ban — a Vallorcalc resultJson-jével azonos alak)
  result_json        JSONB NOT NULL,
  saved_at           TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cc_company ON cost_calculations(company_id);
CREATE INDEX IF NOT EXISTS idx_cc_order ON cost_calculations(order_id);
CREATE INDEX IF NOT EXISTS idx_cc_saved ON cost_calculations(company_id, saved_at) WHERE saved_at IS NOT NULL;
