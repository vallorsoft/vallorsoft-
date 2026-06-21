// ============================================================
//  VallorSoft — handlers/orderSeries.js
//  Fuvar-szériák (fuvar-szám előtagok) kezelése — RPC.
//
//  A cég SAJÁT MAGÁNAK állíthatja a fuvar-szám előtagját (mint a
//  menetlevél-szériát): alapból 'CMD', de új szériát is felvehet,
//  átnevezhet, és fuvar-kiíráskor választhat közülük.
//
//  Modell: order_series (prefix + belső seq_key + is_default). A
//  tényleges számláló a document_series-ben él (doc_type = seq_key).
//  Az előtag (prefix) ELVÁLIK a seq_key-től → átnevezhető a számlálás
//  megszakítása nélkül. A belső orders.id (véletlen kulcs) változatlan.
//
//  Multi-tenant: minden lekérdezés company_id-szűrt (session), paraméteres.
//  Olvasás: Admin/Manager. Írás: CSAK Admin. Minden írás auditált.
// ============================================================
const pool = require('../db');
const audit = require('../lib/audit');
const { getDefaultSeries } = require('../lib/orderNo');

const handlers = {};

function _user(req) { return (req && req.session && req.session.user) || null; }
function _am(req) { const u = _user(req); return !!(u && ['Admin', 'Manager'].includes(u.pozicio)); }
function _admin(req) { const u = _user(req); return !!(u && u.pozicio === 'Admin'); }

// A menetlevél doc_type-ja foglalt — fuvar-széria előtagja ne ütközzön vele.
const RESERVED_PREFIXES = ['MT'];

function _normPrefix(x) {
  return String(x == null ? '' : x).trim().toUpperCase();
}

// ── Lista (Admin/Manager) ──
handlers.orderSeriesList = async function (req, res) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = _user(req).company_id;
    // Garantáljuk, hogy legyen legalább az alapértelmezett 'CMD' széria.
    await getDefaultSeries(pool, cid);
    const year = new Date().getFullYear();
    const r = await pool.query(
      `SELECT os.id, os.prefix, os.seq_key, os.is_default,
              COALESCE(ds.current_seq, 0) AS current_seq
         FROM order_series os
         LEFT JOIN document_series ds
           ON ds.company_id = os.company_id AND ds.doc_type = os.seq_key AND ds.year = $2
        WHERE os.company_id = $1
        ORDER BY os.is_default DESC, os.id ASC`,
      [cid, year]
    );
    return res.json({ result: { ok: true, series: r.rows, year: year, canEdit: _admin(req) } });
  } catch (err) {
    console.error('orderSeriesList hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// ── Létrehozás / átnevezés (CSAK Admin) ──
// args: [{ id?, prefix, makeDefault? }]
//   - id nélkül: új széria
//   - id-vel: a meglévő (cégéhez tartozó) széria ELŐTAGJÁNAK átnevezése
//     (a seq_key/számláló változatlan → a számozás folytatódik)
handlers.orderSeriesSave = async function (req, res, args) {
  try {
    if (!_admin(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = _user(req).company_id;
    const a = (args && args[0]) || {};
    const prefix = _normPrefix(a.prefix);
    const id = a.id != null && a.id !== '' ? parseInt(a.id, 10) : null;
    const makeDefault = !!a.makeDefault;

    if (!/^[A-Z0-9]{1,10}$/.test(prefix)) {
      return res.json({ result: { ok: false, err: 'Prefix invalid (1-10 caractere: litere/cifre).' } });
    }
    if (RESERVED_PREFIXES.includes(prefix)) {
      return res.json({ result: { ok: false, err: 'Acest prefix este rezervat (folosit de seria de foi de parcurs).' } });
    }
    // Egyediség a cégen belül (átnevezésnél a saját sorát kihagyva).
    const dup = await pool.query(
      `SELECT 1 FROM order_series WHERE company_id = $1 AND prefix = $2 AND ($3::int IS NULL OR id <> $3)`,
      [cid, prefix, id]
    );
    if (dup.rows.length) {
      return res.json({ result: { ok: false, err: 'Există deja o serie cu acest prefix.' } });
    }

    const dbc = await pool.connect();
    try {
      await dbc.query('BEGIN');
      let seriesId = id;
      if (id) {
        // Tulajdon-ellenőrzés + átnevezés (seq_key marad).
        const own = await dbc.query('SELECT 1 FROM order_series WHERE id = $1 AND company_id = $2', [id, cid]);
        if (!own.rows.length) { await dbc.query('ROLLBACK'); return res.json({ result: { ok: false, err: 'Seria nu a fost gasita.' } }); }
        await dbc.query('UPDATE order_series SET prefix = $1, updated_at = NOW() WHERE id = $2 AND company_id = $3', [prefix, id, cid]);
      } else {
        // Új széria — ütközésmentes seq_key (sosem 'MT'/'CMD').
        const seqKey = 'OS' + Date.now().toString(36).toUpperCase();
        const ins = await dbc.query(
          `INSERT INTO order_series (company_id, prefix, seq_key, is_default) VALUES ($1, $2, $3, false) RETURNING id`,
          [cid, prefix, seqKey]
        );
        seriesId = ins.rows[0].id;
      }
      if (makeDefault && seriesId) {
        await dbc.query('UPDATE order_series SET is_default = false WHERE company_id = $1', [cid]);
        await dbc.query('UPDATE order_series SET is_default = true WHERE id = $1 AND company_id = $2', [seriesId, cid]);
      }
      await dbc.query('COMMIT');
      audit.fromReq(req, id ? 'order_series.rename' : 'order_series.create', 'order_series', seriesId, { prefix: prefix, makeDefault: makeDefault });
      return res.json({ result: { ok: true, id: seriesId } });
    } catch (e) {
      await dbc.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      dbc.release();
    }
  } catch (err) {
    console.error('orderSeriesSave hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// ── Alapértelmezett beállítása (CSAK Admin) ──
// args: [{ id }]  vagy  [id]
handlers.orderSeriesSetDefault = async function (req, res, args) {
  try {
    if (!_admin(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = _user(req).company_id;
    const a = (args && args[0]) || {};
    const id = parseInt(a.id != null ? a.id : a, 10);
    if (!Number.isFinite(id)) return res.json({ result: { ok: false, err: 'ID invalid.' } });

    const own = await pool.query('SELECT 1 FROM order_series WHERE id = $1 AND company_id = $2', [id, cid]);
    if (!own.rows.length) return res.json({ result: { ok: false, err: 'Seria nu a fost gasita.' } });

    const dbc = await pool.connect();
    try {
      await dbc.query('BEGIN');
      await dbc.query('UPDATE order_series SET is_default = false WHERE company_id = $1', [cid]);
      await dbc.query('UPDATE order_series SET is_default = true WHERE id = $1 AND company_id = $2', [id, cid]);
      await dbc.query('COMMIT');
    } catch (e) {
      await dbc.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      dbc.release();
    }
    audit.fromReq(req, 'order_series.set_default', 'order_series', id, {});
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('orderSeriesSetDefault hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// ── Törlés (CSAK Admin) ──
// args: [{ id }] vagy [id]. Az alapértelmezett széria nem törölhető.
// A document_series számláló-sort MEGHAGYJUK (a már kiadott fuvar-számok
// történeti integritása + későbbi azonos-prefixű széria folytathatósága).
handlers.orderSeriesDelete = async function (req, res, args) {
  try {
    if (!_admin(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = _user(req).company_id;
    const a = (args && args[0]) || {};
    const id = parseInt(a.id != null ? a.id : a, 10);
    if (!Number.isFinite(id)) return res.json({ result: { ok: false, err: 'ID invalid.' } });

    const r = await pool.query('SELECT prefix, is_default FROM order_series WHERE id = $1 AND company_id = $2', [id, cid]);
    if (!r.rows.length) return res.json({ result: { ok: false, err: 'Seria nu a fost gasita.' } });
    if (r.rows[0].is_default) {
      return res.json({ result: { ok: false, err: 'Seria implicita nu poate fi stearsa. Setati alta serie ca implicita mai intai.' } });
    }
    await pool.query('DELETE FROM order_series WHERE id = $1 AND company_id = $2', [id, cid]);
    audit.fromReq(req, 'order_series.delete', 'order_series', id, { prefix: r.rows[0].prefix });
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('orderSeriesDelete hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

module.exports = handlers;
