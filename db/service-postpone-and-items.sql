-- ============================================================
--  VallorSoft — szerviz-esedékesség halasztás + elvégzett tétel-lista (idempotens)
--  A vehicle_service_log a következő új mezőket kapja:
--    - items JSONB DEFAULT '[]'      → pipált tételek fehérlistás kulccsal
--                                       (pl. oil, oil_filter, air_filter…) + opc.
--                                       'other' szabad-szöveggel.
--    - postpone_count INT DEFAULT 0  → hányszor halasztották az adott esedékességet
--                                       (statisztikai / audit-jellegű).
--    - last_postponed_at TIMESTAMPTZ → utolsó halasztás időpontja.
--    - closed_at TIMESTAMPTZ         → mikor lett "elvégezve" (lezárva) a régi
--                                       esedékesség; az új szerviz-sor önálló
--                                       bejegyzés lesz, de a régi is megmarad
--                                       történetnek.
--    - closed_by_service_id INTEGER  → a lezáró (új) szerviz-bejegyzés id-je,
--                                       audit-lánc a régi és az új között.
-- ============================================================

ALTER TABLE vehicle_service_log ADD COLUMN IF NOT EXISTS items JSONB DEFAULT '[]'::jsonb;
ALTER TABLE vehicle_service_log ADD COLUMN IF NOT EXISTS postpone_count INTEGER DEFAULT 0;
ALTER TABLE vehicle_service_log ADD COLUMN IF NOT EXISTS last_postponed_at TIMESTAMPTZ;
ALTER TABLE vehicle_service_log ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
ALTER TABLE vehicle_service_log ADD COLUMN IF NOT EXISTS closed_by_service_id INTEGER REFERENCES vehicle_service_log(id) ON DELETE SET NULL;
