-- ============================================================
--  VallorSoft — Csoportos kifizetés (multi-select + vegyes valuta + több fizetési mód)
--  Idempotens migráció.
--
--  driver_payment_groups — egy csoportos kifizetés = N kijelölt tétel
--    (driver_earnings) + M fizetési mód (driver_payments), egy sofőrre.
--
--  driver_payment_group_items — melyik earning tartozik a csoporthoz
--    (a kliens által a modálban bepipált sorok). Egy earning EGY csoportba
--    tartozhat (UNIQUE); ha a felhasználó két külön csoportba akarja tenni,
--    előbb ki kell venni az elsőből.
--
--  driver_payments.group_id — új opcionális oszlop; ha be van állítva,
--    a payment a csoport része. NULL = "önálló" kifizetés (régi flow).
--    Egy csoportban több payment (vegyes valuta / vegyes mód).
--
--  Multi-tenant: minden lekérdezés company_id-szűrt.
-- ============================================================

CREATE TABLE IF NOT EXISTS driver_payment_groups (
  id            SERIAL PRIMARY KEY,
  company_id    INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  email_sofer   VARCHAR(255) NOT NULL,
  paid_at       DATE DEFAULT CURRENT_DATE,
  note          TEXT,
  created_by    VARCHAR(255),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_driver_payment_groups
  ON driver_payment_groups(company_id, email_sofer, paid_at);

CREATE TABLE IF NOT EXISTS driver_payment_group_items (
  id            SERIAL PRIMARY KEY,
  group_id      INTEGER NOT NULL REFERENCES driver_payment_groups(id) ON DELETE CASCADE,
  earning_id    INTEGER NOT NULL REFERENCES driver_earnings(id) ON DELETE CASCADE,
  UNIQUE (earning_id)  -- egy earning egyszerre egy csoportban lehet
);
CREATE INDEX IF NOT EXISTS idx_driver_payment_group_items
  ON driver_payment_group_items(group_id);

-- driver_payments.group_id — új opcionális FK
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'driver_payments' AND column_name = 'group_id'
  ) THEN
    ALTER TABLE driver_payments
      ADD COLUMN group_id INTEGER REFERENCES driver_payment_groups(id) ON DELETE SET NULL;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_driver_payments_group
  ON driver_payments(group_id);
