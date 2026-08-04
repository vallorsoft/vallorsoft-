-- ============================================================
--  VallorSoft — fuvar több felrakó/lerakó pontja (idempotens)
--  ------------------------------------------------------------
--  Egy fuvarhoz TÖBB felrakási (pickup) és/vagy lerakási (delivery)
--  pont tartozhat. A régi orders.loc_incarcare/loc_descarcare/
--  data_*/firma_*/sosit_*_at/incarcat_at/descarcat_at mezők
--  MEGMARADNAK visszamenőleges kompatibilitás miatt: a legalsó
--  első pickup ill. a legalsó utolsó delivery származéka a fuvar
--  „főoldali" felrakó/lerakó. A milestone-mirror mezők egy
--  trigger-nek köszönhetően automatikusan szinkronizálódnak.
--
--  waybilled_at: mikor került rá EGY (vagy több) mentett menetlevél
--  puncte-tömbjébe. Egy stop akkor van „lezárva" a menetlevél
--  szempontjából, ha waybilled_at IS NOT NULL. A menetlevél-picker
--  csak akkor engedi eltűnni a fuvart, ha MINDEN stop-ja waybilled.
-- ============================================================

CREATE TABLE IF NOT EXISTS order_stops (
  id            BIGSERIAL PRIMARY KEY,
  order_id      VARCHAR(20) NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  company_id    INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind          VARCHAR(16) NOT NULL CHECK (kind IN ('pickup','delivery')),
  stop_index    INTEGER NOT NULL DEFAULT 0,      -- sorrend a kind-en belül (0-alapú)
  loc           VARCHAR(255),
  firma         VARCHAR(255),
  data          DATE,                            -- tervezett dátum
  ref           TEXT,                            -- opcionális utasítás / hivatkozás
  arrived_at    TIMESTAMPTZ,                     -- sofőr megérkezett
  done_at       TIMESTAMPTZ,                     -- sofőr elvégezte (felrakta / leürítette)
  waybilled_at  TIMESTAMPTZ,                     -- mentett menetlevélbe került (per-stop)
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_stops_order   ON order_stops(order_id);
CREATE INDEX IF NOT EXISTS idx_order_stops_company ON order_stops(company_id);
CREATE INDEX IF NOT EXISTS idx_order_stops_kind    ON order_stops(order_id, kind, stop_index);

-- ─── Backfill: minden meglévő fuvarhoz egy pickup + egy delivery, ha még nincs
-- ------------------------------------------------------------------
-- Ha van legalább egy loc_incarcare VAGY sosit_incarcare_at / incarcat_at,
-- felveszünk egy pickup#0-t. Ugyanígy a delivery-nél. A dátum/idő mezők
-- a régi orders.* értékeiből öröklődnek, hogy a régi fuvarok statisztikája
-- ne veszítsen adatot.
INSERT INTO order_stops (order_id, company_id, kind, stop_index,
                         loc, firma, data, arrived_at, done_at,
                         created_at, updated_at)
SELECT o.id, o.company_id, 'pickup', 0,
       o.loc_incarcare, o.firma_incarcare, o.data_incarcare,
       o.sosit_incarcare_at, o.incarcat_at,
       COALESCE(o.created_at, NOW()), NOW()
  FROM orders o
 WHERE NOT EXISTS (
         SELECT 1 FROM order_stops s
          WHERE s.order_id = o.id AND s.kind = 'pickup'
       )
   AND (o.loc_incarcare IS NOT NULL
        OR o.sosit_incarcare_at IS NOT NULL
        OR o.incarcat_at IS NOT NULL
        OR o.data_incarcare IS NOT NULL);

INSERT INTO order_stops (order_id, company_id, kind, stop_index,
                         loc, firma, data, arrived_at, done_at,
                         created_at, updated_at)
SELECT o.id, o.company_id, 'delivery', 0,
       o.loc_descarcare, o.firma_descarcare, o.data_descarcare,
       o.sosit_descarcare_at, o.descarcat_at,
       COALESCE(o.created_at, NOW()), NOW()
  FROM orders o
 WHERE NOT EXISTS (
         SELECT 1 FROM order_stops s
          WHERE s.order_id = o.id AND s.kind = 'delivery'
       )
   AND (o.loc_descarcare IS NOT NULL
        OR o.sosit_descarcare_at IS NOT NULL
        OR o.descarcat_at IS NOT NULL
        OR o.data_descarcare IS NOT NULL);

-- ─── Backfill: waybilled_at — meglévő menetlevelek puncte-jából
-- ------------------------------------------------------------------
-- A régi puncte-sorok nem tartalmaznak stopId-t, csak {orderId, role}.
-- Kompatibilitás: egy pickup / delivery esetén tudjuk párosítani, több
-- stopnál (visszamenőleg) az összes azonos kind-ű stopot waybilled-nek
-- vesszük — MERT a régi menetlevél teljes fuvar-részt csak egyet tudott
-- kezelni. Új menetlevélről a stopId szerint pontosan megjelöljük.
UPDATE order_stops s
   SET waybilled_at = COALESCE(s.waybilled_at, sub.wb_at)
  FROM (
    SELECT (p->>'orderId')::text AS order_id,
           CASE p->>'role' WHEN 'loading' THEN 'pickup'
                            WHEN 'unloading' THEN 'delivery'
                            ELSE NULL END AS kind,
           MIN(f.data_completare) AS wb_at
      FROM fuvarlevelek f
     CROSS JOIN LATERAL jsonb_array_elements(COALESCE(f.puncte,'[]'::jsonb)) p
     WHERE p->>'orderId' IS NOT NULL
       AND p->>'role' IN ('loading','unloading')
     GROUP BY (p->>'orderId'), (p->>'role')
  ) sub
 WHERE s.order_id = sub.order_id
   AND s.kind = sub.kind
   AND s.waybilled_at IS NULL;

-- ─── Trigger: orders.*_at mirror-mezők automatikus szinkronja
-- ------------------------------------------------------------------
-- Amikor egy stop változik (INSERT/UPDATE/DELETE), a fuvar top-szintű
-- „főoldali" mezői (loc_incarcare, loc_descarcare, data_incarcare,
-- data_descarcare, firma_incarcare, firma_descarcare) és a milestone
-- mirror-mezők (sosit_incarcare_at = MIN(pickup.arrived_at),
-- incarcat_at = utolsó pickup.done_at ha ÖSSZES pickup done,
-- sosit_descarcare_at = MIN(delivery.arrived_at),
-- descarcat_at = utolsó delivery.done_at ha ÖSSZES delivery done)
-- újraszámolódnak. Egyetlen stopnál a viselkedés bit-azonos a régivel.
CREATE OR REPLACE FUNCTION order_stops_sync_mirror() RETURNS TRIGGER AS $$
DECLARE
  _order_id VARCHAR(20);
  _pu_first_loc TEXT;
  _pu_first_firma TEXT;
  _pu_first_data DATE;
  _pu_arrived_at TIMESTAMPTZ;
  _pu_done_at TIMESTAMPTZ;
  _pu_open INT;
  _de_last_loc TEXT;
  _de_last_firma TEXT;
  _de_last_data DATE;
  _de_arrived_at TIMESTAMPTZ;
  _de_done_at TIMESTAMPTZ;
  _de_open INT;
BEGIN
  IF TG_OP = 'DELETE' THEN _order_id := OLD.order_id;
  ELSE _order_id := NEW.order_id;
  END IF;

  -- Első pickup (stop_index szerint) → loc/firma/data mirror
  SELECT loc, firma, data
    INTO _pu_first_loc, _pu_first_firma, _pu_first_data
    FROM order_stops
   WHERE order_id = _order_id AND kind = 'pickup'
   ORDER BY stop_index ASC LIMIT 1;

  -- Utolsó delivery (stop_index szerint) → loc/firma/data mirror
  SELECT loc, firma, data
    INTO _de_last_loc, _de_last_firma, _de_last_data
    FROM order_stops
   WHERE order_id = _order_id AND kind = 'delivery'
   ORDER BY stop_index DESC LIMIT 1;

  -- Pickup milestone mirror
  SELECT MIN(arrived_at),
         CASE WHEN COUNT(*) FILTER (WHERE done_at IS NULL) = 0
                   AND COUNT(*) > 0
              THEN MAX(done_at) ELSE NULL END,
         COUNT(*) FILTER (WHERE done_at IS NULL)
    INTO _pu_arrived_at, _pu_done_at, _pu_open
    FROM order_stops
   WHERE order_id = _order_id AND kind = 'pickup';

  -- Delivery milestone mirror
  SELECT MIN(arrived_at),
         CASE WHEN COUNT(*) FILTER (WHERE done_at IS NULL) = 0
                   AND COUNT(*) > 0
              THEN MAX(done_at) ELSE NULL END,
         COUNT(*) FILTER (WHERE done_at IS NULL)
    INTO _de_arrived_at, _de_done_at, _de_open
    FROM order_stops
   WHERE order_id = _order_id AND kind = 'delivery';

  UPDATE orders SET
    loc_incarcare       = COALESCE(_pu_first_loc, loc_incarcare),
    firma_incarcare     = COALESCE(_pu_first_firma, firma_incarcare),
    data_incarcare      = COALESCE(_pu_first_data, data_incarcare),
    loc_descarcare      = COALESCE(_de_last_loc, loc_descarcare),
    firma_descarcare    = COALESCE(_de_last_firma, firma_descarcare),
    data_descarcare     = COALESCE(_de_last_data, data_descarcare),
    sosit_incarcare_at  = _pu_arrived_at,
    incarcat_at         = _pu_done_at,
    sosit_descarcare_at = _de_arrived_at,
    descarcat_at        = _de_done_at,
    updated_at          = NOW()
  WHERE id = _order_id;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_order_stops_sync ON order_stops;
CREATE TRIGGER trg_order_stops_sync
AFTER INSERT OR UPDATE OR DELETE ON order_stops
FOR EACH ROW EXECUTE FUNCTION order_stops_sync_mirror();
