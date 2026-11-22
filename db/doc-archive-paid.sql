-- Fizetős felhő-archiválás (lib/docArchive.js): a cég a kötelező éves letöltés helyett
-- archiválást is kérhet — éves díj sávosan: ≤1 GB 10 EUR, ≤5 GB 20, ≤15 GB 32, ≤50 GB 68,
-- afölött egyedi ajánlat (developer_settings 'archive_price' { tiers } felülírja).
-- A kérés után 48 óra a fizetési határidő; addig minden zár feloldva. A developer a
-- pénz beérkezése után aktiválja; onnan a letöltés a fizetett időszak végéig nem kötelező.
CREATE TABLE IF NOT EXISTS doc_archive_orders (
  id                 SERIAL PRIMARY KEY,
  company_id         INTEGER NOT NULL,
  reference          VARCHAR(40) NOT NULL UNIQUE,
  years              INTEGER NOT NULL,
  size_bytes         BIGINT,
  gb                 INTEGER NOT NULL,
  annual_eur         NUMERIC(10,2) NOT NULL,          -- a sáv éves díja
  amount_eur         NUMERIC(10,2) NOT NULL,
  amount_ron         NUMERIC(10,2),
  tva_ron            NUMERIC(10,2),
  total_ron          NUMERIC(10,2),
  bnr_rate           NUMERIC(8,4),
  status             VARCHAR(12) NOT NULL DEFAULT 'pending',   -- pending | paid | expired | cancelled
  requested_by       VARCHAR(255),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pay_until          TIMESTAMPTZ NOT NULL,
  activated_at       TIMESTAMPTZ,
  activated_by       VARCHAR(255),
  covered_until      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_dao_company ON doc_archive_orders (company_id, created_at DESC);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS doc_archive_paid_until TIMESTAMPTZ;

-- A fizetős archiválás felhő-pillanatképe (Cloudflare R2, AES-256-GCM titkosítva).
-- Cégenként egy aktuális példány; havonta frissül, amíg az archiválás aktív.
CREATE TABLE IF NOT EXISTS doc_archive_cloud (
  company_id   INTEGER PRIMARY KEY,
  status       VARCHAR(16) NOT NULL DEFAULT 'queued',   -- queued | running | ok | error | not_configured
  r2_key       TEXT,
  iv           VARCHAR(40),
  tag          VARCHAR(40),
  bytes        BIGINT,
  file_count   INTEGER,
  error        TEXT,
  started_at   TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
