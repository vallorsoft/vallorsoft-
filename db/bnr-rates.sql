-- BNR napi árfolyamok MINDEN valutára (nem cégfüggő, nyilvános adat).
-- Az ütemező naponta elmenti a BNR hivatalos XML-jét; a bon-kiolvasó és a
-- menetlevél a tétel DÁTUMÁRA érvényes (aznapi vagy az utolsó előtte
-- közzétett) árfolyamot veszi innen. rate = RON / 1 egység (a BNR
-- `multiplier`-rel már elosztva, pl. HUF: 1 HUF = 0.0124 RON).
CREATE TABLE IF NOT EXISTS bnr_rates (
  rate_date  DATE        NOT NULL,
  currency   VARCHAR(3)  NOT NULL,
  rate       NUMERIC(14,8) NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (rate_date, currency)
);
CREATE INDEX IF NOT EXISTS idx_bnr_rates_cur_date ON bnr_rates (currency, rate_date DESC);
