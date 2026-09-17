-- ============================================================
--  VallorSoft — Dokumentum-nyilvántartás (Registru documente)
--  Inkrementális migráció — idempotens, többször futtatható.
--  ------------------------------------------------------------
--  Általános célú dokumentum-sorszám nyilvántartás: a cég
--  CSOPORTOKBA (mappákba) szervezi a dokumentum-fajtáit (pl.
--  Facturi / Contracte / Avize), és minden csoportnak SAJÁT
--  automatikus sorszámozása van (pl. FCT-2026-0001). Egy
--  bejegyzés lehet FELTÖLTÖTT dokumentummal VAGY dokumentum
--  nélkül (FOGLALT/rezervált sorszám) — a rendszer mindkettőt
--  kezeli. A számláló cégenként + csoportonként + évenként él.
--
--  Multi-tenant: minden tábla company_id-vel horgonyzott.
-- ============================================================

-- ── 1. Csoportok (mappák) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS doc_register_groups (
  id          SERIAL PRIMARY KEY,
  company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        VARCHAR(120) NOT NULL,
  prefix      VARCHAR(20)  NOT NULL DEFAULT '',
  year_reset  BOOLEAN      NOT NULL DEFAULT TRUE,   -- évente újrakezd a sorszám
  pad         INTEGER      NOT NULL DEFAULT 4,       -- sorszám 0-feltöltés (0001)
  color       VARCHAR(9),                            -- opcionális mappa-szín chip
  notes       TEXT,
  created_by  VARCHAR(255),
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW(),
  UNIQUE (company_id, name)
);
CREATE INDEX IF NOT EXISTS idx_docreg_groups_company ON doc_register_groups(company_id);

-- ── 2. Sorszám-számláló (cég + csoport + év) ───────────────
--  year=0 → a csoport NEM évente-újrakezdős (folytonos számozás).
--  Az atomi növelés ON CONFLICT DO UPDATE mintával (mint a fuvar-szám).
CREATE TABLE IF NOT EXISTS doc_register_counters (
  id          SERIAL PRIMARY KEY,
  company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  group_id    INTEGER NOT NULL REFERENCES doc_register_groups(id) ON DELETE CASCADE,
  year        INTEGER NOT NULL DEFAULT 0,
  current_seq INTEGER NOT NULL DEFAULT 0,
  updated_at  TIMESTAMP DEFAULT NOW(),
  UNIQUE (company_id, group_id, year)
);

-- ── 3. Bejegyzések (kiadott sorszámok) ─────────────────────
CREATE TABLE IF NOT EXISTS doc_register_entries (
  id          SERIAL PRIMARY KEY,
  company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  group_id    INTEGER NOT NULL REFERENCES doc_register_groups(id) ON DELETE CASCADE,
  reg_no      VARCHAR(60) NOT NULL,        -- megjelenített sorszám (pl. FCT-2026-0001)
  seq         INTEGER,                      -- a számlálóból kapott sorszám (kézi számnál NULL)
  year        INTEGER,
  entry_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  title       VARCHAR(255),
  partner     VARCHAR(255),                 -- partner / kibocsátó / címzett
  amount      NUMERIC(14,2),
  currency    VARCHAR(8),
  notes       TEXT,
  status      VARCHAR(20) NOT NULL DEFAULT 'reserved',  -- with_doc | reserved | void
  created_by  VARCHAR(255),
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW(),
  UNIQUE (company_id, group_id, reg_no)
);
CREATE INDEX IF NOT EXISTS idx_docreg_entries_group ON doc_register_entries(company_id, group_id);
CREATE INDEX IF NOT EXISTS idx_docreg_entries_date  ON doc_register_entries(company_id, entry_date);

-- ── 4. Csatolt dokumentumok (base64 data URL, mint az order_documents) ──
CREATE TABLE IF NOT EXISTS doc_register_files (
  id          SERIAL PRIMARY KEY,
  company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  entry_id    INTEGER NOT NULL REFERENCES doc_register_entries(id) ON DELETE CASCADE,
  file_name   VARCHAR(300),
  mime        VARCHAR(100),
  data_base64 TEXT,                         -- data:...;base64,... forma
  file_size   INTEGER,
  uploaded_by VARCHAR(255),
  created_at  TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_docreg_files_entry ON doc_register_files(entry_id);
