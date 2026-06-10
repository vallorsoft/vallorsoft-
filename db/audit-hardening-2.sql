-- ============================================================
-- VallorSoft — audit-hardening 2. kör (idempotens)
--   - redundáns index törlése: a users.email UNIQUE constraint
--     már ad indexet, az idx_users_email duplikátum volt
-- ============================================================
DROP INDEX IF EXISTS idx_users_email;
