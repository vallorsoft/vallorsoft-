// ============================================================
//  VallorSoft — Fuvar (order) sorszám-generátor
//  Ember-olvasható, cégenként/évenként növekvő fuvar-szám
//  (pl. CMD-2026-0001) a `document_series` táblából (doc_type='CMD'),
//  ugyanazzal a mintával, mint a menetlevél (MT-YYYY-XXXX).
//
//  FONTOS: a belső orders.id (genDocId véletlen kulcs) VÁLTOZATLAN
//  marad — ez csak megjelenítési/hivatkozási szám, nem elsődleges kulcs.
//
//  A `db` paraméter lehet a megosztott pool VAGY egy tranzakciós kliens.
//  A hívók best-effort módon hívják (try/catch): ha bármiért elszáll
//  (pl. hiányzó document_series tábla), a fuvar mentése akkor is fusson.
// ============================================================

async function nextFuvarNo(db, companyId, year) {
  if (!db || !companyId) return null;
  year = year || new Date().getFullYear();
  const r = await db.query(
    `INSERT INTO document_series (company_id, doc_type, prefix, year, current_seq)
       VALUES ($1, 'CMD', 'CMD', $2, 1)
     ON CONFLICT (company_id, doc_type, year)
       DO UPDATE SET current_seq = document_series.current_seq + 1, updated_at = NOW()
     RETURNING prefix, current_seq`,
    [companyId, year]
  );
  if (!r.rows[0]) return null;
  return `${r.rows[0].prefix}-${year}-${String(r.rows[0].current_seq).padStart(4, '0')}`;
}

module.exports = { nextFuvarNo };
