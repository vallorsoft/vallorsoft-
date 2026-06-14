-- db/gdpr-settings.sql
-- GDPR / adatvédelmi cég-beállítások + alkalmazotti tájékoztató-visszaigazolás.
-- Indok: az ANSPDCP (Legea 190/2018 art. 5) szerint a munkavállalói GPS/
-- monitoring CSAK előzetes, teljes tájékoztatás mellett jogszerű, és a
-- jogos érdek nem írhatja felül a munkavállaló jogait. Ez:
--   gdpr_settings   — cégenkénti adatvédelmi tájékoztató (informare), DPO-kapcsolat,
--                     'GPS csak üzleti célra/munkaidőben' jelző, retenciós megjegyzés.
--   gdpr_consents   — a felhasználó (sofőr) visszaigazolja, hogy elolvasta a
--                     tájékoztatót (időbélyeg + IP). A tájékoztató módosításakor
--                     (settings.updated_at) újra kell igazolni.
-- Auto-fut a szerver indulásakor.

CREATE TABLE IF NOT EXISTS gdpr_settings (
  company_id        INTEGER PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  privacy_notice    TEXT,                                  -- adatvédelmi tájékoztató szövege
  dpo_contact       TEXT,                                  -- adatvédelmi tisztviselő / kapcsolat
  gps_business_only BOOLEAN NOT NULL DEFAULT FALSE,         -- GPS csak üzleti célra/munkaidőben
  retention_note    TEXT,                                  -- megőrzési idők megjegyzése
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gdpr_consents (
  id              SERIAL PRIMARY KEY,
  company_id      INTEGER NOT NULL,
  user_id         INTEGER NOT NULL,
  kind            VARCHAR(40) NOT NULL DEFAULT 'privacy_notice',
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip              VARCHAR(64),
  UNIQUE (company_id, user_id, kind)
);
