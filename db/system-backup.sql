-- Teljes rendszer-mentés (services/systemBackup.js) a saját Cloudflare R2 tárhelyre:
-- havonta egy teljes adatbázis-mentés (pg_dump), utána minden éjjel csak a változások.
--
-- sys_change_log: melyik sor változott (tábla + elsődleges kulcs + művelet) — magát
-- az adatot NEM másolja (a mentéskor a sor aktuális állapotát olvassuk ki). A
-- triggereket a szerver telepíti induláskor minden elsődleges kulcsos táblára.
CREATE TABLE IF NOT EXISTS sys_change_log (
  id   BIGSERIAL PRIMARY KEY,
  tbl  TEXT NOT NULL,
  pk   JSONB,
  op   CHAR(1) NOT NULL,          -- I | U | D | T (truncate)
  at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS system_backup_runs (
  id           SERIAL PRIMARY KEY,
  kind         VARCHAR(8) NOT NULL,              -- full | delta
  status       VARCHAR(12) NOT NULL DEFAULT 'running',
  trigger      VARCHAR(12),
  base_key     TEXT,                             -- a delta melyik teljes mentésre épül
  watermark    BIGINT,                           -- sys_change_log.id eddig mentve
  r2_key       TEXT,
  bytes        BIGINT,
  row_count    INTEGER,
  table_count  INTEGER,
  pg_version   TEXT,
  error        TEXT,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_sbr_started ON system_backup_runs (started_at DESC);
