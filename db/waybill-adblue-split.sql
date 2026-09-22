-- ============================================================
--  MENETLEVÉL: AdBlue külön számolása a dízeltől (idempotens)
-- ============================================================
--  Gyökér: a beküldő/szerkesztő utak a tankolás-sorok literét TÍPUS
--  NÉLKÜL adták össze (`total_alim`), így egy AdBlue-töltés is a
--  dízel-fogyasztásba került → felnyomta a `motorina_folosit`-ot és a
--  `consum_100`-at, és hamis eltérés-riasztást generált a sofőrnek
--  (>38 L/100km) és a managernek (>2.5 L/100km eltérés).
--
--  Mostantól: `total_alim` = CSAK dízel, az új `total_adblue` a másik.
--  A JS-párja: `lib/waybillTotals.js` `computeFuelTotals`.
--
--  A visszamenőleges feltöltés a `alimentari` JSONB-ből számol újra — az
--  az igazságforrás, a derivált oszlopok csak belőle képződnek. Ezért a
--  migráció TÖBBSZÖR is lefuttatható, mindig ugyanazt az eredményt adja.

ALTER TABLE fuvarlevelek ADD COLUMN IF NOT EXISTS total_adblue NUMERIC(10,2) DEFAULT 0;

-- Visszamenőleges újraszámolás. Az AdBlue-illesztés whitespace- és
-- kis/nagybetű-független (mint a JS `isAdblueRow`), mert a sor jöhet AI
-- bon-kiolvasásból vagy kézi szerkesztésből is. Típus nélküli sor = dízel.
WITH sums AS (
  SELECT f.id,
         COALESCE(SUM(CASE WHEN REPLACE(COALESCE(a.elem->>'tip',''), ' ', '') ILIKE '%adblue%'
                           THEN 0 ELSE COALESCE((a.elem->>'litru')::numeric, 0) END), 0) AS diesel_l,
         COALESCE(SUM(CASE WHEN REPLACE(COALESCE(a.elem->>'tip',''), ' ', '') ILIKE '%adblue%'
                           THEN COALESCE((a.elem->>'litru')::numeric, 0) ELSE 0 END), 0) AS adblue_l
  FROM fuvarlevelek f
  LEFT JOIN LATERAL jsonb_array_elements(
         CASE WHEN jsonb_typeof(f.alimentari) = 'array' THEN f.alimentari ELSE '[]'::jsonb END
       ) AS a(elem) ON TRUE
  GROUP BY f.id
)
UPDATE fuvarlevelek f
SET total_alim    = ROUND(s.diesel_l, 2),
    total_adblue  = ROUND(s.adblue_l, 2),
    motorina_folosit = ROUND(GREATEST(0,
        COALESCE(f.cant_inceput, 0) + ROUND(s.diesel_l, 2) - COALESCE(f.cant_sfarsit, 0)), 2),
    consum_100 = CASE
        WHEN COALESCE(f.total_km, 0) > 0
        THEN ROUND(GREATEST(0, COALESCE(f.cant_inceput, 0) + ROUND(s.diesel_l, 2) - COALESCE(f.cant_sfarsit, 0))
                   / f.total_km * 100, 2)
        ELSE 0 END
FROM sums s
WHERE s.id = f.id
  -- Csak ott írunk, ahol tényleg változik (a migráció újrafuttatása így no-op).
  AND (f.total_alim IS DISTINCT FROM ROUND(s.diesel_l, 2)
       OR COALESCE(f.total_adblue, -1) IS DISTINCT FROM ROUND(s.adblue_l, 2));
