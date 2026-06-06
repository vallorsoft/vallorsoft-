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
