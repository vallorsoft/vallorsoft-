-- ============================================================
--  VallorSoft — Dokumentum-sorszámozás (menetlevél MT-YYYY-XXXX)
--  Inkrementális migráció — idempotens, többször futtatható.
--  A `schema.sql`-ben már szerepel, de a meglévő (régebbi) éles
--  adatbázisokon hiányozhat, ezért külön migrációként is rögzítjük.
--  Hiánya esetén a /api/fuvarlevel-save első lekérdezése elszáll
--  ("relation document_series does not exist") → "Szerver hiba".
-- ============================================================
CREATE TABLE IF NOT EXISTS document_series (
  id          SERIAL PRIMARY KEY,
  company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  doc_type    VARCHAR(20) NOT NULL DEFAULT 'MT',
  prefix      VARCHAR(20) NOT NULL DEFAULT 'MT',
  year        INTEGER     NOT NULL,
  current_seq INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW(),
  UNIQUE(company_id, doc_type, year)
);

-- Ha a tábla korábbról létezett az UNIQUE constraint nélkül, pótoljuk
-- (az ON CONFLICT (company_id, doc_type, year) különben 42P10 hibát dob).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'document_series'::regclass
      AND contype = 'u'
      AND conkey @> ARRAY[
        (SELECT attnum FROM pg_attribute WHERE attrelid='document_series'::regclass AND attname='company_id'),
        (SELECT attnum FROM pg_attribute WHERE attrelid='document_series'::regclass AND attname='doc_type'),
        (SELECT attnum FROM pg_attribute WHERE attrelid='document_series'::regclass AND attname='year')
      ]::smallint[]
  ) THEN
    ALTER TABLE document_series
      ADD CONSTRAINT document_series_company_id_doc_type_year_key
      UNIQUE (company_id, doc_type, year);
  END IF;
END $$;
