-- ═══════════════════════════════════════════════════════════════
--  route_search_learn — az útvonaltervező keresője cégenként tanul
--  a felhasználók pick-jeiből: (bevitt szó, kiválasztott hely) pár
--  eltárolva; a következő kereséskor a tanult sorok elöl jönnek.
--  A fuvarozás jellemző ismétlődő címei (állandó ügyfelek, raktárak,
--  tankolóhelyek, terminálok) így 2-3 használat után magától a lista
--  élére emelkednek.
--
--  Multi-tenant: minden sor `company_id`-hoz kötött. Cross-tenant szivárgás
--  nincs: `rpAcSearch` és `rpAcPick` mindig a session-cég szerint szűr.
--
--  A `query_norm` alacsonyabb esetes trimmelt bevitel (kb. mint amit a
--  keresőben látunk gépelés közben). Prefix-match: `query_norm LIKE $q || '%'`.
--
--  `pick_count` + `last_used_at` együtt adják a rangsort: gyakori + friss
--  találat elöl. Ha a felhasználó máshova megy egy címről, a régi lecsúszik
--  (nem törlődik — csak a rangsorolásban visszaesik).
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS route_search_learn (
  id           SERIAL PRIMARY KEY,
  company_id   INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_email   VARCHAR(255),
  query_norm   VARCHAR(80) NOT NULL,
  label        VARCHAR(500) NOT NULL,
  title        VARCHAR(300),
  lat          DOUBLE PRECISION,
  lng          DOUBLE PRECISION,
  cat_hint     VARCHAR(120),
  pick_count   INTEGER NOT NULL DEFAULT 1,
  first_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- UNIQUE (company_id, query_norm, label) → ugyanaz a query→label párost
-- csak egyszer tároljuk, ON CONFLICT UPDATE-tel emeljük a pick_count-ot.
CREATE UNIQUE INDEX IF NOT EXISTS route_search_learn_uniq
  ON route_search_learn (company_id, query_norm, label);

-- Prefix-match index — company + query_norm elején.
CREATE INDEX IF NOT EXISTS route_search_learn_prefix
  ON route_search_learn (company_id, query_norm text_pattern_ops);

-- Frissesség alapú rangsorhoz.
CREATE INDEX IF NOT EXISTS route_search_learn_last_used
  ON route_search_learn (company_id, last_used_at DESC);
