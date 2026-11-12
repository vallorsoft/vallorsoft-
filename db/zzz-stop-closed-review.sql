-- ============================================================
--  VallorSoft — Lezárt fuvar háttér-ellenőrzése (idempotens)
--  A lezárt (Finalizat) fuvarra a sofőrnek már nincs felajánlás; a háttérben egyszer újra
--  ellenőrizzük a rendszer által beírt állomás-időket (csak az órát javítjuk, a napot nem).
-- ============================================================
ALTER TABLE stop_match_state ADD COLUMN IF NOT EXISTS closed_review_at TIMESTAMPTZ;
