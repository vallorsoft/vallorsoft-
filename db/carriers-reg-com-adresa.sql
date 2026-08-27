-- ============================================================
--  VallorSoft — Alvállalkozó (carriers) reg_com + adresa
--  ------------------------------------------------------------
--  A Comanda de Transport PDF-hez kellenek a carrier cím-mezői
--  (a bal felső fejléc-kartonja). Eddig csak nev/cui/telefon/email
--  volt, hiányoztak: Adresa + Nr. Reg. Com.
--
--  Idempotens (ADD COLUMN IF NOT EXISTS). Régi cégekre NULL-ok
--  maradnak — a kliens szabadszövegesen felülírhatja a modalban.
-- ============================================================

ALTER TABLE carriers ADD COLUMN IF NOT EXISTS reg_com VARCHAR(60);
ALTER TABLE carriers ADD COLUMN IF NOT EXISTS adresa  VARCHAR(500);
