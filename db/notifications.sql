-- ============================================================
--  VallorSoft — Értesítési központ (notifications) + Levél-napló (mail_log)
--  Inkrementális migráció (idempotens) — automatikusan lefut induláskor.
--
--  notifications: cégen belüli (multi-tenant) értesítések; user_id NULL =
--    az egész cégnek (Admin/Manager). read_at NULL = olvasatlan.
--  mail_log: a ténylegesen kiküldött rendszer-/integrációs e-mailek naplója.
--
--  GDPR / személyes adat: a mail_log címzett-e-mailt (to_email) tárol →
--  a céges GDPR-export (handlers/gdpr.js exportCompanyData) tartalmazza.
--  A notifications szövege (title/body) is része az exportnak.
-- ============================================================

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  user_id INTEGER,                              -- NULL = az egész cégnek
  type TEXT,                                    -- pl. 'inbound', 'expiry', 'system'
  title TEXT,
  body TEXT,
  link_tab TEXT,                                -- melyik fülre ugorjon kattintásra
  read_at TIMESTAMPTZ,                          -- NULL = olvasatlan
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotens védőhálók (ha a tábla már létezett egy korábbi verzióval)
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS company_id INTEGER;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS user_id INTEGER;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS type TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS body TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link_tab TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_notifications_company_read ON notifications (company_id, read_at);

CREATE TABLE IF NOT EXISTS mail_log (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  to_email TEXT,
  subject TEXT,
  type TEXT,                                    -- pl. 'invite', 'reset', 'client', 'developer'
  status TEXT,                                  -- 'sent' | 'failed' | 'skipped'
  provider_id TEXT,                             -- Brevo messageId (ha van)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE mail_log ADD COLUMN IF NOT EXISTS company_id INTEGER;
ALTER TABLE mail_log ADD COLUMN IF NOT EXISTS to_email TEXT;
ALTER TABLE mail_log ADD COLUMN IF NOT EXISTS subject TEXT;
ALTER TABLE mail_log ADD COLUMN IF NOT EXISTS type TEXT;
ALTER TABLE mail_log ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE mail_log ADD COLUMN IF NOT EXISTS provider_id TEXT;
ALTER TABLE mail_log ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_mail_log_company_created ON mail_log (company_id, created_at);
