-- ============================================================
--  VallorSoft — 4. fázis modulok (idempotens migráció)
--  1) fuel_card_transactions — üzemanyagkártya-import (OMV/MOL/DKV/Eurowag CSV)
--  2) monthly_report_log     — havi e-mail összefoglaló küldés-napló
--  3) gps_mileage_log        — napi GPS km-óra snapshot (km-egyeztetéshez)
-- ============================================================

CREATE TABLE IF NOT EXISTS fuel_card_transactions (
  id          SERIAL PRIMARY KEY,
  company_id  INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  source      VARCHAR(30),          -- omv | mol | dkv | eurowag | egyeb
  rendszam    VARCHAR(50),
  tx_date     DATE,
  product     VARCHAR(100),
  qty_l       NUMERIC(10,2),
  amount_ron  NUMERIC(12,2),
  dedup_hash  VARCHAR(64) NOT NULL, -- forrás+rendszám+dátum+liter+összeg hash (kétszeri import ellen)
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (company_id, dedup_hash)
);
CREATE INDEX IF NOT EXISTS idx_fuelcard_company ON fuel_card_transactions(company_id, tx_date);
CREATE INDEX IF NOT EXISTS idx_fuelcard_rendszam ON fuel_card_transactions(company_id, rendszam);

CREATE TABLE IF NOT EXISTS monthly_report_log (
  company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  month      VARCHAR(7) NOT NULL,   -- 'YYYY-MM' (a riportolt hónap)
  sent_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (company_id, month)
);

CREATE TABLE IF NOT EXISTS gps_mileage_log (
  id         SERIAL PRIMARY KEY,
  company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  rendszam   VARCHAR(50) NOT NULL,
  mileage    NUMERIC(12,1) NOT NULL,
  logged_on  DATE DEFAULT CURRENT_DATE,
  UNIQUE (company_id, rendszam, logged_on)
);
CREATE INDEX IF NOT EXISTS idx_gps_mileage ON gps_mileage_log(company_id, rendszam, logged_on);
