-- ============================================================
--  VallorSoft — PDF-sablonok (per-dokumentumtípus testreszabás) — MVP
--  Inkrementális, IDEMPOTENS migráció (többször futtatható).
--
--  MIÉRT ÚJ TÁBLA (nem company_branding bővítés):
--    A company_branding cégenként EGYETLEN sor (logo/brand_color/pdf_header_text),
--    így dokumentumtípusonként KÜLÖN fejléc/lábléc/akcent-szín nem fér el benne.
--    Ez a tábla dokumentumtípusonként ad egy-egy testreszabás-sort.
--    A LOGÓT és az alap márka-színt TOVÁBBRA IS a company_branding-ból
--    olvassuk (újrahasznosítás, nincs duplikáció) — itt csak a per-típus
--    felülírások élnek (fejléc/lábléc/akcent/logó-megjelenítés).
--
--  doc_type whitelist (a handler kényszeríti ki): order | waybill | cmr | invoice_note
--  Multi-tenant: minden sor company_id-hez kötött; UNIQUE(company_id, doc_type).
-- ============================================================

CREATE TABLE IF NOT EXISTS pdf_templates (
    id           SERIAL PRIMARY KEY,
    company_id   INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    doc_type     VARCHAR(32) NOT NULL,
    header_text  TEXT,
    footer_text  TEXT,
    accent_color VARCHAR(9),
    show_logo    BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at   TIMESTAMPTZ DEFAULT now(),
    UNIQUE (company_id, doc_type)
);

CREATE INDEX IF NOT EXISTS idx_pdf_templates_company ON pdf_templates(company_id);
