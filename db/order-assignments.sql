-- ============================================================
--  VallorSoft — Comanda de Transport (Megbízás / megrendelés)
--  ------------------------------------------------------------
--  Egy fuvarhoz TARTOZIK legfeljebb egy „megbízás" (Comanda de
--  Transport), amit az admin/manager állít össze külsős
--  alvállalkozónak vagy címzettnek. A fuvar-adatok előtöltve
--  jönnek (loc/data/kg/carrier/carrier_cost/stop-lista); a
--  többi (interval, paleti, tip palet, DA/NU csomag, TIP camion
--  bővítmények) a `fields` JSONB-ben szabad-formában él.
--
--  Biztonsági alapelvek:
--   - Multi-tenant: minden lekérdezés a session company_id-jére
--     szűr, paraméteres SQL-lel.
--   - Cross-tenant write védelem: a handler ELŐSZÖR ellenőrzi,
--     hogy a fuvar a hívó cégéhez tartozik (mint az e-CMR-nél).
--   - A rendered_pdf_base64 / signed_pdf_base64 csak a saját
--     cég-userek felé megy vissza (base64, JSON válaszban).
--
--  MEGŐRZÉS: a megbízás dokumentum a fuvar része — a fuvar
--  törlésekor CASCADE. A jogi/fuvar-megőrzés (Legea 82/1991,
--  5 év) a fuvar szintjén rendezett.
-- ============================================================

CREATE TABLE IF NOT EXISTS order_assignments (
  id                     BIGSERIAL PRIMARY KEY,
  order_id               VARCHAR(20) NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  company_id             INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  -- Fejléc: a megjelenített megbízás-szám ("Comanda Nr.")
  --   'auto'  → a `orders.fuvar_no`-t (CMD-YYYY-XXXX) használjuk render-időben
  --   'custom'→ a `custom_number` mező a végleges
  number_source          VARCHAR(10) NOT NULL DEFAULT 'auto'
                         CHECK (number_source IN ('auto','custom')),
  custom_number          VARCHAR(60),
  -- Alvállalkozó (a fuvar `carrier_id`-ja jellemzően; a szerkesztő
  -- felülírhatja, ezért itt is snapshotoljuk):
  carrier_id             INTEGER,
  carrier_snapshot       JSONB DEFAULT '{}'::jsonb,   -- nev/cui/reg_com/adresa/telefon/email/iban
  -- Kereskedelmi feltételek (az `orders.carrier_cost` snapshot-ja
  -- + editable, mert kerekítés / árrés-titkosság):
  price                  NUMERIC(12,2),
  currency               VARCHAR(3),
  payment_term_days      INTEGER,
  -- Mind a többi szerkeszthető mező JSON-ban:
  --   {
  --     stops: {
  --       pickups:   [ {stop_id, interval, paleti, tip_palet, kg, metri, referinta, instructiuni} ],
  --       deliveries:[ {stop_id, interval, paleti, tip_palet, kg, metri, referinta, instructiuni} ]
  --     },
  --     vehicle: {
  --       tip_camion, // szabadszöveg (alap: "CAP TRACTOR / 13.6 m prelata standard")
  --       truck_kinds: ["standard","mega","frigo",...],
  --       flags: { doi_soferi, podea_goala, chingi, presuri, coltare, paleti_schimb,
  --                termodiagrama, cablu_vamal, adr },  // mind bool
  --       alte_specificatii
  --     },
  --     driver: { name, phone }
  --   }
  fields                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- A legutóbb generált PDF (client-side pdf-lib-bel készítve, base64):
  rendered_pdf_base64    TEXT,
  rendered_at            TIMESTAMPTZ,
  -- Az aláírt+lepecsételt változat (a meglévő buildSignedPdf mintán):
  signed_pdf_base64      TEXT,
  signed_at              TIMESTAMPTZ,
  signed_by              VARCHAR(255),
  -- Audit
  created_by             VARCHAR(255),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Egy fuvarhoz egy megbízás (a második `Save` ugyanezt frissíti).
CREATE UNIQUE INDEX IF NOT EXISTS uq_order_assignments_order
  ON order_assignments (order_id);
CREATE INDEX IF NOT EXISTS idx_order_assignments_company
  ON order_assignments (company_id);
