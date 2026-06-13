-- db/audit-log.sql
-- Audit-napló a kritikus műveletekhez (belépés, törlés, szerepkör-váltás,
-- számlázás stb.). Best-effort írás a `lib/audit`-ból; a fő műveletet sosem
-- buktatja. Cégre szűrve olvasható (Admin) a getAuditLog handlerrel.
-- Idempotens. Futtatás: psql "$DATABASE_URL" -f db/audit-log.sql

CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  company_id  INTEGER,
  user_email  VARCHAR(255),
  action      VARCHAR(64) NOT NULL,
  entity_type VARCHAR(64),
  entity_id   VARCHAR(64),
  detail      JSONB,
  ip          VARCHAR(64),
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_company_time ON audit_log (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log (action);
