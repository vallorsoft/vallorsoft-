-- Fizetős archiválás: a ténylegesen a Cloudflare R2-n tárolt méret ellenőrzése.
-- size_source: 'cloudflare' (a meglévő R2-példány valós mérete) | 'estimate' (a DB-ből becsült)
ALTER TABLE doc_archive_orders ADD COLUMN IF NOT EXISTS size_source       VARCHAR(12);
ALTER TABLE doc_archive_orders ADD COLUMN IF NOT EXISTS actual_bytes      BIGINT;      -- R2-n mért méret
ALTER TABLE doc_archive_orders ADD COLUMN IF NOT EXISTS actual_checked_at TIMESTAMPTZ;
ALTER TABLE doc_archive_orders ADD COLUMN IF NOT EXISTS size_flag         VARCHAR(12); -- ok | over_tier
ALTER TABLE doc_archive_cloud  ADD COLUMN IF NOT EXISTS verified_at       TIMESTAMPTZ;
