-- ============================================================
--  VallorSoft — Sofőr-járandóság és kifizetés (idempotens migráció)
--  1) driver_earnings — amivel a cég TARTOZIK a sofőrnek
--     (bónusz, diurna kézzel, per_diem, prémium, egyéb tétel)
--     quantity × unit_amount = total_amount, EUR VAGY RON
--  2) driver_payments — amit a cég ténylegesen KIFIZETETT a sofőrnek
--     EUR VAGY RON, a kifizetés pillanatában érvényes BNR-árfolyam
--     mentve → később a valuta-átváltás visszamenőleg is látszik
--  3) driver_advances.currency alapérték már 'RON' — nem bántjuk;
--     de biztosítjuk hogy a currency mező EUR-t is fogadjon régi
--     rekordoknál az egyenleg-számításnál.
--  Multi-tenant: minden SQL company_id-szűrt, paraméteres.
-- ============================================================

CREATE TABLE IF NOT EXISTS driver_earnings (
  id            SERIAL PRIMARY KEY,
  company_id    INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  email_sofer   VARCHAR(255) NOT NULL,
  earning_date  DATE DEFAULT CURRENT_DATE,
  kind          VARCHAR(30) NOT NULL DEFAULT 'other',
    -- fehérlistázva a handlerben: bonus | diurna | per_diem | salary | premium | holiday | other
  label         VARCHAR(120),           -- egyedi címke (pl. "Karácsonyi jutalom")
  quantity      NUMERIC(10,2) DEFAULT 1,   -- pl. 6 nap, 3 alkalom
  unit_amount   NUMERIC(12,2) NOT NULL,    -- pl. 70 EUR/nap
  total_amount  NUMERIC(14,2) NOT NULL,    -- quantity × unit_amount (szerver számol)
  currency      VARCHAR(5) NOT NULL DEFAULT 'RON', -- EUR | RON
  note          TEXT,
  created_by    VARCHAR(255),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_driver_earnings
  ON driver_earnings(company_id, email_sofer, earning_date);

CREATE TABLE IF NOT EXISTS driver_payments (
  id            SERIAL PRIMARY KEY,
  company_id    INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  email_sofer   VARCHAR(255) NOT NULL,
  paid_at       DATE DEFAULT CURRENT_DATE,
  amount        NUMERIC(14,2) NOT NULL,
  currency      VARCHAR(5) NOT NULL DEFAULT 'RON',  -- EUR | RON
  bnr_rate      NUMERIC(10,4),      -- EUR/RON a kifizetés pillanatában (BNR)
  amount_ron    NUMERIC(14,2),      -- RON-ban a kifizetéskori BNR szerint (könnyű összesítéshez)
  method        VARCHAR(30) DEFAULT 'cash', -- cash | bank | card | other
  note          TEXT,
  created_by    VARCHAR(255),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_driver_payments
  ON driver_payments(company_id, email_sofer, paid_at);

-- Régi driver_advances: engedjük az EUR-t is (a rekordok többsége RON);
-- a currency oszlop már létezik (phase3-modules.sql), méret elég (VARCHAR(5)).
-- Nincs séma-változás rajta.
