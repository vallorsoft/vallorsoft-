-- ============================================================
--  VallorSoft — A fel-/lerakási címből a hely / cég neve kivéve
--  Inkrementális migráció (idempotens, egyszer fut). A címkiegészítő a „Hely neve,
--  Utca, Település, …" formát írta a fuvarba (pl. „Policlinica AS, Strada Făt Frumos,
--  Arad, 310364, RO") — a hely/cég neve nem a cím része (a cég-mezőbe tartozik).
--  A meglévő állomások címéből levágjuk (csak ha a 2. darab utca és utána még
--  település áll); a mirror-trigger a fuvar loc_incarcare/loc_descarcare mezőit is
--  frissíti. Ugyanez a szabály él mentéskor: lib/placeName.js stripPlaceName.
-- ============================================================
UPDATE order_stops
   SET loc = regexp_replace(loc, '^[^,]+,[[:space:]]*', ''), updated_at = NOW()
 WHERE loc ~* '^[[:space:]]*[^,[:space:]][^,]*,[[:space:]]*(strada|str\.?|calea|bulevardul|bd\.?|bdul\.?|b-dul|aleea|șoseaua|soseaua|sos\.?|drumul|piața|piata|splaiul|intrarea)[[:space:]][^,]*,[[:space:]]*[^,0-9[:space:]][^,]{2,}'
   AND loc !~* '^[[:space:]]*(strada|str\.?|calea|bulevardul|bd\.?|bdul\.?|b-dul|aleea|șoseaua|soseaua|sos\.?|drumul|piața|piata|splaiul|intrarea|nr\.?)[[:space:]]'
   AND split_part(loc, ',', 3) !~* '^[[:space:]]*(ro|hu|romania|hungary|magyarorszag|ungaria)[[:space:]]*$';
