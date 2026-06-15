-- VallorSoft — Banki fizetési adatok + fizetési kérelmek
-- Idempotens migráció.

-- Fizetési kérelmek (csomag-választás után generált referenciák)
CREATE TABLE IF NOT EXISTS payment_requests (
  id            SERIAL PRIMARY KEY,
  company_id    INTEGER NOT NULL,
  plan_id       INTEGER NOT NULL,
  billing_type  VARCHAR(10) NOT NULL DEFAULT 'monthly',  -- monthly | annual
  reference     VARCHAR(40) NOT NULL UNIQUE,             -- VS-202606-0042
  amount_eur    NUMERIC(10,2),                           -- nettó EUR
  amount_ron    NUMERIC(10,2),                           -- nettó RON
  tva_ron       NUMERIC(10,2),                           -- 21% TVA RON
  total_ron     NUMERIC(10,2),                           -- bruttó RON
  bnr_rate      NUMERIC(8,4),                           -- EUR/RON BNR árfolyam
  status        VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending | paid | cancelled
  email_sent_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_req_company ON payment_requests (company_id, created_at DESC);
