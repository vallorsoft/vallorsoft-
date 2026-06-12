-- ============================================================
--  VallorSoft — Alvállalkozó (carrier) + szállítói számla (AP)
--  + alvállalkozói portál (idempotens)
--  A pénzügyi zárás kötelezettség-oldala: mennyivel tartozol a külsős
--  fuvarozóknak. Plusz az alvállalkozó saját belépéssel látja a rá osztott
--  fuvarokat/dokumentumokat, feltölt, és a saját autóját felviszi.
-- ============================================================

-- Alvállalkozó-törzs
CREATE TABLE IF NOT EXISTS carriers (
  id                   SERIAL PRIMARY KEY,
  company_id           INTEGER NOT NULL,
  nev                  VARCHAR(255) NOT NULL,
  cui                  VARCHAR(40),
  email                VARCHAR(255),
  telefon              VARCHAR(50),
  iban                 VARCHAR(40),
  payment_term_days    INTEGER DEFAULT 30,
  cmr_insurance_expiry DATE,
  aktiv                BOOLEAN NOT NULL DEFAULT TRUE,
  nota                 TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_carriers_company ON carriers (company_id);

-- Szállítói számlák (AP) — egy vagy több fuvarhoz kötve
CREATE TABLE IF NOT EXISTS carrier_invoices (
  id             SERIAL PRIMARY KEY,
  company_id     INTEGER NOT NULL,
  carrier_id     INTEGER NOT NULL,
  invoice_number VARCHAR(80),
  issue_date     DATE,
  due_date       DATE,
  amount         NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency       VARCHAR(3) NOT NULL DEFAULT 'EUR',
  status         VARCHAR(10) NOT NULL DEFAULT 'unpaid',   -- unpaid | partial | paid
  paid_amount    NUMERIC(12,2) NOT NULL DEFAULT 0,
  paid_at        TIMESTAMPTZ,
  order_ids      JSONB DEFAULT '[]'::jsonb,
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_carrier_inv_company ON carrier_invoices (company_id, status);

-- Fuvar ↔ alvállalkozó + költség (amit az alvállalkozónak fizetünk)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS carrier_id   INTEGER;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS carrier_cost NUMERIC(12,2);

-- Alvállalkozói portál-felhasználók (külön az users/client_users tábláktól)
CREATE TABLE IF NOT EXISTS carrier_users (
  id             SERIAL PRIMARY KEY,
  company_id     INTEGER NOT NULL,
  carrier_id     INTEGER NOT NULL,
  email          VARCHAR(255) NOT NULL,
  pass_hash      TEXT,
  nev            VARCHAR(255),
  activ          BOOLEAN NOT NULL DEFAULT TRUE,
  invite_token   VARCHAR(80),
  invite_expires TIMESTAMPTZ,
  last_login     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_carrier_users_email ON carrier_users (LOWER(email));

-- Az alvállalkozó által felvitt saját jármű(vek)
CREATE TABLE IF NOT EXISTS carrier_vehicles (
  id               SERIAL PRIMARY KEY,
  company_id       INTEGER NOT NULL,
  carrier_id       INTEGER NOT NULL,
  rendszam_camion  VARCHAR(50),
  rendszam_remorca VARCHAR(50),
  marca            VARCHAR(80),
  model            VARCHAR(80),
  nota             TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_carrier_veh ON carrier_vehicles (company_id, carrier_id);

-- Alvállalkozói dokumentumok (cég-szintű VAGY fuvarhoz kötött; a portálról is)
CREATE TABLE IF NOT EXISTS carrier_documents (
  id          SERIAL PRIMARY KEY,
  company_id  INTEGER NOT NULL,
  carrier_id  INTEGER NOT NULL,
  order_id    VARCHAR(20),
  file_name   VARCHAR(255),
  mime        VARCHAR(100),
  data_base64 TEXT,
  kind        VARCHAR(30),            -- insurance | contract | cmr | invoice | other
  uploaded_by VARCHAR(255),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_carrier_docs ON carrier_documents (company_id, carrier_id);
