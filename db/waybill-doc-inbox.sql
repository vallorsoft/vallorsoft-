-- Csoportos irat-feltöltés a menetlevelekhez (lib/docInbox.js) — HELYBEN, AI nélkül.
-- Egyszerre sok számla / megrendelő kerül ide; a rendszer a hiányos menetlevelek
-- fuvarjaihoz párosítja őket. Találat → az irat a fuvar + menetlevél iratai közé kerül
-- (order_documents), itt csak a napló marad (a fájl törlődik).
-- 3 sikertelen próbálkozás után 'unmatched': a felhasználó kézzel párosít vagy töröl.
CREATE TABLE IF NOT EXISTS waybill_doc_inbox (
  id            SERIAL PRIMARY KEY,
  company_id    INTEGER NOT NULL,
  file_name     VARCHAR(255) NOT NULL,
  data          TEXT,                       -- data URL (találat / törlés után NULL)
  file_size     INTEGER,
  text_cache    TEXT,
  text_status   VARCHAR(12),                -- ok | ocr | scanned | image | error
  ocr_at        TIMESTAMPTZ,
  status        VARCHAR(12) NOT NULL DEFAULT 'pending',   -- pending | matched | unmatched
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_try_at   TIMESTAMPTZ,
  matched_order_id   VARCHAR(20),
  matched_waybill_id VARCHAR(20),
  matched_doc_id     INTEGER,
  matched_conf       INTEGER,
  matched_by         VARCHAR(10),           -- auto | manual
  best_guess    JSONB,
  uploaded_by   VARCHAR(255),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wdi_company_status ON waybill_doc_inbox (company_id, status);
