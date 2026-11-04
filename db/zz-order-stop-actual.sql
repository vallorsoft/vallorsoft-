-- ============================================================
--  VallorSoft — Tényleges fel-/lerakási cím a GPS-ből
--  Inkrementális migráció (idempotens) — automatikusan lefut induláskor.
--
--  A diszpécser által beírt (gyakran csak városnév) cím ÉRINTETLEN marad
--  (order_stops.loc/firma). A GPS-ből felismert tényleges hely KÜLÖN
--  mezőkbe kerül. Csak Admin/Manager látja (a sofőr-nézetek explicit
--  mezőlistát adnak vissza, ezek nincsenek benne).
--
--  match_status: auto (magas bizonyosság) | suggested (javaslat) |
--                unmatched (nincs biztos jelölt) | confirmed (iroda elfogadta /
--                kézzel adta meg) | rejected (iroda elvetette)
--  A confirmed / rejected sort az automatikus újrafuttatás NEM írja felül.
-- ============================================================

ALTER TABLE order_stops ADD COLUMN IF NOT EXISTS actual_lat      DOUBLE PRECISION;
ALTER TABLE order_stops ADD COLUMN IF NOT EXISTS actual_lng      DOUBLE PRECISION;
ALTER TABLE order_stops ADD COLUMN IF NOT EXISTS actual_address  TEXT;
ALTER TABLE order_stops ADD COLUMN IF NOT EXISTS actual_city     VARCHAR(120);
ALTER TABLE order_stops ADD COLUMN IF NOT EXISTS actual_country  VARCHAR(4);
ALTER TABLE order_stops ADD COLUMN IF NOT EXISTS gps_arrived_at  TIMESTAMPTZ;
ALTER TABLE order_stops ADD COLUMN IF NOT EXISTS gps_left_at     TIMESTAMPTZ;
ALTER TABLE order_stops ADD COLUMN IF NOT EXISTS match_score     INTEGER;
ALTER TABLE order_stops ADD COLUMN IF NOT EXISTS match_source    VARCHAR(16);
ALTER TABLE order_stops ADD COLUMN IF NOT EXISTS match_status    VARCHAR(12);
ALTER TABLE order_stops ADD COLUMN IF NOT EXISTS match_detail    JSONB;
ALTER TABLE order_stops ADD COLUMN IF NOT EXISTS matched_at      TIMESTAMPTZ;
ALTER TABLE order_stops ADD COLUMN IF NOT EXISTS match_decided_by VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_order_stops_match ON order_stops (company_id, match_status);

-- A mirror-trigger (order_stops → orders.*) csak a releváns oszlopokra fusson —
-- a GPS-illesztés mentése ne írja újra feleslegesen a fuvar mirror-mezőit.
-- (Csak ha a seq_index oszlop + a trigger-függvény már megvan; különben a régi trigger marad.)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='order_stops' AND column_name='seq_index')
     AND EXISTS (SELECT 1 FROM pg_proc WHERE proname='order_stops_sync_mirror') THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_order_stops_sync ON order_stops';
    EXECUTE 'CREATE TRIGGER trg_order_stops_sync
      AFTER INSERT OR DELETE OR UPDATE OF order_id, company_id, kind, stop_index, seq_index, loc, firma, data, arrived_at, done_at, waybilled_at
      ON order_stops FOR EACH ROW EXECUTE FUNCTION order_stops_sync_mirror()';
  END IF;
END $$;

-- Fuvaronkénti feldolgozási állapot (ütemező + visszamenőleges futtatás)
CREATE TABLE IF NOT EXISTS stop_match_state (
  order_id      VARCHAR(20) PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  company_id    INTEGER NOT NULL,
  status        VARCHAR(16),          -- done | partial | no_gps | no_plate | no_stops | error
  attempts      INTEGER NOT NULL DEFAULT 0,
  attempted_at  TIMESTAMPTZ,
  requeued      BOOLEAN NOT NULL DEFAULT false,
  note          TEXT
);
CREATE INDEX IF NOT EXISTS idx_stop_match_state_company ON stop_match_state (company_id, requeued);

-- Reverse-geokód cache (~11 m-es rács) — a Nominatim fair-use miatt
CREATE TABLE IF NOT EXISTS geo_reverse_cache (
  key         VARCHAR(40) PRIMARY KEY,
  data        JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Helymemória: az elfogadott tényleges címek a kedvenc helyszínek közé kerülnek
ALTER TABLE favorite_locations ADD COLUMN IF NOT EXISTS firma        TEXT;
ALTER TABLE favorite_locations ADD COLUMN IF NOT EXISTS source       VARCHAR(12) DEFAULT 'manual';
ALTER TABLE favorite_locations ADD COLUMN IF NOT EXISTS radius_m     INTEGER;
ALTER TABLE favorite_locations ADD COLUMN IF NOT EXISTS hit_count    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE favorite_locations ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
