// ============================================================
//  VallorSoft — handlers/ordersDone.js
//  Teljesített fuvarok (status='Finalizat') read-only archív nézet.
//  Külön kis lekérdezés, mert a comList nem ad vissza dátum-mezőt
//  a dátum-szűréshez/KPI-hez. NEM módosítja a meglévő fuvarlista-logikát.
//  Multi-tenant: minden lekérdezés company_id-re szűrt, paraméteres.
// ============================================================
const pool = require('../db');

const handlers = {};

function _argObj(args) {
  if (Array.isArray(args)) return args[0] || {};
  return args || {};
}

// Teljesített fuvarok dátum-ablakkal (opcionális from/to, YYYY-MM-DD).
// A dátum a finalized_at (ha van), különben created_at.
handlers.getFinishedOrders = async function (req, res, args) {
  try {
    if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
      return res.json({ result: { ok: false, err: 'Acces interzis' } });
    }
    const cid = req.session.user.company_id;
    const a = _argObj(args);

    // Dátum-szűrő paraméteresen; az effektív dátum COALESCE(finalized_at, created_at).
    const params = [cid];
    const where = [`o.company_id = $1`, `o.status = 'Finalizat'`];
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    if (a.from && dateRe.test(String(a.from))) {
      params.push(String(a.from));
      where.push(`COALESCE(o.finalized_at, o.created_at) >= $${params.length}::date`);
    }
    if (a.to && dateRe.test(String(a.to))) {
      params.push(String(a.to));
      // bezárólag: a megadott napot is beleértve (< következő nap)
      where.push(`COALESCE(o.finalized_at, o.created_at) < ($${params.length}::date + INTERVAL '1 day')`);
    }

    const { rows } = await pool.query(
      `SELECT o.id, o.client, o.ref, o.loc_incarcare, o.loc_descarcare,
              o.pret, o.km, o.sofer_type, o.nume_sofer, o.email_sofer, o.firma_extern,
              o.rendszam_camion, o.payment_status,
              COALESCE(o.finalized_at, o.created_at) AS done_at
         FROM orders o
        WHERE ${where.join(' AND ')}
        ORDER BY done_at DESC
        LIMIT 1000`,
      params
    );
    return res.json({ result: { ok: true, orders: rows } });
  } catch (err) {
    console.error('getFinishedOrders hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

module.exports = handlers;
