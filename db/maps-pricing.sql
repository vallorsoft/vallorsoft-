-- ============================================================
--  VallorSoft — térkép-szolgáltatás árazás (idempotens)
--  A cégeknek NINCS ingyenes keret — az első hívástól fizetnek a
--  hivatalos ár + árrés% szerint. A hivatalos egységárat (EUR/hívás) és
--  az árrést a developer állítja, szolgáltatónként.
-- ============================================================

CREATE TABLE IF NOT EXISTS maps_pricing (
  vendor       VARCHAR(10) PRIMARY KEY,            -- 'here' | 'google'
  eur_per_unit NUMERIC(12,6) NOT NULL DEFAULT 0,   -- hivatalos ár / 1 hívás (EUR)
  margin_pct   NUMERIC(6,2)  NOT NULL DEFAULT 25,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tájékoztató alapértékek (a developer felülírja a tényleges hivatalos árral):
--   HERE ~0,83 €/1000, Google geokódolás ~5 €/1000
INSERT INTO maps_pricing (vendor, eur_per_unit, margin_pct) VALUES
  ('here', 0.000830, 25),
  ('google', 0.005000, 25)
ON CONFLICT (vendor) DO NOTHING;
