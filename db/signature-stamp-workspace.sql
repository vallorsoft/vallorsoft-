-- ============================================================
--  VallorSoft — Aláírás + pecsét szétválasztása + PDF munkatér
--  ------------------------------------------------------------
--  A régi `stamps` táblában EGYETLEN `base64_png` oszlop volt, ezért
--  a user vagy csak aláírást, vagy csak pecsétet tudott menteni —
--  együtt nem. Most külön mezőket kap: `signature_base64` és
--  `stamp_base64`. A régi `base64_png` MEGMARAD backward compatibility
--  végett (a `stampSave`/`stampGet` legacy handler-ek arra írnak
--  továbbra is: azt a képet, amit a menetlevél PDF-be „ráégetjük" —
--  ez a mostani viselkedés a sofőr-PDF-ben).
--
--  PDF munkatér (`pdf_workspace_docs`) — az admin/manager az „Aláírás
--  és pecsét" menüben tetszőleges PDF-et feltölthet, aláír/pecsétel,
--  és letölti. A tárolás per-user, kizárólag 24 óráig — utána egy
--  ütemező (services/scheduler.js `startPdfWorkspaceCleanup`) törli.
-- ============================================================

-- Aláírás és pecsét külön oszlopokban (a base64_png megmarad legacy-ként).
ALTER TABLE stamps ADD COLUMN IF NOT EXISTS signature_base64 TEXT;
ALTER TABLE stamps ADD COLUMN IF NOT EXISTS stamp_base64     TEXT;

-- Egyszeri backfill: aki eddig mentett képet (base64_png), az jelenjen
-- meg a pecsét mezőben is (a `stampGet` legacy-út a menetlevél PDF-hez
-- ezt használta). Az aláírást KÉZZEL kell újra létrehoznia a usernek —
-- eddig felül lehetett írni, nem tároltuk külön.
UPDATE stamps
   SET stamp_base64 = base64_png
 WHERE stamp_base64 IS NULL
   AND base64_png IS NOT NULL;

-- PDF munkatér — per-user, 24h retention.
CREATE TABLE IF NOT EXISTS pdf_workspace_docs (
  id              VARCHAR(40) PRIMARY KEY,
  user_email      VARCHAR(255) NOT NULL,
  company_id      INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  file_name       VARCHAR(300) NOT NULL,
  original_base64 TEXT NOT NULL,
  signed_base64   TEXT,
  file_size       INTEGER,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pdf_workspace_docs_user_created
  ON pdf_workspace_docs(user_email, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pdf_workspace_docs_created
  ON pdf_workspace_docs(created_at);
