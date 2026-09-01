-- ============================================================
--  VallorSoft — Sofőr AI-scan pending bonok (idempotens migráció)
--  A sofőr fotózza a bont → AI kiolvassa a mezőket → LOKÁLIS
--  várólistán marad a telefonon, amíg vagy elfogadja (rrAccept,
--  a menetlevél piszkozatához illeszti) vagy eldobja (rrDiscard).
--  Eddig ez a várólista TISZTÁN kliens-oldalon (localStorage-ban)
--  élt → az admin/manager nem látta, hogy a sofőrnek van-e „lebegő"
--  bonja, ami még nincs menetlevélben.
--
--  Ez a tábla szerver-oldalon is nyilvántartja a scanneket:
--   - status='pending'   : lefotózva + AI-val kiolvasva, még nincs
--                          menetlevélben (☁️ „csak felhőben")
--   - status='attached'  : bekerült egy menetlevélbe (waybill_id),
--                          és az admin ott is nyomon követheti
--   - status='deleted'   : a sofőr eldobta (soft-delete)
--
--  Multi-tenant: minden SQL company_id-szűrt, paraméteres.
--  Adat-minimalizálás: a base64 kép SOSEM kerül DB-be — csak egy
--  128px thumbnail az áttekintéshez (opcionális, NULL-ozható).
-- ============================================================

CREATE TABLE IF NOT EXISTS driver_receipt_scans (
  id           SERIAL PRIMARY KEY,
  company_id   INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  email_sofer  VARCHAR(255) NOT NULL,
  kind         VARCHAR(20) NOT NULL DEFAULT 'other',
    -- fuel | purchase | other
  fields       JSONB DEFAULT '{}'::jsonb,
    -- Az AI által kiolvasott stabil mezők (loc/tip/plata/valuta/produs/data/litru/km/suma stb.)
  thumb_b64    TEXT,
    -- 128×128px JPEG data-URL VAGY nyers base64 — opcionális; a teljes kép nem tárolt
  status       VARCHAR(20) NOT NULL DEFAULT 'pending',
    -- pending | attached | deleted
  waybill_id   VARCHAR(20),
    -- ha attached: a MT-YYYY-XXXX menetlevél sorszáma / azonosítója
  scanned_at   TIMESTAMPTZ DEFAULT NOW(),
  attached_at  TIMESTAMPTZ,
  deleted_at   TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  created_by   VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS idx_driver_receipt_scans_lookup
  ON driver_receipt_scans(company_id, email_sofer, status, scanned_at);

CREATE INDEX IF NOT EXISTS idx_driver_receipt_scans_waybill
  ON driver_receipt_scans(waybill_id)
  WHERE waybill_id IS NOT NULL;
