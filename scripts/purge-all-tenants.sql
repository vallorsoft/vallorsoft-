-- ============================================================
--  VallorSoft — Összes bérlői adat és felhasználó törlése
--  (a developer felhasználó és a rendszer-táblák megmaradnak)
--
--  FUTTATÁS (psql parancssorból):
--    psql "$DATABASE_URL" -f scripts/purge-all-tenants.sql
--
--  NEM fut automatikusan (nincs a db/ mappában).
--  VISSZAFORDÍTHATATLAN — nincs undo.
--
--  Megmarad:
--    users WHERE pozicio_dev = TRUE (developer)
--    subscription_plans, developer_settings, schema_migrations,
--    here_feature_flags, maps_pricing, geo_country_cache
-- ============================================================

BEGIN;

-- ── 1. Összes session törlése (mindenki ki lesz jelentkeztetve) ──────────────
DELETE FROM session;

-- ── 2. Manuálisan törlendők (nincs CASCADE FK a companies táblából) ──────────

-- Menetlevelek, határátlépések, sofőr-dokumentumok (email_sofer alapú szűrés)
DELETE FROM fuvarlevelek;
DELETE FROM border_crossings;
DELETE FROM documents;

-- Chat / Firebase
DELETE FROM messages;
DELETE FROM stamps;

-- Visszfuvar radar
DELETE FROM available_orders;

-- Alvállalkozó modul (no FK cascade)
DELETE FROM carrier_documents;
DELETE FROM carrier_vehicles;
DELETE FROM carrier_users;
DELETE FROM carrier_invoices;
DELETE FROM carriers;

-- Raktár (no FK cascade)
DELETE FROM warehouse_items;

-- Útdíj ráták (no FK cascade)
DELETE FROM toll_rates;

-- Napló táblák (no FK cascade)
DELETE FROM audit_log;
DELETE FROM gdpr_consents;
DELETE FROM here_usage_log;
DELETE FROM maps_usage;

-- Jogi visszaigazolások (user_id alapú, nincs company FK)
DELETE FROM legal_consents;

-- Hibajelentések (company_id SET NULL lenne, inkább töröljük)
DELETE FROM bug_reports;

-- ── 3. Összes cég törlése ────────────────────────────────────────────────────
--  CASCADE-del törli: orders, order_legs, order_documents, order_uit_codes,
--  vehicles, clients, client_users, carriers (ha FK van), invites,
--  external_drivers, push_subscriptions, driver_shifts, document_series,
--  company_integrations, vehicle_gps_map, invoices, inbound_orders,
--  company_branding, email_templates, client_emails, document_expiries,
--  driver_advances, vehicle_service_log, fuel_card_transactions,
--  monthly_report_log, gps_mileage_log, company_features,
--  billing_integrations, gdpr_settings, company_branding, stb.
--  A users.company_id → SET NULL lesz (nem törlődnek a userek automatikusan).
DELETE FROM companies;

-- ── 4. Nem-developer felhasználók törlése ────────────────────────────────────
DELETE FROM users WHERE pozicio_dev IS DISTINCT FROM TRUE;

-- ── 5. Invitations (ha maradt árva) ─────────────────────────────────────────
DELETE FROM invites WHERE company_id IS NULL;

-- ── Ellenőrzés ───────────────────────────────────────────────────────────────
SELECT 'users_remaining'        AS what, COUNT(*) AS n FROM users;
SELECT 'companies_remaining'    AS what, COUNT(*) AS n FROM companies;
SELECT 'orders_remaining'       AS what, COUNT(*) AS n FROM orders;
SELECT 'fuvarlevelek_remaining' AS what, COUNT(*) AS n FROM fuvarlevelek;
SELECT 'developer_user'         AS what, email FROM users WHERE pozicio_dev = TRUE;

COMMIT;
