-- ============================================================
--  VallorSoft — Statisztika v2 alap-táblák
--  Inkrementális migráció (idempotens) — automatikusan lefut induláskor.
--
--  Három tábla a Statisztika 2.0 alá:
--    - stats_views: mentett nézetek (szűrő+layout) felhasználónként vagy megosztva
--    - stats_goals: KPI cél-értékek (időszakos, cég-szintű)
--    - stats_report_schedules: időzített PDF-riportok (PR #10 használja)
--
--  Multi-tenant: minden sor egy céghez tartozik (company_id).
-- ============================================================

-- ── Mentett nézetek ─────────────────────────────────────────
-- config JSONB: { tab, range, filters, compare, layout }
-- is_shared=true → a cég minden Admin/Manager felhasználója láthatja
CREATE TABLE IF NOT EXISTS stats_views (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       VARCHAR(120) NOT NULL,
  config     JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_shared  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stats_views_company ON stats_views (company_id);
CREATE INDEX IF NOT EXISTS idx_stats_views_user    ON stats_views (user_id);

-- ── KPI cél-értékek ─────────────────────────────────────────
-- metric_key: pl. 'revenue', 'profit', 'closed_orders', 'consum_l100'
-- period: 'month' | 'quarter' | 'year' (a UI dönti melyikhez tartozik a cél)
-- target_value: NUMERIC (EUR/darab/L/100km — a metric_key értelmezi)
-- currency: 'EUR' | 'RON' vagy NULL, ha nem pénzügyi
CREATE TABLE IF NOT EXISTS stats_goals (
  id SERIAL PRIMARY KEY,
  company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  metric_key  VARCHAR(60) NOT NULL,
  period      VARCHAR(20) NOT NULL DEFAULT 'month',
  target_value NUMERIC(14,2) NOT NULL,
  currency    VARCHAR(8),
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, metric_key, period)
);

CREATE INDEX IF NOT EXISTS idx_stats_goals_company ON stats_goals (company_id);

-- ── Időzített riportok (PR #10 tölti fel) ───────────────────
-- view_id: a stats_views-ra mutat (NULL, ha a dashboard-ot rendereli)
-- schedule: 'daily' | 'weekly' | 'monthly'
-- recipients JSONB tömb: string e-mail címek
-- last_run_at: utolsó sikeres futás (SCHEDULER tölti)
CREATE TABLE IF NOT EXISTS stats_report_schedules (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  view_id    INTEGER REFERENCES stats_views(id) ON DELETE CASCADE,
  name       VARCHAR(120) NOT NULL,
  schedule   VARCHAR(20) NOT NULL DEFAULT 'monthly',
  recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
  enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stats_report_company ON stats_report_schedules (company_id);
CREATE INDEX IF NOT EXISTS idx_stats_report_enabled ON stats_report_schedules (enabled, last_run_at);
