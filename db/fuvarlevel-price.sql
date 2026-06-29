-- Menetlevél össz-bevétel mező (kézi menetlevél-készítéshez).
-- A kézzel (Admin/Manager) létrehozott menetlevelek NEM egy kiírt fuvarból
-- születnek, így nincs hozzájuk orders.pret bevétel. Ezért egy önálló,
-- nettó össz-ár mező (EUR), amelyet a statisztika a fuvar-bevételhez ad.
ALTER TABLE fuvarlevelek ADD COLUMN IF NOT EXISTS total_pret NUMERIC(12,2) DEFAULT 0;
