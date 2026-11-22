-- A cégenkénti éjszakai biztonsági mentés a Google Drive helyett a saját Cloudflare R2
-- tárhelyünkre kerül (services/companyBackup.js). A mentés-fájl eddig is cégenkénti
-- kulccsal titkosított (lib/backupFile).
-- Megőrzés: 30 napig minden napi mentés, utána havonta egy, a cég által választott ideig.
ALTER TABLE company_backup_runs ADD COLUMN IF NOT EXISTS r2_key    TEXT;
ALTER TABLE company_backup_runs ADD COLUMN IF NOT EXISTS r2_status VARCHAR(12);
UPDATE company_backup_settings SET drive_retention = '365' WHERE drive_retention NOT IN ('30', '90', '180', '365');
ALTER TABLE company_backup_settings ALTER COLUMN drive_retention SET DEFAULT '365';
