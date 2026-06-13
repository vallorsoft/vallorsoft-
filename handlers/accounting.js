// ============================================================
//  VallorSoft — handlers/accounting.js  (KÖNYVELŐI felület)
//  Minden dokumentum fuvarra/dátumra rendezve: megrendelés-dokumentumok,
//  POD-fotók, alvállalkozói feltöltések. (A tömeges ZIP-letöltés és a
//  SAGA/WinMentor CSV-export a routes/accounting.js-ben.)
// ============================================================
const pool = require('../db');

const handlers = {};
function _ok(req) { return req.session.user && ['Admin', 'Manager', 'Konyvelo'].includes(req.session.user.pozicio); }
function _range(a) {
  const x = (a && a[0]) || {};
  const to = x.to ? new Date(x.to + 'T23:59:59') : new Date();
  let from;
  if (x.from) from = new Date(x.from + 'T00:00:00');
  else { from = new Date(); from.setMonth(from.getMonth() - 1); }
  return { from: from.toISOString(), to: to.toISOString() };
}

handlers.getAccountingDocs = async function (req, res, args) {
  try {
    if (!_ok(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = req.session.user.company_id;
    const { from, to } = _range(args);

    const od = await pool.query(
      `SELECT od.id, od.order_id, od.file_name, od.created_at, (od.signed_base64 IS NOT NULL) AS signed,
              o.client, o.data_incarcare
       FROM order_documents od
       LEFT JOIN orders o ON o.id = od.order_id AND o.company_id = od.company_id
       WHERE od.company_id = $1 AND od.created_at >= $2 AND od.created_at <= $3`, [cid, from, to]);
    const pod = await pool.query(
      `SELECT d.id, d.order_id, d.file_name, d.tip, d.created_at, o.client, o.data_incarcare
       FROM documents d JOIN orders o ON o.id = d.order_id AND o.company_id = $1
       WHERE d.created_at >= $2 AND d.created_at <= $3`, [cid, from, to]);
    const cd = await pool.query(
      `SELECT cd.id, cd.order_id, cd.file_name, cd.kind, cd.created_at, c.nev AS carrier_nev
       FROM carrier_documents cd LEFT JOIN carriers c ON c.id = cd.carrier_id AND c.company_id = cd.company_id
       WHERE cd.company_id = $1 AND cd.created_at >= $2 AND cd.created_at <= $3`, [cid, from, to]);

    const docs = [];
    od.rows.forEach((r) => docs.push({ src: 'order_doc', id: r.id, order_id: r.order_id || null,
      name: r.file_name || 'dokumentum.pdf', type: r.signed ? 'Aláírt CMR' : 'Megrendelés-dok',
      created_at: r.created_at, client: r.client, order_date: r.data_incarcare }));
    pod.rows.forEach((r) => docs.push({ src: 'pod', id: r.id, order_id: r.order_id || null,
      name: r.file_name || 'pod-foto', type: 'POD / fotó', created_at: r.created_at, client: r.client, order_date: r.data_incarcare }));
    cd.rows.forEach((r) => docs.push({ src: 'carrier_doc', id: r.id, order_id: r.order_id || null,
      name: r.file_name || 'feltoltes', type: 'Alvállalkozói' + (r.kind ? ' (' + r.kind + ')' : ''),
      created_at: r.created_at, client: r.carrier_nev }));

    docs.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

    const invS = await pool.query(`SELECT COUNT(*)::int AS n FROM invoices WHERE company_id=$1 AND created_at>=$2 AND created_at<=$3`, [cid, from, to]);
    const invP = await pool.query(`SELECT COUNT(*)::int AS n FROM carrier_invoices WHERE company_id=$1 AND created_at>=$2 AND created_at<=$3`, [cid, from, to]);
    const co = await pool.query('SELECT nev FROM companies WHERE id=$1', [cid]);
    return res.json({ result: { ok: true, docs, from, to,
      sales_invoices: invS.rows[0].n, purchase_invoices: invP.rows[0].n,
      nev: req.session.user.nume || req.session.user.email, ceg_nev: (co.rows[0] || {}).nev || '' } });
  } catch (err) {
    console.error('getAccountingDocs hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

module.exports = handlers;
