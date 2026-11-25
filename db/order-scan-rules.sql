-- ============================================================
--  VallorSoft — Megbízás-kiolvasás: tanulás a javításokból
--  Inkrementális migráció (idempotens) — automatikusan lefut induláskor.
--
--  order_scan_jobs  — egy kiolvasás szövege + eredménye, amíg a diszpécser a
--                     fuvart elmenti (max. 3 napig, utána törlődik). A szöveg a
--                     saját szerveren marad (lib/docPrivacy), csak a cégé.
--  order_scan_rules — megbízónként tanult címkék: „ennél a megbízónál a
--                     felrakás helye a »Locul incarcarii:« felirat után áll".
--                     Csak a CÍMKE tárolódik, az érték (személyes adat) nem.
--  order_scan_samples.cui — a megbízó felismerése a dokumentumban a CUI-ja alapján.
-- ============================================================

CREATE TABLE IF NOT EXISTS order_scan_jobs (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  text TEXT,
  extracted JSONB NOT NULL DEFAULT '{}'::jsonb,
  template_key VARCHAR(60),
  applied JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_order_scan_jobs_company ON order_scan_jobs (company_id, created_at);

CREATE TABLE IF NOT EXISTS order_scan_rules (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  template_key VARCHAR(60) NOT NULL,
  field VARCHAR(40) NOT NULL,
  anchor VARCHAR(80) NOT NULL,
  mode VARCHAR(10) NOT NULL DEFAULT 'same',
  hits INTEGER NOT NULL DEFAULT 1,
  misses INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, template_key, field, anchor, mode)
);
CREATE INDEX IF NOT EXISTS idx_order_scan_rules_tpl ON order_scan_rules (company_id, template_key);

ALTER TABLE order_scan_samples ADD COLUMN IF NOT EXISTS cui VARCHAR(20);

-- A régi (értékalapú) tanult mezők kiürítése: pénznemet / FTL-LTL-t / méretet nem
-- tanulunk többé (megbízónként is fuvaronként változik). A megbízó neve megmarad.
UPDATE order_scan_samples SET fields = '{}'::jsonb WHERE fields <> '{}'::jsonb;
