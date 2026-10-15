-- ============================================================
--  💬 AI-chat — beszélgetés-adatbázis + emlékek.
--  chat_conversations: felhasználónkénti beszélgetések (cím, rövid összefoglaló).
--  chat_messages:      az üzenetek szövege (felhasználó + asszisztens); a szerver
--                      által rajzolt kártyák CSAK sima szövegként (card_text).
--                      `noai` = dokumentumhoz kötődő válasz → az AI-hoz SOSEM kerül.
--                      Fájl / csatolmány / feltöltött kép itt NEM tárolódik.
--  chat_memories:      a beszélgetésekből tanult tények/szokások
--                      (user_id = 0 → cégszintű), ezekből emlékszik a chat.
--  Az Admin a cég bármely beszélgetését megnézheti (💬 Chat-beszélgetések fül),
--  a Manager csak a sajátját. Megőrzés: CHAT_HISTORY_RETENTION_DAYS (alap 365 nap).
--  Kikapcsolható: `chat-history` funkció-kapcsoló (hiányzó sor = BE).
--  Idempotens.
-- ============================================================
CREATE TABLE IF NOT EXISTS chat_conversations (
  id                BIGSERIAL PRIMARY KEY,
  company_id        INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id           INTEGER NOT NULL,
  title             VARCHAR(200),
  msg_count         INTEGER NOT NULL DEFAULT 0,
  user_msg_count    INTEGER NOT NULL DEFAULT 0,
  summary           TEXT,
  summarized_count  INTEGER NOT NULL DEFAULT 0,
  summarized_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_conv_company ON chat_conversations (company_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_conv_user ON chat_conversations (company_id, user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
  id               BIGSERIAL PRIMARY KEY,
  conversation_id  BIGINT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  company_id       INTEGER NOT NULL,
  user_id          INTEGER,
  role             VARCHAR(10) NOT NULL,
  text             TEXT NOT NULL DEFAULT '',
  card_text        TEXT,
  kind             VARCHAR(40),
  noai             BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_msg_conv ON chat_messages (conversation_id, id);
CREATE INDEX IF NOT EXISTS idx_chat_msg_company ON chat_messages (company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS chat_memories (
  id               BIGSERIAL PRIMARY KEY,
  company_id       INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id          INTEGER NOT NULL DEFAULT 0,
  text             VARCHAR(300) NOT NULL,
  text_norm        VARCHAR(300) NOT NULL,
  source           VARCHAR(20) NOT NULL DEFAULT 'auto',
  conversation_id  BIGINT,
  created_by       INTEGER,
  hits             INTEGER NOT NULL DEFAULT 1,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_chat_memories UNIQUE (company_id, user_id, text_norm)
);
CREATE INDEX IF NOT EXISTS idx_chat_mem_user ON chat_memories (company_id, user_id, updated_at DESC);
