-- Menetlevélhez csatolt dokumentumok (fuvar-dokumentum / számla / GPS útvonal /
-- megbízás / egyéb). Egy menetlevél jellemzően egy hét 2-3 fuvarja; a
-- fuvar-dokumentum opcionálisan a menetlevél egyik fuvarjához köthető (order_id).
-- A fájl base64 data URL-ként (mint az order_documents). handlers/waybillDocs.js.
CREATE TABLE IF NOT EXISTS waybill_documents (
  id           SERIAL PRIMARY KEY,
  company_id   INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  waybill_id   VARCHAR(20) NOT NULL REFERENCES fuvarlevelek(id) ON DELETE CASCADE,
  order_id     VARCHAR(20) REFERENCES orders(id) ON DELETE SET NULL,
  doc_type     VARCHAR(20) NOT NULL DEFAULT 'other',
  file_name    VARCHAR(255) NOT NULL,
  mime         VARCHAR(100),
  file_size    INTEGER,
  data         TEXT NOT NULL,
  note         VARCHAR(500),
  uploaded_by  VARCHAR(255),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_waybill_documents_wb ON waybill_documents (company_id, waybill_id);
