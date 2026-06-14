-- UIT deep-link sablon GPS-providerenként (cargotrack/fomco), JSONB map.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS uit_deeplink_templates JSONB DEFAULT '{}'::jsonb;
-- Visszamenőleges feltöltés: a régi egy-sablonos oszlop (ha létezik) a cargotrack alá kerül.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name='companies' AND column_name='uit_deeplink_template'
  ) THEN
    UPDATE companies
       SET uit_deeplink_templates = jsonb_build_object('cargotrack', uit_deeplink_template)
     WHERE uit_deeplink_template IS NOT NULL
       AND (uit_deeplink_templates = '{}'::jsonb OR uit_deeplink_templates IS NULL);
  END IF;
END $$;
