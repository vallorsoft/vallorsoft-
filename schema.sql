-- ===========================================
--  VallorSoft - Adatbazis sema
--  Postgres 17 / Neon
-- ===========================================

-- 1. FELHASZNALOK
CREATE TABLE IF NOT EXISTS users (
  id           SERIAL PRIMARY KEY,
  nume         VARCHAR(255) NOT NULL,
  email        VARCHAR(255) NOT NULL UNIQUE,
  tel          VARCHAR(50),
  pozicio      VARCHAR(20) NOT NULL CHECK (pozicio IN ('Admin','Manager','Sofer')),
  password_hash VARCHAR(255) NOT NULL,
  created_at   TIMESTAMP DEFAULT NOW()
);

-- 2. MEGHIVOK
CREATE TABLE IF NOT EXISTS invites (
  id         SERIAL PRIMARY KEY,
  kod        VARCHAR(20) NOT NULL UNIQUE,
  pozicio    VARCHAR(20) NOT NULL CHECK (pozicio IN ('Admin','Manager','Sofer')),
  email      VARCHAR(255),
  status     VARCHAR(20) DEFAULT 'Aktiv',
  used_by    VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW()
);

-- 3. FUVARFELADATOK (Comenzi)
CREATE TABLE IF NOT EXISTS orders (
  id              VARCHAR(20) PRIMARY KEY,
  client          VARCHAR(255),
  loc_incarcare   VARCHAR(255),
  loc_descarcare  VARCHAR(255),
  pret            NUMERIC(10,2) DEFAULT 0,
  km              NUMERIC(10,2) DEFAULT 0,
  ref             VARCHAR(50),
  email_sofer     VARCHAR(255),
  nume_sofer      VARCHAR(255),
  status          VARCHAR(30) DEFAULT 'Alocat',
  created_at      TIMESTAMP DEFAULT NOW()
);

-- 4. RENDELKEZESRE ALLO FUVARFELADATOK (Comenzi Disponibile)
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

-- 5. HETI FUVARLEVELEK (Adatbazis)
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
  tranzite          JSONB DEFAULT '[]'::jsonb
);

-- 6. HATARATLEPESEK
CREATE TABLE IF NOT EXISTS border_crossings (
  id          SERIAL PRIMARY KEY,
  email_sofer VARCHAR(255),
  nume_sofer  VARCHAR(255),
  tip         VARCHAR(20),
  tara        VARCHAR(50),
  locatie     VARCHAR(255),
  gps_lat     NUMERIC(10,6),
  gps_lng     NUMERIC(10,6),
  created_at  TIMESTAMP DEFAULT NOW()
);

-- 7. DOKUMENTUMOK (feltoltott fotok)
CREATE TABLE IF NOT EXISTS documents (
  id          SERIAL PRIMARY KEY,
  email_sofer VARCHAR(255),
  nume_sofer  VARCHAR(255),
  tip         VARCHAR(50),
  file_name   VARCHAR(255),
  storage_url TEXT,
  created_at  TIMESTAMP DEFAULT NOW()
);

-- 8. CHAT UZENETEK
CREATE TABLE IF NOT EXISTS messages (
  id           SERIAL PRIMARY KEY,
  from_email   VARCHAR(255),
  from_name    VARCHAR(255),
  to_email     VARCHAR(255),
  message      TEXT,
  tip          VARCHAR(20) DEFAULT 'Normal',
  created_at   TIMESTAMP DEFAULT NOW()
);

-- 9. ALAIRASOK / BELYEGZOK
CREATE TABLE IF NOT EXISTS stamps (
  email       VARCHAR(255) PRIMARY KEY,
  base64_png  TEXT,
  updated_at  TIMESTAMP DEFAULT NOW()
);

-- 9. MEGRENDELO DOKUMENTUMOK (Order Documents)
CREATE TABLE IF NOT EXISTS order_documents (
  id            SERIAL PRIMARY KEY,
  order_id      VARCHAR(20) NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  file_name     VARCHAR(255) NOT NULL,
  original_b64  TEXT NOT NULL,
  signed_b64    TEXT,
  uploaded_by   VARCHAR(255),
  created_at    TIMESTAMP DEFAULT NOW(),
  signed_at     TIMESTAMP
);

-- INDEXEK A GYORS KERESESHEZ
CREATE INDEX IF NOT EXISTS idx_orderdocs_order ON order_documents(order_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_orders_email_sofer ON orders(email_sofer);
CREATE INDEX IF NOT EXISTS idx_fuvarlevelek_email ON fuvarlevelek(email_sofer);
CREATE INDEX IF NOT EXISTS idx_messages_emails ON messages(from_email, to_email);
CREATE INDEX IF NOT EXISTS idx_border_email ON border_crossings(email_sofer);
CREATE INDEX IF NOT EXISTS idx_documents_email ON documents(email_sofer);