-- ============================================================
--  VallorSoft — fuvarhoz csatolt fájlok explicit megosztás-jelzői
--  ------------------------------------------------------------
--  Sem az ügyfél-portál (client_users), sem az alvállalkozói portál
--  (carrier_users) NEM lát AUTOMATIKUSAN minden order_documents /
--  documents (POD) fájlt a fuvarhoz — csak azokat, amiket a diszpécser
--  EXPLICIT elküldött nekik (a fuvar ✉️ „Email a fuvarról" úton).
--  A jelzőket a sendOrderEmail állítja be a sikeres kézbesítés után;
--  a portál-endpointok WHERE-be tesznek `shared_with_* = TRUE` szűrőt.
-- ============================================================

-- order_documents (megrendelő-visszaigazolás, aláírt CMR stb.)
ALTER TABLE order_documents ADD COLUMN IF NOT EXISTS shared_with_client BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE order_documents ADD COLUMN IF NOT EXISTS shared_with_client_at TIMESTAMPTZ;
ALTER TABLE order_documents ADD COLUMN IF NOT EXISTS shared_with_carrier BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE order_documents ADD COLUMN IF NOT EXISTS shared_with_carrier_at TIMESTAMPTZ;

-- documents (sofőr által csatolt POD-fotók a fuvarhoz)
ALTER TABLE documents ADD COLUMN IF NOT EXISTS shared_with_client BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS shared_with_client_at TIMESTAMPTZ;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS shared_with_carrier BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS shared_with_carrier_at TIMESTAMPTZ;

-- Indexek a portál-listázáshoz (WHERE order_id = ANY(...) AND shared_with_* = TRUE)
CREATE INDEX IF NOT EXISTS idx_order_docs_shared_client  ON order_documents(order_id) WHERE shared_with_client  = TRUE;
CREATE INDEX IF NOT EXISTS idx_order_docs_shared_carrier ON order_documents(order_id) WHERE shared_with_carrier = TRUE;
CREATE INDEX IF NOT EXISTS idx_documents_shared_client   ON documents(order_id)       WHERE shared_with_client  = TRUE;
CREATE INDEX IF NOT EXISTS idx_documents_shared_carrier  ON documents(order_id)       WHERE shared_with_carrier = TRUE;
