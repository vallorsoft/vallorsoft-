-- ============================================================
--  Szöveges fuvarkiírás (AI-chat) — tanulás: cégenkénti memória.
--  A MENTETT fuvarokból tanul (stabil, cég-saját adat):
--    firma_addr    — cég (normalizált név) → teljes cím
--    pickup_client — felrakó cég → megrendelő (név + client_id)
--    client_cargo  — megrendelő → szokásos áru-típus (+ LTL méretek)
--    driver_alias  — sofőr-becenév (ahogy a diszpécser írja) → sofőr e-mail
--  A beszélgetés szövege NEM tárolódik; az AI-hoz semmi nem kerül belőle.
--  Idempotens.
-- ============================================================
CREATE TABLE IF NOT EXISTS order_chat_memory (
  id          BIGSERIAL PRIMARY KEY,
  company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind        VARCHAR(20) NOT NULL,
  key_norm    VARCHAR(200) NOT NULL,
  value       JSONB NOT NULL DEFAULT '{}'::jsonb,
  hits        INTEGER NOT NULL DEFAULT 1,
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (company_id, kind, key_norm)
);
