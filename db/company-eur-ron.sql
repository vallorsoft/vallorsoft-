-- ============================================================
--  VallorSoft — EUR↔RON árfolyam a cégen (statisztika 2. fázis)
--  Idempotens migráció (többször lefuttatható).
--
--  A fuvar-ár EUR-ban, a sofőr-költségek (tankolás/vásárlás) RON-ban
--  vannak. Az admin által beállított árfolyammal a statisztika
--  EREDMÉNYT (profit) tud számolni egy pénznemben (EUR).
--  NULL = nincs beállítva -> a profit-számítás nem jelenik meg.
-- ============================================================

ALTER TABLE companies ADD COLUMN IF NOT EXISTS eur_ron_rate NUMERIC(8,4);
