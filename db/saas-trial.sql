-- Inkrementális migráció: SaaS trial e-mail küldés jelző
-- Idempotens: IF NOT EXISTS

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS trial_email_sent BOOLEAN DEFAULT false;
