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
