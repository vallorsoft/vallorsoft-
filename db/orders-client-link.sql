-- db/orders-client-link.sql
-- A fuvar összekötése az ügyféllel. Biztonságos: nullable, a meglévő szöveges `client` mező marad.
-- Futtatás: psql "$DATABASE_URL" -f db/orders-client-link.sql

ALTER TABLE orders ADD COLUMN IF NOT EXISTS client_id INTEGER REFERENCES clients(id);
CREATE INDEX IF NOT EXISTS idx_orders_client ON orders (client_id);
