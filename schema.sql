-- ============================================================
--  VallorSoft - Teljes adatbazis sema
--  Postgres 17 / Neon (Serverless)
--  ------------------------------------------------------------
--  Ez a fajl ket dolgot csinal:
--   1) CREATE TABLE IF NOT EXISTS  -> friss telepiteshez
--   2) ALTER TABLE ... IF NOT EXISTS -> meglevo DB frissitesehez
--  Idempotens: barhanyszor lefuttathato, nem ront el meglevo adatot.
--  A tablakat company_id alapjan szigoruan szet kell valasztani
--  (multi-tenant) - lasd a vegen levo indexeket es FK-kat.
-- ============================================================


-- ============================================================
--  1) TABLAK LETREHOZASA (friss telepites)
--     Fuggosegi sorrendben: companies -> users -> ...
-- ============================================================

-- ------------------------------------------------------------
-- CEGEK (tenants) - a multi-tenant gyoker
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS companies (
  id                  SERIAL PRIMARY KEY,
  nev                 VARCHAR(255) NOT NULL,
  igazgato_nev        VARCHAR(255),
  email_contact       VARCHAR(255),
  telefon             VARCHAR(50),
  subscription_status VARCHAR(20)  NOT NULL DEFAULT 'active'
                        CHECK (subscription_status IN ('active','inactive','cancelled','trial')),
  paid_until          DATE,
  max_users           INTEGER      NOT NULL DEFAULT 10,
  max_trucks          INTEGER      NOT NULL DEFAULT 10,
  created_at          TIMESTAMP    DEFAULT NOW()
);

-- ------------------------------------------------------------
-- FELHASZNALOK
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  nume          VARCHAR(255) NOT NULL,
  email         VARCHAR(255) NOT NULL UNIQUE,
  tel           VARCHAR(50),
  pozicio       VARCHAR(20)  NOT NULL CHECK (pozicio IN ('Admin','Manager','Sofer')),
  pozicio_dev   BOOLEAN      NOT NULL DEFAULT FALSE,  -- webfejleszto (rendszer-szintu)
  password_hash VARCHAR(255) NOT NULL,
  company_id    INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  created_at    TIMESTAMP    DEFAULT NOW()
);

-- ------------------------------------------------------------
-- MEGHIVOK (regisztracios kodok)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invites (
  id         SERIAL PRIMARY KEY,
  kod        VARCHAR(20)  NOT NULL UNIQUE,
  pozicio    VARCHAR(20)  NOT NULL CHECK (pozicio IN ('Admin','Manager','Sofer')),
  email      VARCHAR(255),
  status     VARCHAR(20)  NOT NULL DEFAULT 'Aktiv'
                CHECK (status IN ('Aktiv','Felhasznalva','Visszavonva')),
  used_by    VARCHAR(255),
  company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  created_at TIMESTAMP    DEFAULT NOW()
);

-- ------------------------------------------------------------
-- KULSO SOFOROK (cegfuggetlen partnerek nyilvantartasa)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS external_drivers (
  id               SERIAL PRIMARY KEY,
  nume             VARCHAR(255) NOT NULL,
  firma            VARCHAR(255),
  telefon          VARCHAR(50),
  email            VARCHAR(255),
  rendszam_camion  VARCHAR(50),
  rendszam_remorca VARCHAR(50),
  nota             TEXT,
  company_id       INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  created_at       TIMESTAMP DEFAULT NOW(),
  updated_at       TIMESTAMP DEFAULT NOW()
);

-- ------------------------------------------------------------
-- JARMUVEK (vontato / potkocsi)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vehicles (
  id          SERIAL PRIMARY KEY,
  rendszam    VARCHAR(50) NOT NULL,
  tip         VARCHAR(20) NOT NULL CHECK (tip IN ('Vontato','Potkocsi')),
  marca       VARCHAR(100),
  model       VARCHAR(100),
  an          INTEGER,
  nota        TEXT,
  activ       BOOLEAN     NOT NULL DEFAULT TRUE,
  company_id  INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW(),
  -- rendszam cegen belul egyedi (multi-tenant)
  CONSTRAINT uq_vehicles_company_rendszam UNIQUE (company_id, rendszam)
);

-- ------------------------------------------------------------
-- FUVARFELADATOK (Comenzi)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id                 VARCHAR(20) PRIMARY KEY,          -- pl. CMD-1234
  client             VARCHAR(255),
  ref                VARCHAR(50),
  loc_incarcare      VARCHAR(255),
  loc_descarcare     VARCHAR(255),
  data_incarcare     DATE,
  data_descarcare    DATE,
  pret               NUMERIC(10,2) DEFAULT 0,
  km                 NUMERIC(10,2) DEFAULT 0,
  sofer_type         VARCHAR(20)  CHECK (sofer_type IN ('Intern','Extern') OR sofer_type IS NULL),
  email_sofer        VARCHAR(255),
  nume_sofer         VARCHAR(255),
  firma_extern       VARCHAR(255),
  telefon_extern     VARCHAR(50),
  external_driver_id INTEGER REFERENCES external_drivers(id) ON DELETE SET NULL,
  rendszam_camion    VARCHAR(50),
  rendszam_remorca   VARCHAR(50),
  status             VARCHAR(30) NOT NULL DEFAULT 'Disponibil'
                       CHECK (status IN ('Disponibil','Alocat','Extern','In Curs','Finalizat','Anulat')),
  company_id         INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  created_at         TIMESTAMP DEFAULT NOW(),
  updated_at         TIMESTAMP DEFAULT NOW()
);

-- ------------------------------------------------------------
-- FUVAR SZAKASZOK / VALTASOK (legs)
-- Egy fuvarhoz tobb szakasz / sofervaltas tartozhat.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_legs (
  id                 SERIAL PRIMARY KEY,
  order_id           VARCHAR(20) NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  leg_number         INTEGER NOT NULL DEFAULT 1,
  sofer_type         VARCHAR(20),
  email_sofer        VARCHAR(255),
  nume_sofer         VARCHAR(255),
  firma_extern       VARCHAR(255),
  telefon_extern     VARCHAR(50),
  external_driver_id INTEGER REFERENCES external_drivers(id) ON DELETE SET NULL,
  rendszam_camion    VARCHAR(50),
  rendszam_remorca   VARCHAR(50),
  loc_preluare       VARCHAR(255),   -- atvetel helye
  data_preluare      DATE,
  loc_predare        VARCHAR(255),   -- atadas helye (opcionalis)
  data_predare       DATE,
  company_id         INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  created_at         TIMESTAMP DEFAULT NOW()
);

-- ------------------------------------------------------------
-- FUVARHOZ TARTOZO IRATOK (megrendelo PDF-ek, alairhato CMR-ek)
-- original_base64 = feltoltott; signed_base64 = alairt valtozat
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_documents (
  id              SERIAL PRIMARY KEY,
  order_id        VARCHAR(20) NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  file_name       VARCHAR(255),
  original_base64 TEXT,
  signed_base64   TEXT,
  uploaded_by     VARCHAR(255),
  company_id      INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);

-- ------------------------------------------------------------
-- HETI FUVARLEVELEK (Menetlevelek)
-- Cegszures a sofor (email_sofer) -> users.company_id joinon keresztul.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fuvarlevelek (
  id                VARCHAR(20) PRIMARY KEY,
  file_name         VARCHAR(255),
  data_completare   TIMESTAMP DEFAULT NOW(),
  email_sofer       VARCHAR(255),
  nume_sofer        VARCHAR(255),
  numar_camion      VARCHAR(50),
  numar_remorca     VARCHAR(50),
  numar_fisa        VARCHAR(50),
  cursa_saptamanii  VARCHAR(255),
  km_inceput        NUMERIC(10,2) DEFAULT 0,
  km_sfarsit        NUMERIC(10,2) DEFAULT 0,
  total_km          NUMERIC(10,2) DEFAULT 0,
  loc_plecare       VARCHAR(255),
  loc_sosire        VARCHAR(255),
  loc_desc_tur      VARCHAR(255),
  loc_inc_retur     VARCHAR(255),
  diurna_externa    INTEGER DEFAULT 0,
  diurna_interna    INTEGER DEFAULT 0,
  cant_inceput      NUMERIC(10,2) DEFAULT 0,
  cant_sfarsit      NUMERIC(10,2) DEFAULT 0,
  motorina_folosit  NUMERIC(10,2) DEFAULT 0,
  total_alim        NUMERIC(10,2) DEFAULT 0,
  consum_100        NUMERIC(10,2) DEFAULT 0,
  alte_mentiuni     TEXT,
  alimentari        JSONB DEFAULT '[]'::jsonb,
  achizitii         JSONB DEFAULT '[]'::jsonb,
  tranzite          JSONB DEFAULT '[]'::jsonb,
  puncte            JSONB DEFAULT '[]'::jsonb,
  order_ids         JSONB DEFAULT '[]'::jsonb
);

-- ------------------------------------------------------------
-- HATARATLEPESEK (GPS be/ki)
-- Cegszures users.company_id joinon keresztul.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS border_crossings (
  id          SERIAL PRIMARY KEY,
  email_sofer VARCHAR(255),
  nume_sofer  VARCHAR(255),
  tip         VARCHAR(20),       -- 'Intrare' / 'Iesire'
  tara        VARCHAR(50),
  locatie     VARCHAR(255),
  gps_lat     NUMERIC(10,6),
  gps_lng     NUMERIC(10,6),
  created_at  TIMESTAMP DEFAULT NOW()
);

-- ------------------------------------------------------------
-- DOKUMENTUMOK (sofor altal feltoltott fotok / CMR-ek)
-- Cegszures users.company_id joinon keresztul.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS documents (
  id          SERIAL PRIMARY KEY,
  email_sofer VARCHAR(255),
  nume_sofer  VARCHAR(255),
  tip         VARCHAR(50),
  file_name   VARCHAR(255),
  storage_url TEXT,             -- base64 vagy kulso URL
  created_at  TIMESTAMP DEFAULT NOW()
);

-- ------------------------------------------------------------
-- CHAT UZENETEK (DB-s mentes - a realtime Firebase-en megy)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
  id          SERIAL PRIMARY KEY,
  from_email  VARCHAR(255),
  from_name   VARCHAR(255),
  to_email    VARCHAR(255),
  message     TEXT,
  tip         VARCHAR(20) DEFAULT 'Normal',
  created_at  TIMESTAMP DEFAULT NOW()
);

-- ------------------------------------------------------------
-- ALAIRASOK / BELYEGZOK (felhasznalonkent)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stamps (
  email       VARCHAR(255) PRIMARY KEY,
  base64_png  TEXT,
  updated_at  TIMESTAMP DEFAULT NOW()
);

-- ------------------------------------------------------------
-- (LEGACY) Rendelkezesre allo fuvarok - jelenleg nem hasznalt.
-- Megtartva kompatibilitasi okokbol; nyugodtan torolheto.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS available_orders (
  id              VARCHAR(20) PRIMARY KEY,
  client          VARCHAR(255),
  loc_incarcare   VARCHAR(255),
  loc_descarcare  VARCHAR(255),
  pret            NUMERIC(10,2) DEFAULT 0,
  km              NUMERIC(10,2) DEFAULT 0,
  ref             VARCHAR(50),
  status          VARCHAR(30) DEFAULT 'Disponibil',
  created_at      TIMESTAMP DEFAULT NOW()
);


-- ============================================================
--  2) MIGRACIOK - meglevo DB biztonsagos frissitese
--     Mind idempotens (IF NOT EXISTS). Nem rontja a meglevo adatot.
-- ============================================================

-- users
ALTER TABLE users ADD COLUMN IF NOT EXISTS company_id  INTEGER;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pozicio_dev BOOLEAN NOT NULL DEFAULT FALSE;

-- invites
ALTER TABLE invites ADD COLUMN IF NOT EXISTS company_id INTEGER;
ALTER TABLE invites ADD COLUMN IF NOT EXISTS used_by    VARCHAR(255);

-- external_drivers
ALTER TABLE external_drivers ADD COLUMN IF NOT EXISTS company_id INTEGER;
ALTER TABLE external_drivers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

-- vehicles
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS activ      BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS company_id INTEGER;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

-- orders (a kulcs javitas: company_id + a tobbi uj mezo)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS data_incarcare     DATE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS data_descarcare    DATE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS sofer_type         VARCHAR(20);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS firma_extern       VARCHAR(255);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS telefon_extern     VARCHAR(50);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS external_driver_id INTEGER;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS rendszam_camion    VARCHAR(50);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS rendszam_remorca   VARCHAR(50);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS company_id         INTEGER;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMP DEFAULT NOW();

-- order_legs
ALTER TABLE order_legs ADD COLUMN IF NOT EXISTS company_id   INTEGER;
ALTER TABLE order_legs ADD COLUMN IF NOT EXISTS loc_predare  VARCHAR(255);
ALTER TABLE order_legs ADD COLUMN IF NOT EXISTS data_predare DATE;

-- order_documents
ALTER TABLE order_documents ADD COLUMN IF NOT EXISTS signed_base64 TEXT;
ALTER TABLE order_documents ADD COLUMN IF NOT EXISTS company_id    INTEGER;
ALTER TABLE order_documents ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMP DEFAULT NOW();


-- ============================================================
--  3) INDEXEK (gyors keres + company szerinti szures)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_users_email            ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_company          ON users(company_id);
CREATE INDEX IF NOT EXISTS idx_invites_company        ON invites(company_id);
CREATE INDEX IF NOT EXISTS idx_extdrivers_company     ON external_drivers(company_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_company       ON vehicles(company_id);
CREATE INDEX IF NOT EXISTS idx_orders_company         ON orders(company_id);
CREATE INDEX IF NOT EXISTS idx_orders_email_sofer     ON orders(email_sofer);
CREATE INDEX IF NOT EXISTS idx_orders_status          ON orders(status);
CREATE INDEX IF NOT EXISTS idx_order_legs_order       ON order_legs(order_id);
CREATE INDEX IF NOT EXISTS idx_order_legs_company     ON order_legs(company_id);
CREATE INDEX IF NOT EXISTS idx_orderdocs_order        ON order_documents(order_id);
CREATE INDEX IF NOT EXISTS idx_orderdocs_company      ON order_documents(company_id);
CREATE INDEX IF NOT EXISTS idx_fuvarlevelek_email     ON fuvarlevelek(email_sofer);
CREATE INDEX IF NOT EXISTS idx_messages_emails        ON messages(from_email, to_email);
CREATE INDEX IF NOT EXISTS idx_border_email           ON border_crossings(email_sofer);
CREATE INDEX IF NOT EXISTS idx_documents_email        ON documents(email_sofer);


-- ============================================================
--  4) OPCIONALIS: idegen kulcsok hozzaadasa meglevo DB-hez
--     CSAK akkor futtasd, ha mar nincs arva (NULL/nem letezo)
--     hivatkozas - kulonben a constraint letrehozasa elbukik.
--     Friss telepitesnel ezek mar a CREATE TABLE-bol jonnek.
-- ============================================================
DO $$
BEGIN
  -- users.company_id -> companies(id)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_company') THEN
    ALTER TABLE users ADD CONSTRAINT fk_users_company
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL;
  END IF;

  -- orders.company_id -> companies(id)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_orders_company') THEN
    ALTER TABLE orders ADD CONSTRAINT fk_orders_company
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
  END IF;

  -- order_legs.order_id -> orders(id)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_legs_order') THEN
    ALTER TABLE order_legs ADD CONSTRAINT fk_legs_order
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
  END IF;

  -- order_documents.order_id -> orders(id)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_docs_order') THEN
    ALTER TABLE order_documents ADD CONSTRAINT fk_docs_order
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
  END IF;
END $$;


-- ============================================================
--  5) ADAT-BACKFILL (a "eltunt" fuvarok visszahozasa)
--     A regi, company_id = NULL fuvarokat ujra cseghez kotjuk.
-- ============================================================

-- 5/a) Intern fuvarok: a kiosztott sofor cege alapjan
UPDATE orders o
SET company_id = u.company_id
FROM users u
WHERE o.company_id IS NULL
  AND o.email_sofer IS NOT NULL
  AND LOWER(o.email_sofer) = LOWER(u.email);

-- 5/b) Szakaszok: a szulo fuvar cege alapjan
UPDATE order_legs l
SET company_id = o.company_id
FROM orders o
WHERE l.company_id IS NULL
  AND l.order_id = o.id;

-- 5/c) Maradek arva fuvarok - CSAK egy ceg eseten futtasd!
--      Tobb ceg eseten egyesevel, id szerint rendezd hozza.
--      Elobb: SELECT id, nev FROM companies;

-- ------------------------------------------------------------
-- PUSH SUBSCRIPTIONS (Web Push ertesitesek)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         SERIAL PRIMARY KEY,
  email      VARCHAR(255) NOT NULL,
  company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  subscription JSONB NOT NULL,
  user_agent VARCHAR(500),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(email, subscription)
);
CREATE INDEX IF NOT EXISTS idx_push_subs_email ON push_subscriptions(email);
CREATE INDEX IF NOT EXISTS idx_push_subs_company ON push_subscriptions(company_id);

ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS endpoint_hash VARCHAR(64);

-- ------------------------------------------------------------
-- 2FA (ketlepeses hitelesites) - TOTP
-- ------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret VARCHAR(64);
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_backup_codes JSONB;