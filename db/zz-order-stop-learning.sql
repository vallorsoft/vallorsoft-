-- ============================================================
--  VallorSoft — Tényleges cím-felismerés: tanulás az iroda döntéseiből
--  Inkrementális migráció (idempotens) — automatikusan lefut induláskor.
--
--  stop_match_feedback   — jelenként hányszor szerepelt elfogadott / elvetett
--                          javaslatban → a pontozás cégenként súlyozza a jeleket
--                          (lib/stopMatch.js weightsFromFeedback).
--  stop_match_bad_places — elvetett helyek: ugyanannál a cégnél nem javasoljuk
--                          újra, máshol ismétlődés (hits ≥ 2) esetén mínusz.
--  Személyes adatot nem tárol (cég-telephely koordináta + cégnév-kulcs).
-- ============================================================

CREATE TABLE IF NOT EXISTS stop_match_feedback (
  company_id  INTEGER NOT NULL,
  signal      VARCHAR(32) NOT NULL,
  accepted    INTEGER NOT NULL DEFAULT 0,
  rejected    INTEGER NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, signal)
);

CREATE TABLE IF NOT EXISTS stop_match_bad_places (
  id          BIGSERIAL PRIMARY KEY,
  company_id  INTEGER NOT NULL,
  lat         DOUBLE PRECISION NOT NULL,
  lng         DOUBLE PRECISION NOT NULL,
  firma_norm  VARCHAR(200),
  hits        INTEGER NOT NULL DEFAULT 1,
  last_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stop_match_bad_places_company ON stop_match_bad_places (company_id);
