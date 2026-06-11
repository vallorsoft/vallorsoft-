-- ============================================================
--  VallorSoft — geokód-cache a Visszfuvar-radarhoz (idempotens)
--  Helységnév -> koordináta gyorsítótár (Photon/OSM geokódolás
--  eredménye). Csak publikus helynév->koordináta párokat tárol,
--  ezért nem cégfüggő — minden tenant ugyanazt a cache-t tölti.
-- ============================================================

CREATE TABLE IF NOT EXISTS geo_cache (
  id         SERIAL PRIMARY KEY,
  label      TEXT NOT NULL UNIQUE,   -- normalizált helységnév (kisbetűs, trim)
  lat        DOUBLE PRECISION,
  lng        DOUBLE PRECISION,       -- NULL lat/lng = sikertelen geokódolás (ne próbáljuk folyton)
  created_at TIMESTAMPTZ DEFAULT NOW()
);
