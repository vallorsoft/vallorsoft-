-- ============================================================
--  AI-chat 2.0 — tanulás (CHAT-AI-TERV.md 3.6)
--  chat_miss_log: a chat által NEM értett mondatok (30 napig, cégenként,
--    a 🧠 Tanult adatok fülön látható/törölhető; kikapcsolható a
--    `chat-learning` funkció-kapcsolóval).
--  chat_learned_intents: megerősített mondat → képesség párok (cégenként),
--    az AI-útválasztó példának kapja (few-shot).
-- ============================================================
CREATE TABLE IF NOT EXISTS chat_miss_log (
  id          SERIAL PRIMARY KEY,
  company_id  INTEGER NOT NULL,
  user_id     INTEGER,
  text        TEXT NOT NULL,
  suggestions JSONB DEFAULT '[]'::jsonb,
  resolved_tool VARCHAR(80),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_miss_company ON chat_miss_log (company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS chat_learned_intents (
  id          SERIAL PRIMARY KEY,
  company_id  INTEGER NOT NULL,
  text_norm   VARCHAR(300) NOT NULL,
  text        TEXT NOT NULL,
  tool        VARCHAR(80) NOT NULL,
  hits        INTEGER NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_chat_learned UNIQUE (company_id, text_norm)
);
