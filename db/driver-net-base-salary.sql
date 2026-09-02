-- ============================================================
--  VallorSoft — sofőr nettó havi alapbér (idempotens)
--  A „Decont oficial" (hivatalos elszámolás) dokumentum
--  alapbér-mezőjéhez. Alapérték: 2700 RON — nem hardcodolt,
--  cégenként/sofőrönként egyedileg állítható. NULL → az UI
--  a 2700 default-ot használja (visszafelé kompatibilis).
--  A meglévő „Decont lunar" mechanikát NEM érinti.
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS net_base_salary_ron NUMERIC(10,2) DEFAULT 2700;

-- A meglévő sofőrök is megkapják a default-ot, ha még NULL
UPDATE users SET net_base_salary_ron = 2700
 WHERE pozicio = 'Sofer' AND net_base_salary_ron IS NULL;
