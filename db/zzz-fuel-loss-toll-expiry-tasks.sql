-- Három automatizmus (2026-11):
--  1) Üzemanyag-hiány riasztás a GPS tartály-szintből (napi, járművenként)
--  2) Automatikus útdíj a fuvar mentett útvonalából (orders.toll_geo.auto)
--  3) Lejárat → feladat felelőssel (csak az új lejárati dátum zárja le)

-- 1) Riasztás-napló: járművenként + naponként egy sor; a `level` a már kiküldött
--    legmagasabb fokozat (1 = iroda, 2 = iroda + sofőr), így nem ismétlődik.
CREATE TABLE IF NOT EXISTS fuel_loss_alerts (
  id           BIGSERIAL PRIMARY KEY,
  company_id   INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  rendszam     VARCHAR(20) NOT NULL,
  day          DATE NOT NULL,
  total_l      NUMERIC(8,1) NOT NULL DEFAULT 0,
  stop_l       NUMERIC(8,1),
  sudden_l     NUMERIC(8,1),
  receipt_l    NUMERIC(8,1),
  detail       JSONB,
  level        SMALLINT NOT NULL DEFAULT 0,
  driver_email VARCHAR(255),
  checked_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  alerted_at   TIMESTAMPTZ,
  UNIQUE (company_id, rendszam, day)
);
CREATE INDEX IF NOT EXISTS idx_fuel_loss_alerts_cid ON fuel_loss_alerts (company_id, day DESC);

-- 3) Lejárat-feladat
ALTER TABLE document_expiries ADD COLUMN IF NOT EXISTS task_owner_id  INTEGER;
ALTER TABLE document_expiries ADD COLUMN IF NOT EXISTS task_opened_at TIMESTAMPTZ;
ALTER TABLE document_expiries ADD COLUMN IF NOT EXISTS task_closed_at TIMESTAMPTZ;
ALTER TABLE document_expiries ADD COLUMN IF NOT EXISTS task_closed_by VARCHAR(255);
CREATE INDEX IF NOT EXISTS idx_doc_expiries_task ON document_expiries (company_id, task_owner_id) WHERE task_opened_at IS NOT NULL;

-- A cég alapértelmezett lejárat-felelőse (ha üres: az első Admin)
ALTER TABLE companies ADD COLUMN IF NOT EXISTS expiry_task_owner_id INTEGER;
