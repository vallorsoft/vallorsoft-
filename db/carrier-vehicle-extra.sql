-- VallorSoft — alvállalkozói jármű extra mezők
-- Futtatás: automatikus (server.js migráció-futtató, schema_migrations könyvelés)
ALTER TABLE carrier_vehicles ADD COLUMN IF NOT EXISTS sofer_tel VARCHAR(30);
ALTER TABLE carrier_vehicles ADD COLUMN IF NOT EXISTS an_fabricatie SMALLINT;
-- Megjegyzés: nota már létezik a táblában (carriers-ap.sql), itt NEM adjuk hozzá újra
