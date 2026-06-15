-- db/package-setup-v2.sql
-- Csomag finomítás: sofőr-limitek növelése + chat → Standard.
-- Fut: package-setup.sql UTÁN (alphabetikusan biztosított).
-- Idempotens (ON CONFLICT DO UPDATE / DO NOTHING).

-- ── 1. Sofőr-limit helyes arányok (jármű ~2× sofőr) ─────────────────────────

UPDATE subscription_plans SET max_sofors =  4 WHERE sort_order = 1;
UPDATE subscription_plans SET max_sofors = 10 WHERE sort_order = 2;
UPDATE subscription_plans SET max_sofors = 40 WHERE sort_order = 3;
UPDATE subscription_plans SET max_sofors = 100 WHERE sort_order = 4;

-- ── 2. Chat az Alap csomagból kivéve → Standard-tól elérhető ─────────────────

INSERT INTO plan_features (plan_id, feature_key, enabled)
SELECT sp.id, 'chat', false
FROM subscription_plans sp
WHERE sp.sort_order = 1
ON CONFLICT (plan_id, feature_key) DO UPDATE SET enabled = false;

-- Standard/Pro/Business-nél a 'chat' sor NEM szerepel (hiányzó = BE).
DELETE FROM plan_features
WHERE feature_key = 'chat'
  AND plan_id IN (SELECT id FROM subscription_plans WHERE sort_order IN (2,3,4));

-- ── 3. Marketing bullet-pontok frissítése ─────────────────────────────────────

-- Alap: chat eltávolítva
UPDATE subscription_plans SET features = '[
  "Fuvar kiírás & kezelés",
  "Fuvarlevelek & CMR",
  "Sofőrök & járművek kezelése",
  "Ügyfelek adatbázis",
  "Alap statisztika"
]'::jsonb WHERE sort_order = 1;

-- Standard: chat hozzáadva
UPDATE subscription_plans SET features = '[
  "Minden Alap +",
  "Belső chat",
  "Tervezőtábla (Gantt)",
  "GPS integráció (live térkép)",
  "Számlázó integráció (e-Factura)",
  "Útdíj-becslés & útvonaltervezés",
  "Beérkező megrendelések",
  "Lejáratok & riasztások",
  "Pénzügyi riportok"
]'::jsonb WHERE sort_order = 2;
