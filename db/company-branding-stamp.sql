-- ============================================================
--  VallorSoft — Cég-szintű pecsét (company_branding.stamp_*)
--  ------------------------------------------------------------
--  A meglévő cég-branding táblát (logó + brand_color + pdf_header_text)
--  bővíti PECSÉT-tel — a Comanda de Transport (és bármely jövőbeli
--  cég-szintű PDF) záró sarkába kerülő KÖRPECSÉT-hez.
--
--  MIÉRT nem a régi `stamps` táblát használjuk?
--    - A `stamps` PER-USER (email PK) — az admin/manager SZEMÉLYES
--      aláírás-pecsétje, amit a sofőr menetlevél PDF ráégetésénél is
--      használunk. A megbízás körpecsétje viszont a CÉGÉ (nem
--      személyes), a többi felhasználó ugyanazt látja.
--    - Multi-tenant: a cég-branding cégre szűrve él.
--
--  Idempotens. A logó-endpointtal analóg REST /api/branding/stamp
--  (GET/POST/DELETE) a routes/client-mail.js-ben kerül regisztrálásra.
-- ============================================================

ALTER TABLE company_branding ADD COLUMN IF NOT EXISTS stamp_base64 TEXT;
ALTER TABLE company_branding ADD COLUMN IF NOT EXISTS stamp_mime   TEXT DEFAULT 'image/png';
