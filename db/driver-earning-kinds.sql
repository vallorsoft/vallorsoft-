-- ============================================================
--  VallorSoft — Sofőr-járandóság egyéni típusok (idempotens migráció)
--  A cég sajátos típusai (pl. „Karácsonyi jutalom", „Hűség-bónusz",
--  „Külföldi kiküldetés-átalány") a 7 beépített típus MELLETT.
--  Kulcs = kisbetűs, kötőjelezett slug (max 30 char); label_ro/hu
--  szerkeszthető ember-olvasható címke. Az `earningCreate` handler
--  a beépített 7-en KÍVÜL a cég egyéni kulcsait is elfogadja.
--
--  Multi-tenant: UNIQUE (company_id, key) → két cég adhat azonos
--  kulcsot különböző címkével. Az egyéni típusok a cégen belül
--  is törölhetők (a régi bejegyzések megmaradnak — csak a legördülő
--  szűrődik, mert a driver_earnings.kind egy pillanatképet tárol).
-- ============================================================

CREATE TABLE IF NOT EXISTS driver_earning_kinds (
  id         SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  key        VARCHAR(30) NOT NULL,
  label_ro   VARCHAR(120) NOT NULL,
  label_hu   VARCHAR(120),
  created_by VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (company_id, key)
);

CREATE INDEX IF NOT EXISTS idx_driver_earning_kinds_company
  ON driver_earning_kinds(company_id);
