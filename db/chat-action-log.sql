-- ============================================================
--  AI-chat 2.0 — chatből végrehajtott műveletek naplója a VISSZAVONÁSHOZ
--  (CHAT-AI-TERV.md 3.7). Csak a módosított mezők előző értéke (before)
--  kerül ide; a felhasználó 24 órán belül a saját utolsó műveletét
--  visszavonhatja („vond vissza az előzőt"), szintén ✅-megerősítéssel.
-- ============================================================
CREATE TABLE IF NOT EXISTS chat_action_log (
  id          SERIAL PRIMARY KEY,
  company_id  INTEGER NOT NULL,
  user_id     INTEGER NOT NULL,
  tool        VARCHAR(80) NOT NULL,
  label       VARCHAR(200),
  entity_id   VARCHAR(80),
  before      JSONB,
  result      JSONB,
  undone_at   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_action_user ON chat_action_log (company_id, user_id, created_at DESC);
