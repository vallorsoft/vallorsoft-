-- ============================================================
--  VallorSoft — cím-felismerés pontosság-napló + útvonal-eltérés (idempotens)
--
--  stop_match_accuracy   — havi visszamérés cégenként (az elfogadott címeken,
--                          írás nélkül újrafuttatva): találati arány, „biztos de
--                          rossz" esetek, tévesztések listája.
--  order_route_deviation — fuvaronként a tervezett (HERE kamionos / OSRM) km az
--                          első állomás és az utolsó állomás között vs. a GPS
--                          szerint ténylegesen megtett km. Ha a tényleges km nem
--                          több a tervezettnél (+ tűrés), az eltérő útvonal is rendben.
-- ============================================================
CREATE TABLE IF NOT EXISTS stop_match_accuracy (
  company_id  INTEGER NOT NULL,
  period      VARCHAR(7) NOT NULL,           -- YYYY-MM
  totals      JSONB NOT NULL,
  misses      JSONB,
  measured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, period)
);

CREATE TABLE IF NOT EXISTS order_route_deviation (
  order_id     VARCHAR(20) PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  company_id   INTEGER NOT NULL,
  planned_km   NUMERIC(9,1),
  actual_km    NUMERIC(9,1),
  diff_km      NUMERIC(9,1),
  diff_pct     NUMERIC(6,1),
  status       VARCHAR(12) NOT NULL,         -- ok | deviation | no_data
  source       VARCHAR(8),                   -- here | osrm
  km_source    VARCHAR(8),                   -- odo | gps
  from_at      TIMESTAMPTZ,
  to_at        TIMESTAMPTZ,
  planned_geo  JSONB,                        -- [[lat,lng],...] ritkítva (a későbbi térképes összevetéshez)
  detail       JSONB,
  checked_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_order_route_dev_company ON order_route_deviation (company_id, status, checked_at DESC);
