-- 📤 Elküldött levél: a chatből küldött levél SZERKESZTHETŐ vázlata (jelölt
-- szöveg + fuvarkártyák + kinézet), hogy „küldjük újra / alakítsd át" kérésre
-- pontosan visszatölthető legyen. Csak a saját kimenő levelünk — beérkezett
-- levél tartalma továbbra sem kerül adatbázisba.
ALTER TABLE mail_sent ADD COLUMN IF NOT EXISTS draft_json JSONB;
