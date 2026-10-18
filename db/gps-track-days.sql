-- db/gps-track-days.sql
-- GPS útvonal-előzmény (napi bontás) — a CargoTrack eszköz TELJES rögzített
-- pont-sora (nem a 10 perces mintavétel), járművenként és naponként egy sorban.
--   points_json   — tömör JSON-szöveg: [[epochSec, lat, lng, speed, ign, mileage, fuelUsed], ...]
--                   (TEXT, hogy a TOAST tömörítse; ~15-45 KB / jármű / nap)
--   segments      — az úthálózatra illesztett útvonal (polyline6 darabok, kind: m=illesztett,
--                   r=nyers pont-sor, g=adathiány-áthidalás az úton)
--   km_road       — az útra illesztett km (OSRM map-matching), km_raw — légvonalas pont-összeg
-- A napot az Europe/Bucharest naptár szerint számoljuk. Megőrzés: GPS_TRACK_RETENTION_DAYS (alap 100).
-- Auto-fut a szerver indulásakor.

CREATE TABLE IF NOT EXISTS gps_track_days (
  id             BIGSERIAL PRIMARY KEY,
  company_id     INTEGER NOT NULL,
  rendszam       VARCHAR(20) NOT NULL,
  object_id      VARCHAR(64),
  day            DATE NOT NULL,
  points_json    TEXT NOT NULL DEFAULT '[]',
  point_count    INTEGER NOT NULL DEFAULT 0,
  fetched_until  TIMESTAMPTZ,
  complete       BOOLEAN NOT NULL DEFAULT false,
  segments       JSONB,
  km_road        NUMERIC(9,2),
  km_raw         NUMERIC(9,2),
  match_source   VARCHAR(12),
  matched_count  INTEGER,
  matched_at     TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, rendszam, day)
);

CREATE INDEX IF NOT EXISTS idx_gps_track_days_lookup ON gps_track_days (company_id, rendszam, day DESC);
CREATE INDEX IF NOT EXISTS idx_gps_track_days_match ON gps_track_days (complete, matched_at) WHERE matched_at IS NULL;
