-- ============================================================
--  VallorSoft — Vizuális e-mail sablon / kimenő levelező modul
--  (Email Builder / Outreach) — KÜLSŐ kontaktoknak (ügyfél, jövőbeli
--  ügyfél, alvállalkozó, egyéb), NEM a platform felhasználóinak.
--
--  Inkrementális, IDEMPOTENS migráció (többször futtatható) —
--  automatikusan lefut a szerver indulásakor (schema_migrations).
--
--  MIÉRT ÚJ, ÜTKÖZÉSMENTES TÁBLANEVEK:
--    - A meglévő `email_templates` tábla a kliens-levelező SZABAD
--      szöveges sablonjait tárolja (routes/client-mail.js) — NEM nyúlunk.
--    - A `company_email_templates` (C/5) a kétnyelvű TRANZAKCIÓS
--      sablonokat tárolja — NEM nyúlunk.
--    - Ez a modul a vizuálisan (GrapesJS) szerkesztett kimenő e-mail
--      sablonokat + külső kontaktokat + párosításokat tárolja, külön
--      névtérben (email_builder_*). Nincs ütközés.
--    - A küldési napló a MEGLÉVŐ mail_log táblát használja (type='builder'),
--      nem hozunk létre külön email_send_log táblát.
--
--  Multi-tenant: minden sor egy company_id-hez tartozik; minden
--  lekérdezés company_id-szűrt + paraméteres a handlerben.
-- ============================================================

-- Vizuálisan szerkesztett e-mail sablonok (per-cég)
CREATE TABLE IF NOT EXISTS email_builder_templates (
  id            SERIAL PRIMARY KEY,
  company_id    INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name          VARCHAR(255) NOT NULL,
  subject       VARCHAR(500),
  html_content  TEXT,
  grapes_json   JSONB,
  created_by    INTEGER REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
-- Idempotens védőhálók (ha a tábla egy korábbi verzióval létezett volna)
ALTER TABLE email_builder_templates ADD COLUMN IF NOT EXISTS company_id   INTEGER;
ALTER TABLE email_builder_templates ADD COLUMN IF NOT EXISTS name         VARCHAR(255);
ALTER TABLE email_builder_templates ADD COLUMN IF NOT EXISTS subject      VARCHAR(500);
ALTER TABLE email_builder_templates ADD COLUMN IF NOT EXISTS html_content TEXT;
ALTER TABLE email_builder_templates ADD COLUMN IF NOT EXISTS grapes_json  JSONB;
ALTER TABLE email_builder_templates ADD COLUMN IF NOT EXISTS created_by   INTEGER;
ALTER TABLE email_builder_templates ADD COLUMN IF NOT EXISTS created_at   TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE email_builder_templates ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_email_builder_tpl_company
  ON email_builder_templates (company_id);

-- Külső e-mail kontaktok (ügyfél / alvállalkozó / egyéb)
CREATE TABLE IF NOT EXISTS email_contacts (
  id          SERIAL PRIMARY KEY,
  company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        VARCHAR(255) NOT NULL,
  email       VARCHAR(255) NOT NULL,
  type        VARCHAR(50)  NOT NULL DEFAULT 'ugyfel',   -- ugyfel | alvalalkozo | egyeb
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE email_contacts ADD COLUMN IF NOT EXISTS company_id INTEGER;
ALTER TABLE email_contacts ADD COLUMN IF NOT EXISTS name       VARCHAR(255);
ALTER TABLE email_contacts ADD COLUMN IF NOT EXISTS email      VARCHAR(255);
ALTER TABLE email_contacts ADD COLUMN IF NOT EXISTS type       VARCHAR(50) DEFAULT 'ugyfel';
ALTER TABLE email_contacts ADD COLUMN IF NOT EXISTS notes      TEXT;
ALTER TABLE email_contacts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_email_contacts_company
  ON email_contacts (company_id);

-- Sablon <-> kontakt párosítások (mentett párosítás)
CREATE TABLE IF NOT EXISTS email_template_pairings (
  id          SERIAL PRIMARY KEY,
  company_id  INTEGER NOT NULL,
  template_id INTEGER NOT NULL REFERENCES email_builder_templates(id) ON DELETE CASCADE,
  contact_id  INTEGER NOT NULL REFERENCES email_contacts(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (template_id, contact_id)
);
ALTER TABLE email_template_pairings ADD COLUMN IF NOT EXISTS company_id  INTEGER;
ALTER TABLE email_template_pairings ADD COLUMN IF NOT EXISTS template_id INTEGER;
ALTER TABLE email_template_pairings ADD COLUMN IF NOT EXISTS contact_id  INTEGER;
ALTER TABLE email_template_pairings ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_email_tpl_pairings_company
  ON email_template_pairings (company_id);
CREATE INDEX IF NOT EXISTS idx_email_tpl_pairings_tpl
  ON email_template_pairings (template_id);
