-- Menetlevél-idő GPS-ellenőrzés: a RÉGI (már meglévő) menetlevelek csak EGYSZER,
-- most kapják meg az ellenőrzést; a kétszeri szabály (beküldéskor + 24 óra múlva)
-- csak az új menetlevelekre él.
--  1. Már ellenőrzött régi menetlevél (nem a beküldéskor, hanem a háttér-
--     feldolgozás nézte, órákkal/napokkal a kitöltés után) → kész, nincs 2. kör.
UPDATE fuvarlevelek SET time_check_count = 2
 WHERE time_check_count = 1
   AND time_check_at > (data_completare AT TIME ZONE 'UTC') + INTERVAL '1 hour';
--  2. Még nem ellenőrzött régi menetlevél → egyetlen ellenőrzés, most (a számláló
--     1-ről indul, a dátum a múltban → azonnal sorra kerül, utána kész).
UPDATE fuvarlevelek SET time_check_count = 1, time_check_at = TIMESTAMPTZ '2000-01-01 00:00:00+00'
 WHERE time_check_count = 0;
