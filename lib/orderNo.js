// ============================================================
//  VallorSoft — Fuvar (order) sorszám-generátor + szériák
//  Ember-olvasható, cégenként/évenként növekvő fuvar-szám
//  (pl. CMD-2026-0001) a `document_series` táblából, ugyanazzal
//  a mintával, mint a menetlevél (MT-YYYY-XXXX).
//
//  Szériák (order_series): a cég több, választható fuvar-szériát
//  tarthat fenn (megjelenített `prefix` + belső `seq_key`). A számláló
//  a `document_series`-ben él, doc_type = seq_key kulccsal — így a
//  megjelenített előtag átnevezhető a számlálás megszakítása nélkül.
//
//  FONTOS: a belső orders.id (genDocId véletlen kulcs) VÁLTOZATLAN
//  marad — ez csak megjelenítési/hivatkozási szám, nem elsődleges kulcs.
//
//  A `db` paraméter lehet a megosztott pool VAGY egy tranzakciós kliens.
//  A hívók best-effort módon hívják (try/catch): ha bármiért elszáll
//  (pl. hiányzó tábla), a fuvar mentése akkor is fusson (fuvar_no=NULL).
// ============================================================

// Az adott cég alapértelmezett szériája (ha még nincs, létrehozza a 'CMD'-t).
// Visszatérés: { id, prefix, seq_key } vagy egy beégetett CMD-fallback.
async function getDefaultSeries(db, companyId) {
  if (!db || !companyId) return { prefix: 'CMD', seq_key: 'CMD' };
  let r = await db.query(
    `SELECT id, prefix, seq_key FROM order_series
      WHERE company_id = $1 ORDER BY is_default DESC, id ASC LIMIT 1`,
    [companyId]
  );
  if (r.rows[0]) return r.rows[0];
  // Nincs még széria → seedeljük az alapértelmezett 'CMD'-t (seq_key='CMD',
  // hogy a meglévő document_series 'CMD' számláló folytatódjon).
  await db.query(
    `INSERT INTO order_series (company_id, prefix, seq_key, is_default)
       VALUES ($1, 'CMD', 'CMD', true)
     ON CONFLICT (company_id, prefix) DO NOTHING`,
    [companyId]
  );
  r = await db.query(
    `SELECT id, prefix, seq_key FROM order_series
      WHERE company_id = $1 ORDER BY is_default DESC, id ASC LIMIT 1`,
    [companyId]
  );
  return r.rows[0] || { prefix: 'CMD', seq_key: 'CMD' };
}

// Egy adott (a cégéhez tartozó) szériát old fel id alapján; ha nincs/nem
// a cégé → az alapértelmezettre esik vissza (sosem ad idegen szériát).
async function resolveOrderSeries(db, companyId, seriesId) {
  if (db && companyId && seriesId != null && seriesId !== '') {
    const id = parseInt(seriesId, 10);
    if (Number.isFinite(id)) {
      const r = await db.query(
        `SELECT id, prefix, seq_key FROM order_series WHERE id = $1 AND company_id = $2`,
        [id, companyId]
      );
      if (r.rows[0]) return r.rows[0];
    }
  }
  return getDefaultSeries(db, companyId);
}

// A következő fuvar-szám (CMD-YYYY-XXXX) a megadott szériához.
// `series` = { prefix, seq_key } (pl. resolveOrderSeries eredménye);
// ha hiányzik, a cég alapértelmezett szériáját használja.
async function nextFuvarNo(db, companyId, year, series) {
  if (!db || !companyId) return null;
  year = year || new Date().getFullYear();
  if (!series) series = await getDefaultSeries(db, companyId);
  const prefix = series.prefix || 'CMD';
  const seqKey = series.seq_key || series.seqKey || 'CMD';
  const r = await db.query(
    `INSERT INTO document_series (company_id, doc_type, prefix, year, current_seq)
       VALUES ($1, $2, $3, $4, 1)
     ON CONFLICT (company_id, doc_type, year)
       DO UPDATE SET current_seq = document_series.current_seq + 1,
                     prefix = $3, updated_at = NOW()
     RETURNING current_seq`,
    [companyId, seqKey, prefix, year]
  );
  if (!r.rows[0]) return null;
  return `${prefix}-${year}-${String(r.rows[0].current_seq).padStart(4, '0')}`;
}

module.exports = { nextFuvarNo, getDefaultSeries, resolveOrderSeries };
