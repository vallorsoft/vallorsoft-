-- ============================================================
--  VallorSoft — tényleges címek heti újraellenőrzése
--  A 150 pont alatti (nem iroda által eldöntött) állomásokat a rendszer hetente
--  újraelemzi; 10 sikertelen újraellenőrzés után kézi megerősítésre hagyja.
--  Idempotens, auto-fut induláskor.
-- ============================================================
ALTER TABLE order_stops ADD COLUMN IF NOT EXISTS recheck_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE order_stops ADD COLUMN IF NOT EXISTS recheck_at    TIMESTAMPTZ;
ALTER TABLE order_stops ADD COLUMN IF NOT EXISTS needs_manual  BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_order_stops_recheck ON order_stops (company_id, recheck_at)
  WHERE needs_manual = false AND match_status IN ('auto','suggested','unmatched');
