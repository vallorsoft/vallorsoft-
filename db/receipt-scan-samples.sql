-- ============================================================
--  VallorSoft — Bon-scanner tanuló minták (receipt_scan_samples)
--  Inkrementális migráció (idempotens) — automatikusan lefut induláskor.
--
--  A sofőr a főoldali „📷 Bon szkennelés" gombbal fotózza a bont, majd a
--  review-modalban ELFOGADJA (esetleg javítja) a Gemini kiolvasott
--  mezőit. Az `handlers/receiptScan.js confirmReceiptExtraction`
--  upsert-tel eltárolja ide (cégenként, merchant-kulcsonként — a `loc`
--  első jelentős szava normalizálva, pl. „MOL Arad" → „mol"; „OMV
--  Petrom Bucuresti" → „omv"). A KÖVETKEZŐ `scanReceipt` hívás a cég
--  legutóbbi 5 egyedi merchant-mintáját few-shot példaként hozzácsatolja
--  a Gemini system-prompthoz → azonos lánc bonjai konzisztensebben
--  kiolvasva.
--
--  Multi-tenant: minden minta CÉGHEZ tartozik (FK CASCADE).
--  Egyediségi kulcs: (company_id, merchant_key) — merchantonként EGY
--  aktív minta, a legutóbb megerősített felülírja a régit (self-healing:
--  ha a Gemini rossz mezőt tárolt korábban, a javított bevitel javít).
--  Nem személyes adat (a fields JSONB csak bon-mezőket tárol: loc, kind,
--  tip, plata, valuta, produs — sofőr-név/kártyaszám sosem kerül ide).
-- ============================================================

CREATE TABLE IF NOT EXISTS receipt_scan_samples (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  merchant_key TEXT NOT NULL,           -- normalizált első szó: "mol", "omv", "kaufland"
  merchant_label TEXT,                  -- eredeti loc-felirat: "MOL Arad"
  fields JSONB NOT NULL,                -- a megerősített kiolvasott mezők
  sample_count INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Egyediségi kulcs: cégenként/merchantenként egy sor (ON CONFLICT DO UPDATE)
CREATE UNIQUE INDEX IF NOT EXISTS uq_receipt_scan_samples_company_merchant
  ON receipt_scan_samples (company_id, merchant_key);

-- Gyors listázás a scanReceipt few-shot betöltésénél (top-N by updated_at)
CREATE INDEX IF NOT EXISTS idx_receipt_scan_samples_updated_at
  ON receipt_scan_samples (company_id, updated_at DESC);
