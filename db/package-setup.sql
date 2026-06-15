-- db/package-setup.sql
-- VallorSoft 4 csomag teljes beállítása — nevek, limitek, feature-kapcsolók, marketing.
-- Idempotens: UPDATE + DELETE/INSERT. Automatikusan lefut induláskor.

-- ── 1. Csomagok limitei + nevei ───────────────────────────────────────────────

UPDATE subscription_plans SET
  name                 = 'Alap',
  description          = '1–2 járműves vállalkozásoknak',
  max_users            = 3,
  max_vehicles         = 2,
  max_sofors           = 2,
  max_orders_per_month = NULL,
  sort_order           = 1
WHERE sort_order = 1;

UPDATE subscription_plans SET
  name                 = 'Standard',
  description          = '3–5 járműves flottáknak',
  max_users            = 5,
  max_vehicles         = 5,
  max_sofors           = 5,
  max_orders_per_month = NULL,
  sort_order           = 2
WHERE sort_order = 2;

UPDATE subscription_plans SET
  name                 = 'Pro',
  description          = '6–20 járműves cégeknek',
  max_users            = 20,
  max_vehicles         = 20,
  max_sofors           = 20,
  max_orders_per_month = NULL,
  sort_order           = 3
WHERE sort_order = 3;

UPDATE subscription_plans SET
  name                 = 'Business',
  description          = '20+ járműves vállalatoknak',
  max_users            = 50,
  max_vehicles         = 50,
  max_sofors           = 50,
  max_orders_per_month = NULL,
  sort_order           = 4
WHERE sort_order = 4;

-- ── 2. Marketing bullet-pontok ────────────────────────────────────────────────

UPDATE subscription_plans SET features = '[
  "Fuvar kiírás & kezelés",
  "Fuvarlevelek & CMR",
  "Sofőrök & járművek kezelése",
  "Ügyfelek adatbázis",
  "Belső chat",
  "Alap statisztika"
]'::jsonb WHERE sort_order = 1;

UPDATE subscription_plans SET features = '[
  "Minden Alap +",
  "Tervezőtábla (Gantt)",
  "GPS integráció (live térkép)",
  "Számlázó integráció (e-Factura)",
  "Útdíj-becslés & útvonaltervezés",
  "Beérkező megrendelések",
  "Lejáratok & riasztások",
  "Pénzügyi & ügyfél riportok"
]'::jsonb WHERE sort_order = 2;

UPDATE subscription_plans SET features = '[
  "Minden Standard +",
  "Ügyfél-portál",
  "Alvállalkozói portál",
  "Visszfuvar-radar",
  "AI dokumentum-feldolgozás",
  "Raktár modul",
  "Könyvelő szerepkör"
]'::jsonb WHERE sort_order = 3;

UPDATE subscription_plans SET features = '[
  "Minden Pro +",
  "Fogyasztás & jármű kihasználtság elemzés",
  "Sofőr teljesítmény riport",
  "Üzemanyagkártya-import",
  "Havi e-mail összefoglaló",
  "Egyedi beállítások",
  "Dedikált support"
]'::jsonb WHERE sort_order = 4;

-- ── 3. Feature-kapcsolók újraépítése ─────────────────────────────────────────
-- Elv: "hiányzó sor = BE" — csak a TILTOTT funkciókhoz szúrunk be sort enabled=false-szal.

DELETE FROM plan_features;

-- 🟢 ALAP — minden prémium funkció ki van kapcsolva
INSERT INTO plan_features (plan_id, feature_key, enabled)
SELECT sp.id, feat, false
FROM subscription_plans sp,
  (VALUES
    ('orders-planner'),   -- Tervezőtábla
    ('decont'),           -- Sofőr-elszámolás
    ('gps-integracio'),   -- GPS integráció
    ('szamlazas-integracio'), -- Számlázó integráció
    ('tracking'),         -- Ügyfél tracking-link
    ('toll-becsles'),     -- Útdíj-becslés
    ('utvonaltervezes'),  -- Útvonaltervezés
    ('order-route-map'),  -- Térképes km + előnézet
    ('inbound'),          -- Beérkező megrendelések
    ('client-requests'),  -- Ügyfél kérések
    ('orders-import'),    -- CSV import
    ('expiries'),         -- Lejáratok & riasztások
    ('service-log'),      -- Szerviz & karbantartás
    ('stats-finance'),    -- Pénzügyi statisztikák
    ('stats-fuel'),       -- Fogyasztás elemzés
    ('stats-drivers'),    -- Sofőr teljesítmény
    ('stats-vehicles'),   -- Jármű kihasználtság
    ('stats-clients'),    -- Ügyfél riport
    ('stats-purchases'),  -- Vásárlások riport
    ('warehouse'),        -- Raktár modul
    ('client-portal'),    -- Ügyfél-portál
    ('carrier-portal'),   -- Alvállalkozói portál
    ('visszfuvar-radar'), -- Visszfuvar-radar
    ('ai-kiolvasas'),     -- AI feldolgozás
    ('konyvelo-szerepkor'), -- Könyvelő szerepkör
    ('fuel-import'),      -- Üzemanyagkártya-import
    ('monthly-report'),   -- Havi e-mail riport
    ('billing'),          -- Számlázás fül
    ('integrations')      -- Integrációk fül
  ) AS f(feat)
WHERE sp.sort_order = 1;

-- 🔵 STANDARD — portálok, radar, AI, raktár és fejlett riportok ki vannak kapcsolva
INSERT INTO plan_features (plan_id, feature_key, enabled)
SELECT sp.id, feat, false
FROM subscription_plans sp,
  (VALUES
    ('client-portal'),
    ('carrier-portal'),
    ('visszfuvar-radar'),
    ('ai-kiolvasas'),
    ('konyvelo-szerepkor'),
    ('warehouse'),
    ('stats-fuel'),
    ('stats-drivers'),
    ('stats-vehicles'),
    ('stats-clients'),
    ('stats-purchases'),
    ('fuel-import'),
    ('monthly-report')
  ) AS f(feat)
WHERE sp.sort_order = 2;

-- 🟡 PRO — csak a Business-exkluzív fejlett riportok vannak letiltva
INSERT INTO plan_features (plan_id, feature_key, enabled)
SELECT sp.id, feat, false
FROM subscription_plans sp,
  (VALUES
    ('stats-fuel'),
    ('stats-drivers'),
    ('stats-vehicles'),
    ('stats-clients'),
    ('stats-purchases'),
    ('fuel-import'),
    ('monthly-report')
  ) AS f(feat)
WHERE sp.sort_order = 3;

-- 🔴 BUSINESS — minden funkció elérhető (hiányzó sor = BE, nincs mit tiltani)
