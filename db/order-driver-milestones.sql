-- ============================================================
--  VallorSoft — Sofőr fuvar-állomások (milestone) időbélyegek
--  A sofőr egyetlen, lenyomásra léptető gombbal jelzi vissza a
--  fuvar 4 állomását; mindegyik KÜLÖN időbélyeget kap:
--    1. megérkezett a felrakóhoz   → sosit_incarcare_at
--    2. felrakodott                 → incarcat_at
--    3. megérkezett a lerakóhoz     → sosit_descarcare_at
--    4. leürített                    → descarcat_at  (→ Finalizat)
--  Idempotens: IF NOT EXISTS. Nem érinti a meglévő status-logikát
--  (a status a szokásos Alocat/In Curs/Finalizat marad).
-- ============================================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS sosit_incarcare_at   TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS incarcat_at          TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS sosit_descarcare_at  TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS descarcat_at         TIMESTAMPTZ;
