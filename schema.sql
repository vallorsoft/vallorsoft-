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

-- ------------------------------------------------------------
-- BUG REPORTS (Hibajelentések)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bug_reports (
  id          SERIAL PRIMARY KEY,
  company_id  INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  user_email  VARCHAR(255),
  user_name   VARCHAR(255),
  user_role   VARCHAR(50),
  szoveg      TEXT NOT NULL,
  oldal       VARCHAR(100),
  is_read     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bug_reports_company ON bug_reports(company_id);
CREATE INDEX IF NOT EXISTS idx_bug_reports_read    ON bug_reports(is_read);

-- ============================================================
--  DRIVER SHIFTS (Muszak / GPS sprint - 1. feladat)
--  EU 561/2006 vezetesi-pihenoido szabalyok kovetese.
--  Egy rekord = egy munkanap (shift). Egy sofornek egyszerre
--  csak EGY elo (nem-INACTIVE) shiftje lehet.
-- ============================================================
CREATE TABLE IF NOT EXISTS driver_shifts (
  shift_id              SERIAL PRIMARY KEY,

  -- Sofor azonositok (FK + redundans email a meglevo konvencio miatt)
  driver_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  driver_email          VARCHAR(255) NOT NULL,
  company_id            INTEGER REFERENCES companies(id) ON DELETE CASCADE,

  -- Eletciklus allapot
  status                VARCHAR(20)  NOT NULL DEFAULT 'INACTIVE'
                          CHECK (status IN ('INACTIVE','ACTIVE','PAUSED','REST','SCHEDULED')),

  -- Nap kezdes / zaras
  day_started_at        TIMESTAMP,
  day_closed_at         TIMESTAMP,

  -- Szunet kezelese
  paused_at             TIMESTAMP,                    -- utolso szunet kezdete
  paused_total_minutes  INTEGER NOT NULL DEFAULT 0,   -- shift osszes szunet-ideje (statisztikahoz)

  -- Piheno tipus es idotartam
  -- 9h/11h: napi piheno (csokkentett/normal)
  -- 24h/45h: heti piheno (csokkentett/rendes)
  -- custom: sofor altal megadott egesz orak (1,2,3,4,5...)
  -- vacation: szabadsag (datum + ora, perc nelkul)
  rest_type             VARCHAR(20)
                          CHECK (rest_type IS NULL OR rest_type IN ('9h','11h','24h','45h','custom','vacation')),
  rest_hours            NUMERIC(6,2),                 -- custom/vacation eseten az orak szama
  next_shift_start      TIMESTAMP,                    -- tervezett kovetkezo muszak kezdes

  -- Audit / metaadat
  notes                 TEXT,
  created_at            TIMESTAMP DEFAULT NOW(),
  updated_at            TIMESTAMP DEFAULT NOW(),

  -- ----- Integritasi constraintek -----
  CONSTRAINT chk_shift_closed_after_started
    CHECK (day_closed_at IS NULL OR day_started_at IS NULL OR day_closed_at >= day_started_at),

  -- LAZA fels keret: 24 ora alatt minden valós muszak. Tovabb mar lehetetlen ertek.
  CONSTRAINT chk_shift_max_24h
    CHECK (day_closed_at IS NULL OR day_started_at IS NULL
           OR EXTRACT(EPOCH FROM (day_closed_at - day_started_at)) <= 24 * 3600),

  -- Rest_hours csak custom/vacation eseten kotelezo
  CONSTRAINT chk_rest_hours_when_custom
    CHECK (rest_type IS NULL OR rest_type NOT IN ('custom','vacation') OR rest_hours IS NOT NULL)
);


-- ============================================================
--  INDEXEK (driver_shifts)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_shifts_driver_id      ON driver_shifts(driver_id);
CREATE INDEX IF NOT EXISTS idx_shifts_driver_email   ON driver_shifts(driver_email);
CREATE INDEX IF NOT EXISTS idx_shifts_company        ON driver_shifts(company_id);
CREATE INDEX IF NOT EXISTS idx_shifts_status         ON driver_shifts(status);
CREATE INDEX IF NOT EXISTS idx_shifts_day_started    ON driver_shifts(day_started_at DESC);

-- KRITIKUS: csak egy elo shift / sofor (data integrity)
-- A 'INACTIVE' (lezart, tortneti) rekordok nem szamitanak.
CREATE UNIQUE INDEX IF NOT EXISTS uq_shifts_one_active_per_driver
  ON driver_shifts(driver_id)
  WHERE status IN ('ACTIVE','PAUSED','REST','SCHEDULED');


-- ============================================================
--  MIGRACIO: meglevo telepitesre - idempotens
--  (Ha mar letezik a tabla regebbi verzioja, ez frissiti.)
-- ============================================================
ALTER TABLE driver_shifts ADD COLUMN IF NOT EXISTS paused_total_minutes  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE driver_shifts ADD COLUMN IF NOT EXISTS rest_hours            NUMERIC(6,2);
ALTER TABLE driver_shifts ADD COLUMN IF NOT EXISTS notes                 TEXT;
ALTER TABLE driver_shifts ADD COLUMN IF NOT EXISTS updated_at            TIMESTAMP DEFAULT NOW();

-- ------------------------------------------------------------
-- DOKUMENTUM SOROZATSZÁMOK (menetlevél MT, jövőbeli típusok)
-- Admin/Manager beállítja a prefix-et, rendszer számolja a seq-t
-- Ha új prefix-et adnak meg, seq visszaáll 0-ra
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS document_series (
  id          SERIAL PRIMARY KEY,
  company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  doc_type    VARCHAR(20) NOT NULL DEFAULT 'MT',
  prefix      VARCHAR(20) NOT NULL DEFAULT 'MT',
  year        INTEGER     NOT NULL,
  current_seq INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW(),
  UNIQUE(company_id, doc_type, year)
);

-- Meghívó: opcionális név és telefonszám
ALTER TABLE invites ADD COLUMN IF NOT EXISTS nume VARCHAR(255);
ALTER TABLE invites ADD COLUMN IF NOT EXISTS tel  VARCHAR(50);

-- ============================================================
-- INTEGRACIOK (Ugyfelek / CargoTrack GPS / Szamlazas)
-- Forras: db/integrations.sql (idempotens, CREATE ... IF NOT EXISTS)
-- ============================================================
-- db/integrations.sql — minden integrációs tábla egyben
-- Futtatás: psql "$DATABASE_URL" -f db/integrations.sql  (vagy másold a schema.sql-be)

-- ===== company_integrations + vehicle_gps_map =====
-- cargotrack-migration.sql
-- Általános integráció-tároló (CargoTrack, Fomco, FGO, SmartBill, ... mind ide kerül).
-- A hitelesítő adat TITKOSÍTVA tárolódik (crypto-util.js), soha nem nyíltan.

CREATE TABLE IF NOT EXISTS company_integrations (
    id              SERIAL PRIMARY KEY,
    company_id      INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    provider        TEXT    NOT NULL,            -- 'cargotrack' | 'fomco' | 'fgo' | 'smartbill' | ...
    category        TEXT    NOT NULL,            -- 'gps' | 'invoicing'
    enabled         BOOLEAN NOT NULL DEFAULT false,
    credentials_enc TEXT,                         -- AES-256-GCM titkosított kulcs/credential
    status          TEXT    DEFAULT 'disconnected', -- 'connected' | 'error' | 'disconnected'
    status_message  TEXT,
    last_check      TIMESTAMPTZ,
    meta            JSONB   DEFAULT '{}'::jsonb,   -- pl. { "objectCount": 12 }
    updated_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE (company_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_company_integrations_company
    ON company_integrations (company_id);

-- Opcionális: rendszám <-> GPS object_id párosítás (a járművek összekötéséhez).
-- Egyelőre a pozíció-lekérés object_id-vel is megy; ezt akkor töltjük, ha a felületen párosítunk.
CREATE TABLE IF NOT EXISTS vehicle_gps_map (
    id          SERIAL PRIMARY KEY,
    company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    provider    TEXT    NOT NULL DEFAULT 'cargotrack',
    rendszam    TEXT    NOT NULL,
    object_id   TEXT    NOT NULL,
    object_name TEXT,
    updated_at  TIMESTAMPTZ DEFAULT now(),
    UNIQUE (company_id, provider, rendszam)
);

-- ===== invoices =====
-- invoicing-migration.sql
-- Számlák tárolása. A számlázó-hitelesítő adatok + beállítások a company_integrations táblába kerülnek
-- (category='invoicing', credentials_enc = titkosított {CodUnic, PrivateKey}, meta = serie/vat_payer/...).
-- Ehhez a company_integrations táblának léteznie kell (lásd cargotrack-migration.sql).

CREATE TABLE IF NOT EXISTS invoices (
    id               SERIAL PRIMARY KEY,
    company_id       INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    order_id         TEXT,                       -- orders.id (CMD-xxxx, VARCHAR)
    provider         TEXT    NOT NULL,           -- 'fgo' | 'smartbill' | 'oblio' | ...
    serie            TEXT,
    numar            TEXT,
    total            NUMERIC(12,2),
    valuta           TEXT DEFAULT 'RON',
    tva              NUMERIC(6,2),
    pdf_link         TEXT,
    status           TEXT DEFAULT 'issued',      -- 'issued' | 'error' | 'cancelled'
    provider_message TEXT,
    efactura_status  TEXT,                        -- ha a szolgáltató API-n adja (tisztázandó)

    -- ÜGYFÉL-PILLANATKÉP a kiállítás idejéből (utólagos ügyfél-módosítás nem írja át)
    client_name      TEXT,
    client_cui       TEXT,
    client_tip       TEXT,
    client_address   TEXT,

    payload          JSONB,                       -- a beküldött számla (audithoz)
    created_by       INTEGER,
    created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoices_company_order ON invoices (company_id, order_id);
CREATE INDEX IF NOT EXISTS idx_invoices_company_created ON invoices (company_id, created_at DESC);

-- ===== clients =====
-- clients-migration.sql
-- Ügyfelek (számlázáshoz). Önálló — nem módosít meglévő logikát.

CREATE TABLE IF NOT EXISTS clients (
    id                SERIAL PRIMARY KEY,
    company_id        INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    denumire          TEXT    NOT NULL,           -- cég/ügyfél neve (kötelező)
    tip               TEXT    DEFAULT 'PJ',        -- 'PJ' (cég) | 'PF' (magánszemély)
    cui_cif           TEXT,
    reg_com           TEXT,
    tara              TEXT    DEFAULT 'RO',
    judet             TEXT,
    localitate        TEXT,
    adresa            TEXT,
    email             TEXT,
    telefon           TEXT,
    iban              TEXT,
    banca             TEXT,
    default_tva       NUMERIC(6,2),
    valuta            TEXT    DEFAULT 'RON',
    nota              TEXT,
    complet_facturare BOOLEAN DEFAULT false,       -- számlázáshoz elég adat van-e
    anaf_status       TEXT,                         -- 'activ' | 'inactiv' | NULL
    anaf_last_check   TIMESTAMPTZ,
    created_at        TIMESTAMPTZ DEFAULT now(),
    updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clients_company ON clients (company_id);
CREATE INDEX IF NOT EXISTS idx_clients_company_name ON clients (company_id, denumire);

-- ----------------------------------------------------------------------------
-- OPCIONÁLIS — csak amikor a fuvart összekötöd az ügyféllel (1/B).
-- Önmagában ártalmatlan (nullable), de a fuvar-mentő kódnak ezután be kell
-- állítania a client_id-t. Addig a szöveges `client` mező marad fallbacknek.
-- ----------------------------------------------------------------------------
-- ALTER TABLE orders ADD COLUMN IF NOT EXISTS client_id INTEGER REFERENCES clients(id);
-- CREATE INDEX IF NOT EXISTS idx_orders_client ON orders (client_id);


-- ============================================================
-- RO e-Transport UIT-kódok (db/uit-migration.sql)
-- ============================================================
-- db/uit-migration.sql
-- RO e-Transport UIT-kódok fuvaronként. Egy fuvarhoz TÖBB UIT tartozhat.
-- A UIT-ot az ANAF generálja (a megbízó deklarációjára); itt a KAPOTT kódot
-- rögzítjük, és a járműhöz/GPS-eszközhöz rendeljük (CargoTrack), majd a transport
-- végén leállítjuk a küldést.
-- Futtatás:  psql "$DATABASE_URL" -f db/uit-migration.sql

CREATE TABLE IF NOT EXISTS order_uit_codes (
    id            SERIAL PRIMARY KEY,
    company_id    INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    order_id      VARCHAR(20) NOT NULL,             -- orders.id (CMD-xxxx)
    uit_code      TEXT    NOT NULL,                 -- az ANAF-tól kapott UIT
    rendszam      TEXT,                             -- melyik jármű (alapból a fuvar vontatója)
    object_id     TEXT,                             -- CargoTrack/FM-Track GPS object_id (ha párosítva)
    provider      TEXT    NOT NULL DEFAULT 'cargotrack',
    status        TEXT    NOT NULL DEFAULT 'new',   -- 'new' | 'active' | 'stopped' | 'error'
    valid_until   DATE,                             -- UIT lejárat (belföld 5 / nemzetközi 15 nap)
    last_message  TEXT,                             -- utolsó visszajelzés a szolgáltatótól
    sent_at       TIMESTAMPTZ,                      -- mikor indult a küldés
    stopped_at    TIMESTAMPTZ,                      -- mikor lett leállítva
    created_by    INTEGER,
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now(),
    UNIQUE (company_id, order_id, uit_code)
);

CREATE INDEX IF NOT EXISTS idx_uit_company_order ON order_uit_codes (company_id, order_id);

-- UIT ANAF-visszaigazolás oszlopok (db/uit-anaf-confirm.sql)
-- db/uit-anaf-confirm.sql
-- Meglévő telepítéshez: az ANAF-visszaigazolás oszlopok hozzáadása az order_uit_codes-hoz.
-- (Friss telepítésnél a uit-migration.sql már tartalmazza ezeket.)
-- Futtatás:  psql "$DATABASE_URL" -f db/uit-anaf-confirm.sql

ALTER TABLE order_uit_codes ADD COLUMN IF NOT EXISTS anaf_confirmed    BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE order_uit_codes ADD COLUMN IF NOT EXISTS anaf_confirmed_at TIMESTAMPTZ;

-- Beérkező megrendelések (db/inbound-orders-migration.sql)
-- db/inbound-orders-migration.sql
-- Beérkező megrendelések (e-mail → OCR/AI → mezők) staging tábla.
-- A jóváhagyott megrendelésből valódi orders rekord lesz (status 'Disponibil' vagy 'Alocat').
-- Futtatás:  psql "$DATABASE_URL" -f db/inbound-orders-migration.sql

CREATE TABLE IF NOT EXISTS inbound_orders (
    id            SERIAL PRIMARY KEY,
    company_id    INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    source_email  TEXT,                 -- feladó
    subject       TEXT,
    received_at   TIMESTAMPTZ,
    message_uid   TEXT,                 -- IMAP UID (duplikátum-szűrés)
    raw_text      TEXT,                 -- a levél/PDF kinyert szövege
    pdf_name      TEXT,
    pdf_data      BYTEA,                -- az eredeti melléklet (megnyitáshoz)
    extracted     JSONB DEFAULT '{}',   -- AI/heurisztika által kiolvasott mezők
    confidence    NUMERIC,              -- 0..1 (kiemeléshez)
    ai_used       BOOLEAN DEFAULT FALSE,
    status        TEXT NOT NULL DEFAULT 'new',  -- new | parsed | reviewed | approved | rejected
    created_order_id VARCHAR(20),       -- a létrejött orders.id (jóváhagyás után)
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now(),
    UNIQUE (company_id, message_uid)
);

CREATE INDEX IF NOT EXISTS idx_inbound_company_status ON inbound_orders (company_id, status, received_at DESC);

-- Branding (logó), e-mail sablonok, kliens-e-mail napló (db/email-branding-migration.sql)
-- db/email-branding-migration.sql
-- Cég-logó (branding), e-mail sablonok, és kimenő kliens-e-mailek naplója.
-- Futtatás:  psql "$DATABASE_URL" -f db/email-branding-migration.sql

-- Cégenkénti logó (most az e-mail fejlécbe; később a dokumentumokra is)
CREATE TABLE IF NOT EXISTS company_branding (
    company_id  INTEGER PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
    logo_base64 TEXT,                 -- data nélkül, tiszta base64
    logo_mime   TEXT DEFAULT 'image/png',
    updated_at  TIMESTAMPTZ DEFAULT now()
);

-- E-mail sablonok (cégenként, kezdetben üres; a felhasználó viszi be)
CREATE TABLE IF NOT EXISTS email_templates (
    id          SERIAL PRIMARY KEY,
    company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    subject     TEXT,
    body        TEXT,                 -- {{client}}, {{ref}}, {{loc_incarcare}}, {{loc_descarcare}}, {{pret}}, {{order_id}}
    created_by  INTEGER,
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_templates_company ON email_templates (company_id);

-- Kimenő kliens-e-mailek naplója (beszélgetés-előzmény)
CREATE TABLE IF NOT EXISTS client_emails (
    id               SERIAL PRIMARY KEY,
    company_id       INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    inbound_order_id INTEGER,
    order_id         VARCHAR(20),
    to_email         TEXT NOT NULL,
    subject          TEXT,
    body             TEXT,
    status           TEXT DEFAULT 'sent',  -- sent | error
    error_message    TEXT,
    sent_by          INTEGER,
    sent_at          TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_client_emails_company ON client_emails (company_id, sent_at DESC);
