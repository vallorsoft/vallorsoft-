-- A menetlevél indulás / érkezés km-e a sofőr által beírt érték (km_inceput / km_sfarsit):
-- a korábban GPS-ből tárolt pillanatképeket újraszámoltatjuk.
UPDATE fuvarlevelek SET route_odo_at = NULL WHERE route_odo_at IS NOT NULL;
