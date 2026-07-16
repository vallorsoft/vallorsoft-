-- ============================================================
--  VallorSoft — fuvarlevelek company_id: rendszám-alapú visszaállítás (idempotens)
--
--  KIEGÉSZÍTÉS a fuvarlevelek-documents-company-id.sql-hez. Az ADMIN által kézzel
--  létrehozott menetlevélnek jellemzően NINCS fuvar-hivatkozása (order_ids üres —
--  egy időszak összesített keresetéből születik), ezért a fuvar-alapú backfill
--  nem éri el. Ha viszont egy MÁR törölt sofőrhöz volt rendelve, company_id NULL
--  marad → láthatatlan.
--
--  Itt a menetlevélen rögzített RENDSZÁMBÓL (numar_camion, majd numar_remorca)
--  következtetünk a cégre: ha a (normalizált) rendszám EGYÉRTELMŰEN egyetlen cég
--  járművéhez (vehicles.rendszam) tartozik, a menetlevél annak a cégnek a horgonyát
--  kapja. Az egyértelműség (ncomp = 1) feltétel megakadályozza, hogy két cég közös
--  rendszáma miatt rossz céghez kerüljön (nincs cross-tenant elszivárgás).
-- ============================================================

-- Normalizált rendszám → company_id, CSAK az egyértelmű (egyetlen céghez tartozó) esetekre
WITH plate_company AS (
  SELECT UPPER(REGEXP_REPLACE(rendszam, '[^A-Za-z0-9]', '', 'g')) AS plate,
         MIN(company_id) AS company_id,
         COUNT(DISTINCT company_id) AS ncomp
  FROM vehicles
  WHERE COALESCE(TRIM(rendszam), '') <> ''
  GROUP BY 1
)
UPDATE fuvarlevelek f SET company_id = pc.company_id
  FROM plate_company pc
 WHERE f.company_id IS NULL
   AND pc.ncomp = 1
   AND COALESCE(TRIM(f.numar_camion), '') <> ''
   AND UPPER(REGEXP_REPLACE(f.numar_camion, '[^A-Za-z0-9]', '', 'g')) = pc.plate;

-- Ha a vontató rendszáma nem adott, próbáljuk a pótkocsiét (numar_remorca)
WITH plate_company AS (
  SELECT UPPER(REGEXP_REPLACE(rendszam, '[^A-Za-z0-9]', '', 'g')) AS plate,
         MIN(company_id) AS company_id,
         COUNT(DISTINCT company_id) AS ncomp
  FROM vehicles
  WHERE COALESCE(TRIM(rendszam), '') <> ''
  GROUP BY 1
)
UPDATE fuvarlevelek f SET company_id = pc.company_id
  FROM plate_company pc
 WHERE f.company_id IS NULL
   AND pc.ncomp = 1
   AND COALESCE(TRIM(f.numar_remorca), '') <> ''
   AND UPPER(REGEXP_REPLACE(f.numar_remorca, '[^A-Za-z0-9]', '', 'g')) = pc.plate;
