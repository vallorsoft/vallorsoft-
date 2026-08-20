-- db/order-uit-photo.sql
-- UIT-kód mellé fotó tárolása (a papíron kapott UIT lefotózott képe, hogy a
-- sofőr/diszpécser később is megnyithassa/letölthesse). Ha az AI egyszerre
-- több kódot ismer fel egy fotóról, minden kód megkapja a fotó másolatát
-- (kis duplikáció, cserébe az egyed-életciklus tiszta).
--
-- Oszlopok:
--   photo_b64  — a JPEG/PNG kép base64 kódolva (mint az order_documents-nél)
--   photo_mime — MIME-típus (image/jpeg | image/png)
--   source     — 'manual' (kézzel) | 'ai-scan' (AI olvasta ki fotóból)
-- Futtatás: az induláskor auto-fut (server.js migráció-futtató).

ALTER TABLE order_uit_codes ADD COLUMN IF NOT EXISTS photo_b64  TEXT;
ALTER TABLE order_uit_codes ADD COLUMN IF NOT EXISTS photo_mime TEXT;
ALTER TABLE order_uit_codes ADD COLUMN IF NOT EXISTS source     TEXT DEFAULT 'manual';
