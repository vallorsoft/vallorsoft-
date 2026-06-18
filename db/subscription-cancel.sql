-- ============================================================
--  VallorSoft — Előfizetés lemondás (dezabonare) türelmi idővel
--
--  A cég Adminja lemondhatja az előfizetést, de a HOZZÁFÉRÉS megmarad a
--  már kifizetett időszak végéig (companies.paid_until). A lemondás NEM
--  állítja azonnal 'cancelled'-re a státuszt (mert a login-kapu a
--  'cancelled'-t azonnal tiltaná) — helyette egy jelzőt teszünk:
--    subscription_cancel_at  = mikor kérte a lemondást (NULL = nincs lemondás)
--  A hozzáférés a meglévő paid_until-kapun keresztül ér véget magától.
--  Az utolsó napon egy emlékeztető e-mail megy ("még meggondolhatja magát").
--
--  Inkrementális, IDEMPOTENS migráció (auto-fut induláskor).
-- ============================================================

-- Lemondás kérésének időpontja (NULL = aktív, nincs lemondás folyamatban)
ALTER TABLE companies ADD COLUMN IF NOT EXISTS subscription_cancel_at TIMESTAMPTZ;

-- Az utolsó-napi "még meggondolhatja magát" e-mail kiment-e már
ALTER TABLE companies ADD COLUMN IF NOT EXISTS cancel_lastday_notified BOOLEAN DEFAULT false;
