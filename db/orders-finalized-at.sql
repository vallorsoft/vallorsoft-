-- db/orders-finalized-at.sql
-- A fuvar teljesítésének (Finalizat) időbélyege a sofőr-nézet 3-napos
-- kiöregítéséhez. Idempotens. Futtatás: psql "$DATABASE_URL" -f db/orders-finalized-at.sql

ALTER TABLE orders ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMP;

-- Visszamenőleg: a már Finalizat fuvaroknál az updated_at-et vesszük kiindulásként.
UPDATE orders
   SET finalized_at = updated_at
 WHERE status = 'Finalizat' AND finalized_at IS NULL;

-- Trigger: bármely útvonalon (sofőr / manager / REST) Finalizat-ra váltáskor
-- automatikusan beállítja a finalized_at-et (csak az átmenetkor, nem felülírva).
CREATE OR REPLACE FUNCTION set_order_finalized_at() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'Finalizat' AND OLD.status IS DISTINCT FROM 'Finalizat' THEN
    NEW.finalized_at := NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_order_finalized_at ON orders;
CREATE TRIGGER trg_order_finalized_at
  BEFORE UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION set_order_finalized_at();
