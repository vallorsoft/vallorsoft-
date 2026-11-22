-- Menetlevél dokumentum-csomag ellenőrzése (lib/waybillDocCheck.js) — HELYBEN, AI nélkül.
-- A menetlevélhez azoknak a fuvaroknak az iratai kellenek, amelyeknek a LERAKÁSA a
-- menetlevélen szerepel (puncte: Descarcare / role='unloading'):
--   ügyfél-megrendelő + az ügyfélnek kiállított számla; alvállalkozós fuvarnál még
--   az alvállalkozónak küldött megrendelő + az alvállalkozó számlája.
-- A PDF szövege a saját adatbázisunkban marad (cache, hogy ne olvassuk újra).
ALTER TABLE order_documents ADD COLUMN IF NOT EXISTS text_cache  TEXT;
ALTER TABLE order_documents ADD COLUMN IF NOT EXISTS text_status VARCHAR(12);   -- ok | scanned | image | error
ALTER TABLE order_documents ADD COLUMN IF NOT EXISTS text_at     TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS waybill_doc_checks (
  waybill_id    VARCHAR(20) PRIMARY KEY,
  company_id    INTEGER NOT NULL,
  status        VARCHAR(12) NOT NULL DEFAULT 'incomplete',  -- complete | incomplete | none
  required_cnt  INTEGER NOT NULL DEFAULT 0,
  missing_cnt   INTEGER NOT NULL DEFAULT 0,
  wrong_cnt     INTEGER NOT NULL DEFAULT 0,
  review_cnt    INTEGER NOT NULL DEFAULT 0,
  input_sig     VARCHAR(64),
  detail        JSONB NOT NULL DEFAULT '{}'::jsonb,
  checked_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wdc_company ON waybill_doc_checks (company_id, status);

-- A felhasználó visszaigazolása (tanulás): egy irat ↔ fuvar ↔ szerep párosítás
-- helyes (ok) vagy nem (no). A „no" párt a rendszer soha nem ajánlja újra.
CREATE TABLE IF NOT EXISTS waybill_doc_decisions (
  id          SERIAL PRIMARY KEY,
  company_id  INTEGER NOT NULL,
  doc_id      INTEGER NOT NULL,
  order_id    VARCHAR(20) NOT NULL,
  slot        VARCHAR(20) NOT NULL,           -- client_order | client_invoice | carrier_order | carrier_invoice
  verdict     VARCHAR(4) NOT NULL,            -- ok | no
  decided_by  VARCHAR(255),
  decided_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, doc_id, order_id, slot)
);
CREATE INDEX IF NOT EXISTS idx_wdd_doc ON waybill_doc_decisions (company_id, doc_id);
