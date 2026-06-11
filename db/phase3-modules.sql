-- ============================================================
--  VallorSoft — 3. fázis modulok (idempotens migráció)
--  1) clients.payment_term_days  — ügyfél fizetési határidő (kintlévőség-lejárat)
--  2) documents.order_id         — sofőr-fotó (POD/CMR) fuvarhoz kötése
--  3) companies.diurna_*_rate    — diurna napidíj-ráták (sofőr-elszámolás)
--  4) document_expiries          — lejárat-figyelés (ITP/RCA/rovinietă/tahográf...)
--  5) driver_advances            — sofőr-előlegek (decont)
--  6) vehicle_service_log        — szerviz & karbantartás napló
-- ============================================================

ALTER TABLE clients   ADD COLUMN IF NOT EXISTS payment_term_days INTEGER;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS order_id VARCHAR(20);
CREATE INDEX IF NOT EXISTS idx_documents_order ON documents(order_id);

ALTER TABLE companies ADD COLUMN IF NOT EXISTS diurna_ext_rate NUMERIC(10,2);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS diurna_int_rate NUMERIC(10,2);

-- Lejárat-figyelés: jármű- vagy sofőr-dokumentumok érvényessége.
-- A scheduler naponta ellenőrzi és push-riasztást küld az Admin/Manager
-- felhasználóknak (alert_days nappal a lejárat előtt, hetente ismételve).
CREATE TABLE IF NOT EXISTS document_expiries (
  id            SERIAL PRIMARY KEY,
  company_id    INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  entity_type   VARCHAR(10) NOT NULL DEFAULT 'vehicle',  -- vehicle | driver | company
  entity_label  VARCHAR(255),                            -- rendszám VAGY sofőr neve
  doc_type      VARCHAR(60) NOT NULL,                    -- ITP, RCA, CASCO, Rovinieta, ...
  expiry_date   DATE NOT NULL,
  alert_days    INTEGER DEFAULT 30,
  note          TEXT,
  last_alert_at DATE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_doc_expiries_company ON document_expiries(company_id, expiry_date);

-- Sofőr-előlegek (decont): a kiadott kassza/kártya-feltöltés nyilvántartása.
CREATE TABLE IF NOT EXISTS driver_advances (
  id          SERIAL PRIMARY KEY,
  company_id  INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  email_sofer VARCHAR(255) NOT NULL,
  amount      NUMERIC(12,2) NOT NULL,
  currency    VARCHAR(5) DEFAULT 'RON',
  given_at    DATE DEFAULT CURRENT_DATE,
  note        TEXT,
  created_by  VARCHAR(255),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_driver_advances ON driver_advances(company_id, email_sofer, given_at);

-- Szerviz & karbantartás napló (jármű-költségek + km/dátum-alapú emlékeztető).
CREATE TABLE IF NOT EXISTS vehicle_service_log (
  id            SERIAL PRIMARY KEY,
  company_id    INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  vehicle_id    INTEGER REFERENCES vehicles(id) ON DELETE CASCADE,
  service_date  DATE DEFAULT CURRENT_DATE,
  km            INTEGER,
  category      VARCHAR(30) DEFAULT 'javitas',  -- olajcsere|gumi|javitas|karbantartas|egyeb
  description   TEXT,
  cost_ron      NUMERIC(12,2),
  next_due_date DATE,
  next_due_km   INTEGER,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_service_log ON vehicle_service_log(company_id, vehicle_id, service_date);
