-- Postafiók-diagnosztika: az utolsó lekérdezéskor hány levelet látott a
-- program a mappában, és ebből hányat szűrt ki a „Kiktől" beállítás.
-- Ebből mondja meg a Levelek fül, MIÉRT üres a lista (csak számok, levél-adat nem).
ALTER TABLE mail_accounts ADD COLUMN IF NOT EXISTS last_seen    INTEGER;
ALTER TABLE mail_accounts ADD COLUMN IF NOT EXISTS last_skipped INTEGER;
