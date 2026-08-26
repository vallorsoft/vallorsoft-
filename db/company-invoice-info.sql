-- ============================================================
--  VallorSoft — Cég számlázási/azonosító mezők (2026-08-26)
--  Inkrementális, IDEMPOTENS migráció (többször futtatható).
--
--  Cél: a sofőr a főoldalon egy „Cégadatok" gombbal meg tudja
--  nézni cége minden hivatalos adatát (vásárlásnál a boltos ebből
--  írja a számlát a cégre). A cég `nev`/`igazgato_nev`/
--  `email_contact`/`telefon` már régóta megvan — ezek nem
--  duplikálva. Új mezők (mind opcionális, egyik sem NOT NULL,
--  hogy a meglévő céget ne törje):
--    - cui             : CUI/CIF fiskális kód (pl. 47859317 / RO47859317)
--    - reg_com         : Nr. Reg. Com. (pl. J2023000114142)
--    - euid            : European Unique Identifier (ROONRC.J2023000114142)
--    - adresa          : Székhely (Sediu social) — teljes cím
--    - iban            : IBAN bankszámla
--    - banca           : Bank neve
--    - capital_social  : Törzstőke (RON, szabad-szöveg — pl. „200 RON")
--    - tva_platitor    : TVA-fizető-e (Da/Nu) — a számlához fontos
--    - website         : Cég honlapja (opcionális)
--
--  A `companies.nev`, `igazgato_nev`, `email_contact`, `telefon`
--  meglévő oszlopok — az admin/manager „Cég & arculat" panelen
--  már eddig is kezelhetők voltak (illetve a `nev` a
--  cég-létrehozáskor rögzül).
-- ============================================================

ALTER TABLE companies ADD COLUMN IF NOT EXISTS cui             VARCHAR(20);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS reg_com         VARCHAR(30);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS euid            VARCHAR(50);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS adresa          TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS iban            VARCHAR(40);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS banca           VARCHAR(120);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS capital_social  VARCHAR(50);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS tva_platitor    BOOLEAN;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS website         VARCHAR(200);
