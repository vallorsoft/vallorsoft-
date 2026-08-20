-- db/order-uit-stop-id.sql
-- UIT-kód → konkrét lerakóhoz kötése (multi-drop): egy fuvar minden
-- lerakópontjához külön UIT-kódot lehet felvinni (kézzel vagy AI-scan-nel).
--
-- Új oszlop: order_uit_codes.stop_id (INTEGER, FK order_stops.id, ON DELETE
-- SET NULL — ha a stop törlődik, a UIT rekord marad, csak elveszíti a
-- kötést; NEM CASCADE, mert a UIT-történet fontos audit-nyom).
--
-- stop_id = NULL érték a régi (fuvar-szintű) UIT-okat jelöli — a fuvar-
-- kiíráskor a menedzser által beírt kódok itt landolnak (nem tudjuk, melyik
-- lerakóhoz). A UI a fuvar-szintű UIT-okat MINDEN lerakó-modalban mutatja.
--
-- Futtatás: az induláskor auto-fut (server.js migráció-futtató).

ALTER TABLE order_uit_codes ADD COLUMN IF NOT EXISTS stop_id INTEGER;

-- FK csak akkor, ha még nincs (idempotens).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'order_uit_codes_stop_id_fkey'
  ) THEN
    ALTER TABLE order_uit_codes
      ADD CONSTRAINT order_uit_codes_stop_id_fkey
      FOREIGN KEY (stop_id) REFERENCES order_stops(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_uit_stop ON order_uit_codes (stop_id);
