-- ============================================================
--  Több postafiók cégenként + CSAK-FEJLÉC levél-lista (adatvédelem).
--  • mail_accounts: a cég IMAP-fiókjai, fiókonként mire használjuk
--    (megrendelések / levelek+válasz), mely mappák és mely feladók
--    láthatók. A jelszó AES-256-GCM titkosítva (creds_enc).
--  • mail_headers: CSAK feladó + tárgy + dátum + Message-ID. A levél
--    törzse és csatolmánya NEM kerül adatbázisba — megnyitáskor jön
--    élőben az IMAP-ról. Az AI semmit nem kap ebből automatikusan.
--  • A régi egy-fiókos beállítás (company_integrations provider='email_intake')
--    átkerül első fiókként „Megrendelések" szereppel.
-- ============================================================
CREATE TABLE IF NOT EXISTS mail_accounts (
  id            SERIAL PRIMARY KEY,
  company_id    INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  label         VARCHAR(120),
  email_masked  VARCHAR(255),
  provider      VARCHAR(20),
  creds_enc     TEXT NOT NULL,
  folders       TEXT NOT NULL DEFAULT 'INBOX',
  use_orders    BOOLEAN NOT NULL DEFAULT false,
  use_inbox     BOOLEAN NOT NULL DEFAULT true,
  allow_mode    VARCHAR(10) NOT NULL DEFAULT 'known',
  allow_list    TEXT,
  since         TIMESTAMPTZ NOT NULL DEFAULT now(),
  enabled       BOOLEAN NOT NULL DEFAULT true,
  last_check    TIMESTAMPTZ,
  last_error    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mail_accounts_company ON mail_accounts(company_id);

CREATE TABLE IF NOT EXISTS mail_headers (
  id           SERIAL PRIMARY KEY,
  company_id   INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  account_id   INTEGER NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
  folder       VARCHAR(200) NOT NULL,
  uid          BIGINT NOT NULL,
  message_id   VARCHAR(300),
  refs         TEXT,
  from_email   VARCHAR(255),
  from_name    VARCHAR(255),
  subject      VARCHAR(500),
  received_at  TIMESTAMPTZ,
  order_id     VARCHAR(40),
  opened_at    TIMESTAMPTZ,
  opened_by    VARCHAR(255),
  inbound_id   INTEGER,
  replied_at   TIMESTAMPTZ,
  dismissed    BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, folder, uid)
);
CREATE INDEX IF NOT EXISTS idx_mail_headers_company ON mail_headers(company_id, received_at DESC);

-- Régi egy-fiókos megrendelés-postafiók átemelése (egyszer, idempotensen).
INSERT INTO mail_accounts (company_id, label, email_masked, provider, creds_enc, folders,
                           use_orders, use_inbox, allow_mode, since, enabled, last_check)
SELECT ci.company_id, 'Megrendelések', ci.meta->>'email_masked', ci.meta->>'provider', ci.credentials_enc,
       COALESCE(NULLIF(ci.meta->>'mailbox',''), 'INBOX'), true, false, 'all',
       COALESCE((ci.meta->>'since')::timestamptz, now()), COALESCE(ci.enabled, true), ci.last_check
  FROM company_integrations ci
 WHERE ci.provider = 'email_intake' AND ci.credentials_enc IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM mail_accounts m WHERE m.company_id = ci.company_id);
