-- e-Factura státusz automatikus lekérdezési ütemező támogatása.
-- Új oszlopok az invoices táblán: mikor ellenőriztük utoljára + nyers válasz debughoz.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS efactura_checked_at TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS efactura_last_raw   JSONB;

-- Az ütemező gyors szűrőjéhez: kiadott, de még nem ellenőrzött számlák.
CREATE INDEX IF NOT EXISTS idx_invoices_efactura_poll
  ON invoices (company_id, created_at DESC)
  WHERE status = 'issued' AND efactura_checked_at IS NULL;
