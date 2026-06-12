-- ============================================================
--  VallorSoft — cég e-mail nyelve (idempotens)
--  Az admin állítja, alapból ROMÁN. A meghívó/jelszó-e-mailek ezen
--  a nyelven mennek (RO/HU).
-- ============================================================
ALTER TABLE companies ADD COLUMN IF NOT EXISTS email_lang VARCHAR(2) NOT NULL DEFAULT 'ro';
