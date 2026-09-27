-- ============================================================
--  VallorSoft — Ismétlődő fuvar-sablonok (idempotens)
--
--  Gyakori útvonal (pl. ugyanaz az ügyfél, Cluj → Wien) egy kattintással
--  újra kiírható. A sablon a fuvar-kiíró űrlap ÚJRAHASZNÁLHATÓ részét tárolja
--  (ügyfél, állomások a bevitel sorrendjében DÁTUM NÉLKÜL, rakomány-típus,
--  súly, méret, ár, km, jármű-rendszámok). A dátumot / referenciát / UIT-ot
--  a diszpécser minden kiíráskor újra adja meg.
--
--  A `fields` JSONB-t MINDIG a szerver állítja össze a meglévő fuvarból
--  (handlers/orderTemplates.js) — a kliens nem küldhet tetszőleges tartalmat.
--  Multi-tenant: minden lekérdezés company_id-szűrt.
-- ============================================================
CREATE TABLE IF NOT EXISTS order_templates (
  id            SERIAL PRIMARY KEY,
  company_id    INTEGER NOT NULL,
  name          VARCHAR(120) NOT NULL,
  fields        JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_order_id VARCHAR(50),
  use_count     INTEGER NOT NULL DEFAULT 0,
  last_used_at  TIMESTAMPTZ,
  created_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_templates_company ON order_templates (company_id);
