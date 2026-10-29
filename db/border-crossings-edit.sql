-- Határátlépés utólagos módosítása (sofőr / admin / manager).
-- Az eredeti rögzítés (időpont + irány) az első módosításkor megőrződik,
-- hogy az audit-nyomvonal és a felület („eredetileg: …") lássa.
ALTER TABLE border_crossings ADD COLUMN IF NOT EXISTS orig_created_at TIMESTAMP;
ALTER TABLE border_crossings ADD COLUMN IF NOT EXISTS orig_tip VARCHAR(20);
ALTER TABLE border_crossings ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
ALTER TABLE border_crossings ADD COLUMN IF NOT EXISTS edited_by VARCHAR(255);
ALTER TABLE border_crossings ADD COLUMN IF NOT EXISTS edit_count INTEGER DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_border_email_time ON border_crossings (LOWER(email_sofer), created_at);
