-- ============================================================
--  VallorSoft — Migráció: shift EU 561/2006 compliance + scheduler
--  réteg eltávolítása a driver_shifts tábláról.
--  A driver_shifts tábla és a core műszak-életciklus (status,
--  day_started_at/closed_at, paused_*, rest_*, next_shift_start) MARAD.
--  Idempotens: többször is lefuttatható.
-- ============================================================

-- ----- Compliance CHECK constraint eldobása -----
ALTER TABLE driver_shifts DROP CONSTRAINT IF EXISTS chk_overtime_reason_required;

-- ----- Scheduler / compliance indexek eldobása -----
DROP INDEX IF EXISTS idx_shifts_week;
DROP INDEX IF EXISTS idx_shifts_company_week;
DROP INDEX IF EXISTS idx_shifts_paused_pending;
DROP INDEX IF EXISTS idx_shifts_next_start_pending;
DROP INDEX IF EXISTS idx_shifts_warn11h_pending;

-- ----- Scheduler-értesítő oszlopok eldobása -----
ALTER TABLE driver_shifts DROP COLUMN IF EXISTS pause_notif_sent_at;
ALTER TABLE driver_shifts DROP COLUMN IF EXISTS notif_sent_at;
ALTER TABLE driver_shifts DROP COLUMN IF EXISTS warn11h_sent_at;
ALTER TABLE driver_shifts DROP COLUMN IF EXISTS snooze_until;

-- ----- EU 561/2006 compliance oszlopok eldobása -----
ALTER TABLE driver_shifts DROP COLUMN IF EXISTS locked_until;
ALTER TABLE driver_shifts DROP COLUMN IF EXISTS is_overtime;
ALTER TABLE driver_shifts DROP COLUMN IF EXISTS overtime_reason;
ALTER TABLE driver_shifts DROP COLUMN IF EXISTS weekly_hours_total;
ALTER TABLE driver_shifts DROP COLUMN IF EXISTS shift_index_in_week;
ALTER TABLE driver_shifts DROP COLUMN IF EXISTS week_start_date;
