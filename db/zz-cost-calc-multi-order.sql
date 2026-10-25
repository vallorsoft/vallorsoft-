-- ============================================================
--  VallorSoft — Költség-kalkulátor: több fuvar összevont kalkulációja
--  cost_calculations.order_ids — a kalkulációba vont fuvarok (JSONB tömb);
--  a régi order_id az első fuvar marad (visszafelé kompatibilis).
--  period_from / period_to — az időszak, amely alatt a fuvarokat elvégezték.
--  Idempotens.
-- ============================================================
ALTER TABLE cost_calculations ADD COLUMN IF NOT EXISTS order_ids JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE cost_calculations ADD COLUMN IF NOT EXISTS period_from DATE;
ALTER TABLE cost_calculations ADD COLUMN IF NOT EXISTS period_to DATE;
UPDATE cost_calculations SET order_ids = jsonb_build_array(order_id)
 WHERE order_id IS NOT NULL AND order_ids = '[]'::jsonb;
CREATE INDEX IF NOT EXISTS idx_cc_order_ids ON cost_calculations USING GIN (order_ids);
