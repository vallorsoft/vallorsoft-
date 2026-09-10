-- db/gps-daily-track.sql
-- Napi GPS útvonal (breadcrumb) — cégenként/rendszámonként/napra összegyűjtött
-- pozíciók, hogy a diszpécser visszamenőleg is látja a jármű útját. A CargoTrack
-- API-ból 10 percenként húzza a `getLatestStatus`-t, és INSERT-eli, ha a jármű
-- ≥200 m-t mozdult az utolsó rögzített pozíciótól (mozgás-szűrő — nem szennyezi
-- a nyilvántartást álló járművek ismétlődő pozíciójával). Adattakarítás: 7 nap.
--
-- A `gps_month_end_snapshots` (hó-végi km/üzemanyag) NEM érintett — az külön él.
-- A `getPositions` 30 mp-es térkép-cache szintén nem érintett (élő nézet).
--
-- Auto-fut a szerver indulásakor.

CREATE TABLE IF NOT EXISTS gps_daily_positions (
  id           BIGSERIAL PRIMARY KEY,
  company_id   INTEGER NOT NULL,
  rendszam     VARCHAR(20) NOT NULL,
  lat          NUMERIC(10, 6) NOT NULL,
  lng          NUMERIC(10, 6) NOT NULL,
  speed_kmh    NUMERIC(5, 1),
  ignition     BOOLEAN,
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gps_daily_lookup
  ON gps_daily_positions (company_id, rendszam, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_gps_daily_cleanup
  ON gps_daily_positions (recorded_at);
