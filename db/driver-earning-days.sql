-- Diurna-napok naptárból: a kijelölt napok (YYYY-MM-DD tömb) a járandóság-tételen.
-- A mennyiség = a napok száma (szerver-oldalon számolva). NULL = nem napos tétel.
ALTER TABLE driver_earnings ADD COLUMN IF NOT EXISTS days JSONB;
