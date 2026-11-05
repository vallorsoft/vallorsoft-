-- ============================================================
--  VallorSoft — db/zzz-here-route-cache.sql
--  HERE kamion-útvonal (40 t) tartós tárolása: ha egy pont-sorozatra egyszer
--  kiszámoltuk, onnantól mindig ezt használjuk (nincs újabb HERE-hívás).
--  Kulcs: cég + a pontok (5 tizedes) + a kamion-paraméterek kivonata.
--  A szakaszok HERE flexpolyline-kódolással (tömör).
-- ============================================================
CREATE TABLE IF NOT EXISTS here_route_cache (
  company_id  INTEGER     NOT NULL,
  route_key   VARCHAR(64) NOT NULL,
  sections    JSONB       NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, route_key)
);
