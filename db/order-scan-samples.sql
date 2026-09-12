-- ============================================================
--  VallorSoft — Megrendelés-kiolvasó tanuló minták (order_scan_samples)
--  Inkrementális migráció (idempotens) — automatikusan lefut induláskor.
--
--  A diszpécser a Fuvar kiírás oldalon feltölt egy megrendelőt (PDF/JPG),
--  a Gemini AI kiolvassa a mezőket, előtölti az űrlapot; amikor a fuvar
--  ténylegesen MENTÉSRE KERÜL (a diszpécser áttekintette + jóváhagyta),
--  az `handlers/orderScan.js confirmOrderScanTemplate` upsert-tel eltárolja
--  ide a cég ügyfél/kibocsátó szerinti sablonját (a `client` első jelentős
--  szava normalizálva — pl. „Vallor Logistics SRL" → „vallor"). A KÖVETKEZŐ
--  `scanOrderDocument` hívás a cég legutóbbi 5 egyedi ügyfél-mintáját
--  few-shot példaként hozzácsatolja a Gemini system-prompthoz → azonos
--  megbízó megrendelői konzisztensebben kiolvasva.
--
--  A minta tanulja meg a STABIL mezőket: valuta (általában rögzített egy
--  ügyfélnél), load_type, tipikus rakomány-méretek (hossz/szél/mag),
--  a firma_incarcare/firma_descarcare cégnév-formátum, tipikusan hány
--  pickup/delivery pont van. A VÁLTOZÓ mezők (dátum, ár, km, rendszám)
--  szándékosan kimaradnak a promptból (a Gemini ne másolja őket).
--
--  Multi-tenant: minden minta CÉGHEZ tartozik (FK CASCADE).
--  Egyediségi kulcs: (company_id, template_key) — ügyfélenként EGY aktív
--  minta, self-healing: a legutóbb megerősített felülírja a régit.
--  Nem személyes adat (a fields JSONB csak a fuvar STRUKTÚRÁJÁT tárolja:
--  valuta, load_type, méretek, cégnevek — sofőr/kártya/ár SOHA).
-- ============================================================

CREATE TABLE IF NOT EXISTS order_scan_samples (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  template_key TEXT NOT NULL,           -- normalizált ügyfél-név: "vallor", "dhl", "kuehne"
  template_label TEXT,                  -- eredeti client-név: "Vallor Logistics SRL"
  fields JSONB NOT NULL,                -- a megerősített kiolvasott stabil mezők
  sample_count INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Egyediségi kulcs: cégenként/ügyfélenként egy sor (ON CONFLICT DO UPDATE)
CREATE UNIQUE INDEX IF NOT EXISTS uq_order_scan_samples_company_template
  ON order_scan_samples (company_id, template_key);

-- Gyors listázás a scanOrderDocument few-shot betöltésénél (top-N by updated_at)
CREATE INDEX IF NOT EXISTS idx_order_scan_samples_updated_at
  ON order_scan_samples (company_id, updated_at DESC);
