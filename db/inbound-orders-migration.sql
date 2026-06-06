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
