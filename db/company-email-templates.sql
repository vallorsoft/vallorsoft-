-- ============================================================
--  VallorSoft — Cégszintű tranzakciós e-mail sablonok
--  Inkrementális, IDEMPOTENS migráció (többször futtatható).
--
--  MIÉRT ÚJ TÁBLA (és NEM a meglévő email_templates / developer_settings):
--    - A `developer_settings` `email_sys_*` kulcsai a DEVELOPER rendszer-
--      e-mailjeit tárolják (meghívó/reset/üdvözlő/trial) — azokat NEM
--      érintjük, hogy a globális rendszer-küldés ne sérüljön.
--    - A meglévő `email_templates` tábla a kliens-levelező SZABAD szöveges
--      sablonjait tárolja (name/subject/body, egynyelvű) — a routes/client-mail.js
--      használja; abba nem fér bele a kulcs/kategória/kétnyelvűség séma.
--    - Ez a tábla CÉGSZINTŰ, KÉTNYELVŰ, KULCS/KATEGÓRIA alapú tranzakciós
--      sablonokat tárol (fuvar-visszaigazolás, státusz-változás, árajánlat,
--      számla-értesítő, általános). Külön névtér -> nincs ütközés.
--
--  Multi-tenant: minden sor egy company_id-hez tartozik.
-- ============================================================

CREATE TABLE IF NOT EXISTS company_email_templates (
    id          SERIAL PRIMARY KEY,
    company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    key         VARCHAR(64) NOT NULL,   -- order_confirm_carrier | order_status_change | quote_send | invoice_notify | generic
    category    VARCHAR(64),            -- csoportosítás a UI-hoz
    subject_ro  TEXT,
    subject_hu  TEXT,
    body_ro     TEXT,                   -- {{order_id}}, {{client}}, {{route}}, {{status}}, {{pret}}, {{invoice_no}} stb.
    body_hu     TEXT,
    active      BOOLEAN NOT NULL DEFAULT true,
    updated_at  TIMESTAMPTZ DEFAULT now(),
    UNIQUE (company_id, key)
);

CREATE INDEX IF NOT EXISTS idx_company_email_templates_company
    ON company_email_templates (company_id);
