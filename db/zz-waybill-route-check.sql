-- ============================================================
--  VallorSoft — menetlevél teljes útvonala (Plecare → Sosire)
--  A menetlevél pontjai a rögzített sorrendben (indulás, minden fel-/lerakó,
--  érkezés): tervezett km (rakott / üres bontással) vs. km-óra és GPS szerinti km.
--  Idempotens, auto-fut induláskor.
-- ============================================================
CREATE TABLE IF NOT EXISTS waybill_route_check (
  waybill_id    VARCHAR(64) PRIMARY KEY,
  company_id    INTEGER NOT NULL,
  planned_km    NUMERIC(10,1),
  loaded_km     NUMERIC(10,1),
  empty_km      NUMERIC(10,1),
  odo_km        NUMERIC(10,1),
  gps_km        NUMERIC(10,1),
  diff_km       NUMERIC(10,1),
  diff_pct      NUMERIC(7,1),
  status        VARCHAR(12) NOT NULL DEFAULT 'no_data',
  planned_h     NUMERIC(7,1),
  planned_geo   JSONB,
  detail        JSONB,
  sig           TEXT,
  checked_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_waybill_route_check_company ON waybill_route_check (company_id, checked_at DESC);
