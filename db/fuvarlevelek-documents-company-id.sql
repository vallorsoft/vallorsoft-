-- ============================================================
--  VallorSoft — fuvarlevelek + documents company_id horgony (idempotens)
--
--  GYÖKÉROK: a menetlevél (fuvarlevelek) és a sofőr-dokumentum (documents)
--  eddig CSAK az email_sofer → users.company_id joinon át kötődött a céghez.
--  Ha a belső sofőrt (users sor) törölték, a join megszakadt → a menetlevelei
--  és feltöltött dokumentumai "eltűntek" a cég nézetéből (bár fizikailag
--  megmaradtak a táblában). Emiatt lehet egy cégnek 0 látható menetlevele,
--  pedig valójában több is van a törölt sofőrökhöz kötve.
--
--  JAVÍTÁS: közvetlen company_id oszlop, ami TÚLÉLI a sofőr törlését. A cég-
--  szűrés innentől erre horgonyoz (a régi email-join fallbackként megmarad).
--  Visszamenőleges feltöltés két forrásból:
--   1) a még létező sofőr users.company_id-jából (email-egyezés);
--   2) az ÁRVA soroknál (törölt sofőr) a hivatkozott fuvar cége alapján
--      (fuvarlevelek.order_ids első eleme / documents.order_id → orders.company_id)
--      — így a MÁR törölt sofőrök menetlevelei is visszakerülnek a helyes céghez.
-- ============================================================

ALTER TABLE fuvarlevelek ADD COLUMN IF NOT EXISTS company_id INTEGER;
ALTER TABLE documents    ADD COLUMN IF NOT EXISTS company_id INTEGER;

-- 1) A még létező sofőr e-mailje alapján
UPDATE fuvarlevelek f SET company_id = u.company_id
  FROM users u
 WHERE f.company_id IS NULL AND LOWER(f.email_sofer) = LOWER(u.email);

UPDATE documents d SET company_id = u.company_id
  FROM users u
 WHERE d.company_id IS NULL AND LOWER(d.email_sofer) = LOWER(u.email);

-- 2) Árva menetlevél (törölt sofőr): a hivatkozott fuvar cége (order_ids[0])
UPDATE fuvarlevelek f SET company_id = o.company_id
  FROM orders o
 WHERE f.company_id IS NULL
   AND jsonb_typeof(f.order_ids) = 'array'
   AND jsonb_array_length(f.order_ids) > 0
   AND o.id = (f.order_ids->>0);

-- 2b) Árva dokumentum (törölt sofőr): a hivatkozott fuvar cége (order_id)
UPDATE documents d SET company_id = o.company_id
  FROM orders o
 WHERE d.company_id IS NULL AND d.order_id IS NOT NULL AND o.id = d.order_id;

CREATE INDEX IF NOT EXISTS idx_fuvarlevelek_company ON fuvarlevelek(company_id);
CREATE INDEX IF NOT EXISTS idx_documents_company    ON documents(company_id);
