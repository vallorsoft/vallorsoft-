-- db/carriers-vehicle-gps.sql
-- Alvállalkozói jármű GPS-követés: (1) megosztott publikus követő-link (URL),
-- (2) opcionális CargoTrack API-kulcs + object_id (élő pozíció a térképen).
-- A fájlnév szándékosan a `carriers-ap.sql` UTÁN rendeződik (a tábla onnan jön).
-- Az API-kulcs AES-256-GCM-mel titkosítva tárolódik (gps_api_key_enc), a kliensbe
-- SOHA nem kerül vissza (csak „van-e kulcs" jelző).
ALTER TABLE carrier_vehicles ADD COLUMN IF NOT EXISTS track_url       TEXT;
ALTER TABLE carrier_vehicles ADD COLUMN IF NOT EXISTS gps_object_id   VARCHAR(100);
ALTER TABLE carrier_vehicles ADD COLUMN IF NOT EXISTS gps_api_key_enc TEXT;
