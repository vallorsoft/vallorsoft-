-- Iratok típusának utólagos felismerése (lib/waybillDocCheck.js reclassifyRound):
-- az „Egyéb" / általános típusú iratot, ha a szövege egyértelműen számla vagy
-- megrendelő, a felismert típusra állítja. Irataként egyszer fut (ez a jelző).
ALTER TABLE order_documents ADD COLUMN IF NOT EXISTS kind_checked_at TIMESTAMPTZ;
