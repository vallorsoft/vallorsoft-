-- gps_track_days.points_at: mikor jött utoljára ÚJ GPS-pont az adott napra.
-- Az updated_at minden letöltéskor lép (új pont nélkül is), ezért a cím-felismerő
-- ütemezője ezt nézi: új pont nélkül nem futtatja újra a fuvart (ugyanazt adná).
ALTER TABLE gps_track_days ADD COLUMN IF NOT EXISTS points_at TIMESTAMPTZ;
UPDATE gps_track_days SET points_at = updated_at WHERE points_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_gps_track_days_points ON gps_track_days (company_id, points_at DESC);
