-- ============================================================
--  VallorSoft — térkép-szolgáltató használat-számláló (idempotens)
--  A fizetős (HERE/Google) geokódolás/autocomplete hívásokat cégenként,
--  szolgáltatónként, hónapra számolja (0-ról indulva). Az ingyenes
--  hívások NEM számítanak (nincs költségük).
-- ============================================================

CREATE TABLE IF NOT EXISTS maps_usage (
  company_id INTEGER NOT NULL,
  vendor     VARCHAR(10) NOT NULL,            -- 'here' | 'google'
  ym         VARCHAR(7)  NOT NULL,            -- 'YYYY-MM'
  cnt        INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, vendor, ym)
);
