-- Csomag marketing bullet-pointok (features JSONB oszlop)
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS features JSONB DEFAULT '[]';
