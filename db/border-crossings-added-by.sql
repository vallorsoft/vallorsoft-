-- Határátlépés utólagos felvétele az irodából (Admin/Manager, konzol vagy AI-chat).
-- added_by = ki vette fel kézzel (NULL = a sofőr rögzítette GPS-szel a főoldali gombbal).
ALTER TABLE border_crossings ADD COLUMN IF NOT EXISTS added_by VARCHAR(255);
