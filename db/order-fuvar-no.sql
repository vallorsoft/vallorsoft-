-- ============================================================
--  VallorSoft — Fuvar (order) ember-olvasható sorszám
--  Inkrementális migráció — idempotens, többször futtatható.
--
--  Eddig a fuvar azonosítója csak a belső, véletlenszerű kulcs
--  volt (orders.id, pl. CMD-MBKZ41X07AF) — gép-barát, de csúnya
--  és nem sorszámozott. Ez a migráció bevezet egy cégenként/
--  évenként növekvő, ember-olvasható fuvar-számot (CMD-YYYY-XXXX),
--  amit a felület/PDF mutat. A belső orders.id VÁLTOZATLAN marad
--  (minden hivatkozás/FK rá épül) — ez csak megjelenítési szám.
--
--  A sorszámozás a meglévő `document_series` táblát használja
--  (doc_type='CMD'), ugyanúgy, mint a menetlevél (MT-YYYY-XXXX).
--  A `document-series.sql` az ABC-sorrendben ELŐBB fut → a tábla
--  és az UNIQUE(company_id,doc_type,year) constraint már megvan.
-- ============================================================

ALTER TABLE orders ADD COLUMN IF NOT EXISTS fuvar_no VARCHAR(30);

CREATE INDEX IF NOT EXISTS idx_orders_fuvar_no ON orders (company_id, fuvar_no);

-- Visszamenőleges feltöltés a meglévő fuvarokra: cégenként/évenként
-- (a fuvar created_at éve) növekvő sorszám, létrehozás-sorrendben.
-- Csak a még üres (fuvar_no IS NULL) fuvarokra fut → idempotens.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'fuvar_no'
  ) THEN
    -- 1) Sorszámok kiosztása a backfillelendő fuvarokra
    WITH numbered AS (
      SELECT o.id,
             EXTRACT(YEAR FROM COALESCE(o.created_at, NOW()))::int AS yr,
             ROW_NUMBER() OVER (
               PARTITION BY o.company_id, EXTRACT(YEAR FROM COALESCE(o.created_at, NOW()))
               ORDER BY o.created_at NULLS FIRST, o.id
             ) AS seq
        FROM orders o
       WHERE o.company_id IS NOT NULL
         AND o.fuvar_no IS NULL
    )
    UPDATE orders o
       SET fuvar_no = 'CMD-' || n.yr || '-' || LPAD(n.seq::text, 4, '0')
      FROM numbered n
     WHERE o.id = n.id;

    -- 2) A 'CMD' sorszám-számláló szinkronizálása a backfillelt maximumra,
    --    hogy az ÚJ fuvarok onnan folytassák (cégenként/évenként).
    INSERT INTO document_series (company_id, doc_type, prefix, year, current_seq)
    SELECT o.company_id, 'CMD', 'CMD',
           EXTRACT(YEAR FROM COALESCE(o.created_at, NOW()))::int AS yr,
           COUNT(*)::int
      FROM orders o
     WHERE o.company_id IS NOT NULL
       AND o.fuvar_no IS NOT NULL
     GROUP BY o.company_id, EXTRACT(YEAR FROM COALESCE(o.created_at, NOW()))
    ON CONFLICT (company_id, doc_type, year)
      DO UPDATE SET current_seq = GREATEST(document_series.current_seq, EXCLUDED.current_seq),
                    updated_at = NOW();
  END IF;
END $$;
