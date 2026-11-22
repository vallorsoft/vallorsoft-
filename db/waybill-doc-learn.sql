-- Menetlevél dokumentum-ellenőrzés — tanulás (lib/waybillDocCheck).
-- Ügyfelenként / alvállalkozónként a referencia felirata (pl. „nr comanda"): a ✓-zott
-- iratból tanulva a következő irat referenciáját a fuvarral vetjük össze.
CREATE TABLE IF NOT EXISTS waybill_doc_patterns (
  id            SERIAL PRIMARY KEY,
  company_id    INTEGER NOT NULL,
  party_key     VARCHAR(100) NOT NULL,      -- client:<id> | client:<normált név> | carrier:<id>
  kind          VARCHAR(10) NOT NULL,       -- order | invoice
  ref_label     VARCHAR(60),
  sample_count  INTEGER NOT NULL DEFAULT 1,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, party_key, kind)
);
-- Jel-súlyok cégenként: a ✓ / ✗ döntésekben melyik jel mennyire volt megbízható.
CREATE TABLE IF NOT EXISTS waybill_doc_feedback (
  company_id  INTEGER NOT NULL,
  signal      VARCHAR(20) NOT NULL,
  ok_cnt      INTEGER NOT NULL DEFAULT 0,
  no_cnt      INTEGER NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, signal)
);
