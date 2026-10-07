-- ============================================================
--  📤 Elküldött levelek — a cég SAJÁT fiókjáról (getCompanyMailer)
--  kiment levelek nyilvántartása az alkalmazásban (Gmail-szerű
--  Beérkezett / Elküldött nézet + levélszál).
--  • CSAK a mi kimenő leveleinket tároljuk (címzett, tárgy, szöveg,
--    csatolmány-NEVEK) — a beérkezett levelek tartalma továbbra sem
--    kerül adatbázisba (az csak kattintásra jön élőben az IMAP-ról).
--  • message_id / in_reply_to → levélszál a mail_headers-szel
--    (a mi válaszunk a beérkezett levélre, ill. az ügyfél válasza a miénkre).
--  • Az AI ezt a táblát nem olvassa.
-- ============================================================
CREATE TABLE IF NOT EXISTS mail_sent (
  id           SERIAL PRIMARY KEY,
  company_id   INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  from_email   VARCHAR(255),
  to_email     TEXT,
  subject      VARCHAR(500),
  body_text    TEXT,
  attachments  JSONB NOT NULL DEFAULT '[]'::jsonb,
  mail_type    VARCHAR(30),
  status       VARCHAR(10) NOT NULL DEFAULT 'sent',
  error        TEXT,
  method       VARCHAR(10),
  message_id   VARCHAR(300),
  in_reply_to  VARCHAR(300),
  order_id     VARCHAR(40),
  sent_by      VARCHAR(255),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mail_sent_company ON mail_sent(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mail_sent_msgid ON mail_sent(company_id, message_id);
CREATE INDEX IF NOT EXISTS idx_mail_sent_irt ON mail_sent(company_id, in_reply_to);
CREATE INDEX IF NOT EXISTS idx_mail_headers_msgid ON mail_headers(company_id, message_id);
