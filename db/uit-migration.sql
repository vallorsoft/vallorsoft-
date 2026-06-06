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
    anaf_confirmed    BOOLEAN NOT NULL DEFAULT FALSE,  -- az ANAF visszaigazolta a fogadást (authoritatív „zöld")
    anaf_confirmed_at TIMESTAMPTZ,                     -- mikor igazolta vissza az ANAF
    sent_at       TIMESTAMPTZ,                      -- mikor indult a küldés
    stopped_at    TIMESTAMPTZ,                      -- mikor lett leállítva
    created_by    INTEGER,
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now(),
    UNIQUE (company_id, order_id, uit_code)
);

CREATE INDEX IF NOT EXISTS idx_uit_company_order ON order_uit_codes (company_id, order_id);
