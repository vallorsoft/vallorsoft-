-- ============================================================
--  VallorSoft — GPS szerinti tényleges cím rátétele a menetlevélre
--  Inkrementális migráció (idempotens) — automatikusan lefut induláskor.
--
--  order_stops.waybill_apply      — az iroda (vagy az automatika) kérte, hogy a
--                                   tényleges cím a menetlevélre kerüljön; a
--                                   később beküldött menetlevélre is rákerül.
--  order_stops.waybill_applied_at — mikor került rá utoljára.
--  stop_match_settings            — cégenkénti automatikus rátétel + pontszám-küszöb.
--  A menetlevél pontjában az eredeti cím a `loc_planned` kulcsba kerül
--  (visszaállítható), a `loc_source='gps'` jelzi a forrást.
-- ============================================================

ALTER TABLE order_stops ADD COLUMN IF NOT EXISTS waybill_apply      BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE order_stops ADD COLUMN IF NOT EXISTS waybill_applied_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_order_stops_wb_apply ON order_stops (company_id) WHERE waybill_apply = true;

CREATE TABLE IF NOT EXISTS stop_match_settings (
  company_id  INTEGER PRIMARY KEY,
  auto_apply  BOOLEAN NOT NULL DEFAULT false,
  min_score   INTEGER NOT NULL DEFAULT 80,
  updated_by  VARCHAR(255),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
