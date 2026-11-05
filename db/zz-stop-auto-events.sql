-- ============================================================
--  VallorSoft — Elfelejtett állomás-gomb automatikus pótlása a GPS-ből
--  Inkrementális migráció (idempotens) — automatikusan lefut induláskor.
--
--  Ha a GPS-cím-felismerés BIZTOS (match_status='auto') és a kamion már
--  elhagyta a helyet, de a sofőr nem nyomta meg az „odaértem / felraktam /
--  leürítettem" gombot, a rendszer a GPS-ből kitölti az arrived_at/done_at
--  időt. A sofőr következő belépéskor sorban látja ezeket, és leokézza vagy
--  javítja (idő vagy térkép alapján).
--
--  auto_filled      'arrive' | 'done' | 'both' — mit töltött ki a rendszer
--  auto_filled_at   mikor
--  auto_ack_at      a sofőr mikor nézte át (NULL = még vár)
--  auto_ack_action  'ok' | 'time' | 'map'
--  auto_orig        az automatikus értékek a sofőr javítása előtt (napló)
--  stop_match_settings.auto_events — cégenként kikapcsolható (alap: be)
--  A fájlnév a zz-order-stop-waybill-apply.sql UTÁN fut (stop_match_settings).
-- ============================================================

ALTER TABLE order_stops ADD COLUMN IF NOT EXISTS auto_filled     VARCHAR(8);
ALTER TABLE order_stops ADD COLUMN IF NOT EXISTS auto_filled_at  TIMESTAMPTZ;
ALTER TABLE order_stops ADD COLUMN IF NOT EXISTS auto_ack_at     TIMESTAMPTZ;
ALTER TABLE order_stops ADD COLUMN IF NOT EXISTS auto_ack_action VARCHAR(12);
ALTER TABLE order_stops ADD COLUMN IF NOT EXISTS auto_orig       JSONB;

CREATE INDEX IF NOT EXISTS idx_order_stops_auto_pending
  ON order_stops (company_id, order_id) WHERE auto_filled IS NOT NULL AND auto_ack_at IS NULL;

CREATE TABLE IF NOT EXISTS stop_match_settings (
  company_id  INTEGER PRIMARY KEY,
  auto_apply  BOOLEAN NOT NULL DEFAULT false,
  min_score   INTEGER NOT NULL DEFAULT 80,
  updated_by  VARCHAR(255),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE stop_match_settings ADD COLUMN IF NOT EXISTS auto_events BOOLEAN NOT NULL DEFAULT true;
