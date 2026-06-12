-- ============================================================
--  VallorSoft — Ügyfél-portál (idempotens)
--  Az ügyfél (clients) kapcsolattartói saját belépést kapnak, és CSAK
--  a saját cégük fuvarjait látják (státusz, élő követés, dokumentumok),
--  illetve új fuvart igényelhetnek (a diszpécser jóváhagyásával).
--  Külön az 'users' táblától — tiszta biztonsági határ.
-- ============================================================

CREATE TABLE IF NOT EXISTS client_users (
  id             SERIAL PRIMARY KEY,
  company_id     INTEGER NOT NULL,
  client_id      INTEGER NOT NULL,
  email          VARCHAR(255) NOT NULL,
  pass_hash      TEXT,                          -- bcrypt; NULL amíg a meghívó nincs aktiválva
  nev            VARCHAR(255),
  activ          BOOLEAN NOT NULL DEFAULT TRUE,
  invite_token   VARCHAR(80),                   -- jelszó-beállító link tokenje
  invite_expires TIMESTAMPTZ,
  last_login     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Login e-mail alapján megy (cég-választás nélkül) → globálisan egyedi e-mail.
CREATE UNIQUE INDEX IF NOT EXISTS idx_client_users_email ON client_users (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_client_users_client ON client_users (company_id, client_id);

-- A portálról érkező fuvar-igény forrás-jelzése a beérkező megrendeléseknél.
ALTER TABLE inbound_orders ADD COLUMN IF NOT EXISTS source VARCHAR(20);
