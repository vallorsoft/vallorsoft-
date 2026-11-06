-- ============================================================
--  Biztonsági mentés visszaállítása: feladat-napló (előnézet → megerősítés → futás).
--  A visszaállítás NEM töröl és NEM ír felül: csak a mentésben meglévő,
--  de az adatbázisból hiányzó (törölt) sorokat hozza vissza.
--  Idempotens.
-- ============================================================
CREATE TABLE IF NOT EXISTS company_backup_restores (
  id           SERIAL PRIMARY KEY,
  company_id   INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  run_id       INTEGER NOT NULL,
  source       VARCHAR(10) NOT NULL,              -- 'company' | 'vs'
  status       VARCHAR(20) NOT NULL DEFAULT 'analyzing', -- analyzing | preview_ready | restoring | done | error
  preview      JSONB,
  result       JSONB,
  error        TEXT,
  requested_by INTEGER,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_company_backup_restores_company
  ON company_backup_restores (company_id, created_at DESC);
