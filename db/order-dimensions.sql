-- ============================================================
--  VallorSoft — fuvar rakomány-méretek (idempotens)
--  orders.hossz_cm / szel_cm / mag_cm: a rakomány mérete cm-ben.
--  FTL (teljes rakomány) esetén opcionális, LTL (részrakomány)
--  esetén KÖTELEZŐ (a kiíró/szerkesztő űrlap és a szerver is ellenőrzi).
--  A pótkocsi rakfelülettel (vehicles.cargo_*_cm) vethető össze.
-- ============================================================

ALTER TABLE orders ADD COLUMN IF NOT EXISTS hossz_cm INTEGER;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS szel_cm  INTEGER;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS mag_cm   INTEGER;
