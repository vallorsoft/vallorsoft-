-- Fuvar-dokumentumok: típus + dokumentum-dátum + hivatkozási szám + megjegyzés,
-- hogy a fuvarhoz kötött számla/CMR/bármilyen dokumentum utólag fuvar VAGY
-- dátum szerint kereshető és letölthető legyen (handlers/orderDocs.js).
ALTER TABLE order_documents ADD COLUMN IF NOT EXISTS doc_type  VARCHAR(30);
ALTER TABLE order_documents ADD COLUMN IF NOT EXISTS doc_date  DATE;
ALTER TABLE order_documents ADD COLUMN IF NOT EXISTS ref_no    VARCHAR(100);
ALTER TABLE order_documents ADD COLUMN IF NOT EXISTS note      VARCHAR(500);
ALTER TABLE order_documents ADD COLUMN IF NOT EXISTS file_size INTEGER;
-- Régi sorok cég-horgonya (a company_id NULL lehetett) a fuvarból.
UPDATE order_documents od SET company_id = o.company_id
  FROM orders o WHERE o.id = od.order_id AND od.company_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_order_documents_company_date
  ON order_documents (company_id, (COALESCE(doc_date, created_at::date)));
CREATE INDEX IF NOT EXISTS idx_order_documents_order ON order_documents (order_id);
