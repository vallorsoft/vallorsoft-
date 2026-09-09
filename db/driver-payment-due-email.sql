-- ============================================================
--  VallorSoft — Kifizetés esedékesség e-mail jelző (idempotens)
--
--  driver_payments.paid_at (DATE) mostantól kettős szerep:
--    - múltbeli / mai dátum = TÉNYLEGES fizetés (számít a balance-ba)
--    - jövőbeli dátum       = SCHEDULED fizetés (nem számít a balance-ba,
--                              esedékesség napján e-mail megy az adminnak)
--
--  Új oszlop: due_email_sent BOOLEAN — a scheduler egyszer küld
--    értesítést a kifizetés esedékessége napján (dedupolva).
--
--  Multi-tenant: nem érint. Best-effort a hívó handler-ekben
--    (to_jsonb → hiányzó oszlop = NULL).
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'driver_payments' AND column_name = 'due_email_sent'
  ) THEN
    ALTER TABLE driver_payments
      ADD COLUMN due_email_sent BOOLEAN DEFAULT FALSE;
  END IF;
END$$;

-- Régi sorok: minden múltbeli/mai paid_at = már "esedékesség lejárt",
-- ne küldjön e-mailt visszamenőleg → true-ra állítjuk.
UPDATE driver_payments
   SET due_email_sent = TRUE
 WHERE due_email_sent IS NULL
    OR (paid_at IS NOT NULL AND paid_at::date <= CURRENT_DATE);

CREATE INDEX IF NOT EXISTS idx_driver_payments_due
  ON driver_payments(paid_at)
 WHERE due_email_sent = FALSE;
