-- Menetlevél-iratok helyi OCR-je (lib/localOcr — saját szerveren, külső szolgáltató nélkül).
-- ocr_at: mikor próbáltuk (egy irathoz egyszer); text_status = 'ocr', ha sikerült.
ALTER TABLE order_documents ADD COLUMN IF NOT EXISTS ocr_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_order_documents_ocr_queue
  ON order_documents (company_id, id) WHERE text_status IN ('scanned', 'image') AND ocr_at IS NULL;
