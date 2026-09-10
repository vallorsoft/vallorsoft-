-- db/morning-digest-settings.sql
-- Reggeli összefoglaló (napi digest) — cégenkénti kapcsoló + időpont + címzettek.
--
-- Mit szolgál: reggel egy meghatározott időpontban a cég Admin/Manager
-- felhasználói kapnak egy e-mailt (opc. push) a nap előre látható eseményeiről:
-- aktív fuvarok darabszáma, mai felrakások, mai lerakások, lejáró dokumentumok
-- <30 nap, esedékes szervizek <2 hét, késett fizetések, hiányzó UIT-kódok.
--
-- `digest_enabled` false = kikapcsolva (alapértelmezett — nem küld magától).
-- `digest_time` TIME (HH:MM Europe/Bucharest), alap 07:00.
-- `digest_recipients` JSONB tömb: extra címzettek (a cég Admin/Manager userei
--    automatikusan bekerülnek; ez a mező a további címeket veszi fel).
-- `digest_last_sent_at` a duplikáció-őr (naponta max 1× / cég).
--
-- Auto-fut a szerver indulásakor (idempotens).

ALTER TABLE companies ADD COLUMN IF NOT EXISTS digest_enabled BOOLEAN DEFAULT false;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS digest_time TIME DEFAULT '07:00';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS digest_recipients JSONB DEFAULT '[]'::jsonb;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS digest_last_sent_at TIMESTAMPTZ;
