-- Menetlevél-dokumentumok EGY tárolóba a fuvar-dokumentumokkal (order_documents):
-- egy irat egyszer tárolódik; ha fuvarhoz kötött, a fuvarnál ÉS a fuvart tartalmazó
-- menetlevél(ek)nél is látszik; fuvar nélkül csak a menetlevélnél (waybill_id).
ALTER TABLE order_documents ALTER COLUMN order_id DROP NOT NULL;
ALTER TABLE order_documents ADD COLUMN IF NOT EXISTS waybill_id VARCHAR(20);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_order_documents_waybill') THEN
    ALTER TABLE order_documents ADD CONSTRAINT fk_order_documents_waybill
      FOREIGN KEY (waybill_id) REFERENCES fuvarlevelek(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_order_documents_waybill ON order_documents (company_id, waybill_id);

-- A 2026-10-28-i külön tábla (waybill_documents) sorainak átköltöztetése, majd megszüntetése.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'waybill_documents') THEN
    INSERT INTO order_documents (order_id, waybill_id, file_name, original_base64, uploaded_by,
                                 company_id, doc_type, doc_date, note, file_size, created_at, updated_at)
    SELECT order_id, waybill_id, file_name, data, uploaded_by, company_id, doc_type,
           created_at::date, note, file_size, created_at, created_at
      FROM waybill_documents;
    DROP TABLE waybill_documents;
  END IF;
END $$;
