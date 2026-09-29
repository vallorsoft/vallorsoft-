-- Ütemező vezető-választás (lease): több Fly-gépen csak EGY példány futtatja
-- az ütemezőket (e-mail/push/IMAP duplikáció ellen). lib/schedulerLeader.js
CREATE TABLE IF NOT EXISTS scheduler_leader (
  name        TEXT PRIMARY KEY,
  holder      TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL
);
