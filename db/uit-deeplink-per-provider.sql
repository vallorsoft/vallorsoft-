-- UIT deep-link sablon GPS-providerenként (cargotrack/fomco), JSONB map.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS uit_deeplink_templates JSONB DEFAULT '{}'::jsonb;
-- Visszamenőleges feltöltés: a régi egy-sablonos oszlop a cargotrack alá kerül (az volt a default provider).
UPDATE companies
   SET uit_deeplink_templates = jsonb_build_object('cargotrack', uit_deeplink_template)
 WHERE uit_deeplink_template IS NOT NULL
   AND (uit_deeplink_templates = '{}'::jsonb OR uit_deeplink_templates IS NULL);
