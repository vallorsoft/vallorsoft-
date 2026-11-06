-- ============================================================
--  Cégenkénti automatikus biztonsági mentés Google Drive-ba.
--  - company_backup_settings: a cég beállításai (be/ki, óra, megőrzés a cég Drive-ján)
--  - company_backup_runs:     minden mentés-futás naplója (cél Drive-fájl azonosítókkal)
--  A Drive-kapcsolat hitelesítője a company_integrations-ben él
--  (provider='gdrive_backup', AES-titkosított refresh token);
--  a VallorSoft saját Drive-ja a developer_settings 'backup_vs_drive' kulcsán.
--  Idempotens.
-- ============================================================
CREATE TABLE IF NOT EXISTS company_backup_settings (
  company_id      INTEGER PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  enabled         BOOLEAN NOT NULL DEFAULT true,
  run_hour        SMALLINT NOT NULL DEFAULT 2 CHECK (run_hour BETWEEN 0 AND 23),
  drive_retention VARCHAR(10) NOT NULL DEFAULT 'forever',
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS company_backup_runs (
  id            SERIAL PRIMARY KEY,
  company_id    INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  trigger       VARCHAR(20) NOT NULL DEFAULT 'schedule',   -- 'schedule' | 'manual'
  kind          VARCHAR(10) NOT NULL DEFAULT 'full',       -- 'full' (a különbség-mentés a következő körben)
  status        VARCHAR(20) NOT NULL DEFAULT 'running',    -- 'running' | 'ok' | 'partial' | 'error'
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  file_name     TEXT,
  size_bytes    BIGINT,
  row_count     INTEGER,
  table_counts  JSONB,
  drive_file_id TEXT,          -- a cég saját Drive-ján
  drive_status  VARCHAR(20),   -- 'ok' | 'error' | 'skipped' | 'deleted'
  vs_file_id    TEXT,          -- a VallorSoft Drive-ján (30 nap)
  vs_status     VARCHAR(20),   -- 'ok' | 'error' | 'skipped' | 'deleted'
  error         TEXT
);
CREATE INDEX IF NOT EXISTS idx_company_backup_runs_company
  ON company_backup_runs (company_id, started_at DESC);
