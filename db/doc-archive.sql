-- Dokumentum-letöltések naplója + kötelező éves cég-archívum (lib/docArchive.js).
--
-- 1) Menetlevél-iratok összefűzött PDF-letöltése: minden letöltés naplózva (ki, mikor,
--    mely iratok), és a letöltött változat 1 évig újra letölthető (pdf_data).
--    Ebből látszik a listán, hogy a menetlevél le van-e töltve, és került-e hozzá
--    irat a letöltés óta.
CREATE TABLE IF NOT EXISTS waybill_doc_downloads (
  id             SERIAL PRIMARY KEY,
  company_id     INTEGER NOT NULL,
  waybill_id     VARCHAR(20) NOT NULL,
  file_name      VARCHAR(255),
  doc_keys       JSONB NOT NULL DEFAULT '[]'::jsonb,   -- ['wb:FUV-1', 'od:12', 'drv:9']
  doc_count      INTEGER NOT NULL DEFAULT 0,
  pdf_data       BYTEA,
  pdf_size       INTEGER,
  sha256         VARCHAR(64),
  downloaded_by  VARCHAR(255),
  downloaded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at     TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '365 days')
);
CREATE INDEX IF NOT EXISTS idx_wdl_company_wb ON waybill_doc_downloads (company_id, waybill_id, downloaded_at DESC);

-- 2) Teljes cég-dokumentum archívum: a letöltött ZIP-ben lévő kódot vissza kell
--    írni (csak a kód kivonata tárolódik). A visszaigazolás új 1 éves ciklust indít.
CREATE TABLE IF NOT EXISTS company_doc_archives (
  id            SERIAL PRIMARY KEY,
  company_id    INTEGER NOT NULL,
  code_hash     VARCHAR(64) NOT NULL,
  created_by    VARCHAR(255),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed     BOOLEAN NOT NULL DEFAULT FALSE,
  file_count    INTEGER,
  total_bytes   BIGINT,
  confirmed_at  TIMESTAMPTZ,
  confirmed_by  VARCHAR(255)
);
CREATE INDEX IF NOT EXISTS idx_cda_company ON company_doc_archives (company_id, created_at DESC);

-- Az archiválási határidő cégenként. A meglévő cégeknek legalább 35 nap jut (így
-- előbb 30 napig figyelmeztetést kapnak, nem zárolódnak azonnal).
ALTER TABLE companies ADD COLUMN IF NOT EXISTS doc_archive_due_at TIMESTAMPTZ;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS doc_archive_notice_days INTEGER;
UPDATE companies
   SET doc_archive_due_at = GREATEST(COALESCE(created_at, NOW()) + INTERVAL '365 days', NOW() + INTERVAL '35 days')
 WHERE doc_archive_due_at IS NULL;
