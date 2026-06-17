-- ============================================================
--  VallorSoft — Cég-branding & beállítások kiegészítő mezők
--  Inkrementális, IDEMPOTENS migráció (többször futtatható).
--
--  A meglévő `company_branding` táblát (logó) bővíti két oszloppal:
--    - brand_color    : a cég akcent-színe (hex, pl. #f6711e) — UI/PDF
--    - pdf_header_text : a kimenő dokumentumok (PDF) fejléc-szövege
--
--  NEM módosít meglévő oszlopot, NEM hoz létre párhuzamos táblát.
--  A logó (logo_base64/logo_mime), a `companies.eur_ron_rate` és a
--  `document_series` (menetlevél-prefix) MÁR léteznek — azokat
--  újrahasználjuk, nem duplikáljuk. A számlázó serie/TVA/pénznem a
--  `billing_integrations`-ban marad (provider-szintű), itt NEM ismételjük.
-- ============================================================

-- Biztos, ami biztos: ha valamiért hiányozna a tábla (régi DB), létrehozzuk.
CREATE TABLE IF NOT EXISTS company_branding (
    company_id  INTEGER PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
    logo_base64 TEXT,
    logo_mime   TEXT DEFAULT 'image/png',
    updated_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE company_branding ADD COLUMN IF NOT EXISTS brand_color     VARCHAR(9);
ALTER TABLE company_branding ADD COLUMN IF NOT EXISTS pdf_header_text TEXT;
