-- ============================================================
--  VallorSoft — fuvar rakomány-típus (idempotens)
--  orders.load_type: 'FTL' (Full Truck Load — teljes rakomány) |
--                    'LTL' (Less Than Truckload — részrakomány) | NULL.
--  A kiíró/szerkesztő űrlapon két egymást kizáró pipa; a fuvarlistán
--  badge jelzi, hogy teljes áru-e vagy sem.
-- ============================================================

ALTER TABLE orders ADD COLUMN IF NOT EXISTS load_type VARCHAR(3);
