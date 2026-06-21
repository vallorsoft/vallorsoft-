-- ============================================================
--  VallorSoft — Fuvar-szériák (több, választható fuvar-szám előtag)
--  Inkrementális migráció — idempotens, többször futtatható.
--
--  Eddig a fuvar-szám előtagja fixen 'CMD' volt. Ettől kezdve a cég
--  SAJÁT MAGÁNAK állíthatja (mint a menetlevél-szériát): alapból 'CMD',
--  de új szériát is felvehet, és fuvar-kiíráskor választhat közülük.
--
--  Modell:
--    - order_series: a cég választható fuvar-szériái (megjelenített
--      `prefix` + belső `seq_key`). Az egyik `is_default`.
--    - A tényleges számláló a meglévő `document_series` táblában él,
--      doc_type = order_series.seq_key kulccsal (per-év, mint az MT).
--    - A `prefix` ELVÁLIK a `seq_key`-től → az előtag átnevezhető a
--      számlálás megszakítása nélkül (a seq_key marad).
--
--  FONTOS: a belső orders.id (véletlen kulcs) VÁLTOZATLAN — a szériák
--  csak a megjelenített fuvar-számot (fuvar_no) befolyásolják.
--
--  Az alapértelmezett 'CMD' széria seq_key='CMD' → a korábban már
--  felépített `document_series` doc_type='CMD' számláló folytatódik.
-- ============================================================

CREATE TABLE IF NOT EXISTS order_series (
  id          SERIAL PRIMARY KEY,
  company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  prefix      VARCHAR(20) NOT NULL,         -- megjelenített előtag (pl. CMD, TR)
  seq_key     VARCHAR(30) NOT NULL,         -- document_series.doc_type (belső számláló-kulcs)
  is_default  BOOLEAN     NOT NULL DEFAULT false,
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW(),
  UNIQUE (company_id, prefix)
);

CREATE INDEX IF NOT EXISTS idx_order_series_company ON order_series (company_id);

-- Minden meglévő cég kap egy alapértelmezett 'CMD' szériát (seq_key='CMD'),
-- de CSAK ha még egyetlen szériája sincs (idempotens).
INSERT INTO order_series (company_id, prefix, seq_key, is_default)
SELECT c.id, 'CMD', 'CMD', true
  FROM companies c
 WHERE NOT EXISTS (SELECT 1 FROM order_series os WHERE os.company_id = c.id)
ON CONFLICT (company_id, prefix) DO NOTHING;
