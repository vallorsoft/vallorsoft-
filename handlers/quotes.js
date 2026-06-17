// ============================================================
//  VallorSoft — handlers/quotes.js
//  Árajánlatok (Quotes / Cotații) — RPC handlerek.
//  Multi-tenant: minden lekérdezés company_id-szűrt, paraméteres SQL.
//  Lista: bármely belépett felhasználó; írás/konverzió: csak Admin/Manager.
//  A "→ Fuvar" konverzió a MEGLÉVŐ fuvar-létrehozót (comCreate) hívja,
//  NEM duplikálja a fuvar üzleti logikáját.
// ============================================================
const pool = require('../db');
const audit = require('../lib/audit');
const orderHandlers = require('./orders');

const handlers = {};

const STATUSES = ['draft', 'sent', 'awarded', 'lost'];

function _am(req) { return req.session.user && ['Admin', 'Manager'].includes(req.session.user.pozicio); }
function _str(x, n) { const s = x == null ? null : String(x).trim().slice(0, n); return s || null; }
function _num(x) { if (x === '' || x == null) return null; const n = Number(x); return Number.isFinite(n) ? n : null; }

// ─── Lista — bármely belépett felhasználó a saját cégéé ──────
// args: [{ status?, from?, to? }]
handlers.quoteList = async function (req, res, args) {
  try {
    if (!req.session.user) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = req.session.user.company_id;
    const a = (args && args[0]) || {};
    const params = [cid];
    let sql = `SELECT id, client_id, client_name, loc_from, loc_to, price, valuta,
                      status, valid_until, note, order_id, created_by, created_at
               FROM quotes WHERE company_id = $1`;
    if (a.status && STATUSES.includes(a.status)) { params.push(a.status); sql += ` AND status = $${params.length}`; }
    if (a.from) { params.push(a.from); sql += ` AND created_at >= $${params.length}`; }
    if (a.to) { params.push(a.to); sql += ` AND created_at <= $${params.length}`; }
    sql += ' ORDER BY created_at DESC';
    const r = await pool.query(sql, params);
    return res.json({ result: { ok: true, items: r.rows } });
  } catch (err) { console.error('quoteList hiba:', err); return res.json({ result: { ok: false, err: 'Eroare de server' } }); }
};

// ─── Létrehozás / módosítás — Admin/Manager ──────────────────
// args: [{ id?, client_id?, client_name?, loc_from?, loc_to?, price?, valuta?, valid_until?, note? }]
handlers.quoteSave = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = req.session.user.company_id;
    const a = (args && args[0]) || {};
    const client_id = a.client_id ? parseInt(a.client_id, 10) || null : null;
    const client_name = _str(a.client_name, 200);
    const loc_from = _str(a.loc_from, 200);
    const loc_to = _str(a.loc_to, 200);
    const price = _num(a.price);
    const valuta = _str(a.valuta, 8) || 'EUR';
    const valid_until = a.valid_until ? String(a.valid_until).slice(0, 10) : null;
    const note = _str(a.note, 1000);
    if (!client_name && !client_id) return res.json({ result: { ok: false, err: 'Clientul este obligatoriu.' } });

    if (a.id) {
      const id = parseInt(a.id, 10);
      if (!id) return res.json({ result: { ok: false, err: 'ID invalid.' } });
      // Tulajdonjog-ellenőrzés: az ajánlat a céghez tartozik-e (nincs cross-tenant write)
      const own = await pool.query('SELECT id FROM quotes WHERE id=$1 AND company_id=$2', [id, cid]);
      if (!own.rows.length) return res.json({ result: { ok: false, err: 'Nu a fost găsit.' } });
      await pool.query(
        `UPDATE quotes SET client_id=$1, client_name=$2, loc_from=$3, loc_to=$4,
                price=$5, valuta=$6, valid_until=$7, note=$8
         WHERE id=$9 AND company_id=$10`,
        [client_id, client_name, loc_from, loc_to, price, valuta, valid_until, note, id, cid]);
      audit.fromReq(req, 'quote.update', 'quote', id, { client_name });
      return res.json({ result: { ok: true, id } });
    }

    const ins = await pool.query(
      `INSERT INTO quotes (company_id, client_id, client_name, loc_from, loc_to,
              price, valuta, status, valid_until, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',$8,$9,$10) RETURNING id`,
      [cid, client_id, client_name, loc_from, loc_to, price, valuta, valid_until, note,
       (req.session.user.email || req.session.user.nume || null)]);
    audit.fromReq(req, 'quote.create', 'quote', ins.rows[0].id, { client_name });
    return res.json({ result: { ok: true, id: ins.rows[0].id } });
  } catch (err) { console.error('quoteSave hiba:', err); return res.json({ result: { ok: false, err: 'Eroare de server' } }); }
};

// ─── Státusz-váltás — Admin/Manager ──────────────────────────
// args: [{ id, status }]
handlers.quoteSetStatus = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = req.session.user.company_id;
    const a = (args && args[0]) || {};
    const id = parseInt(a.id, 10);
    if (!id) return res.json({ result: { ok: false, err: 'ID invalid.' } });
    if (!STATUSES.includes(a.status)) return res.json({ result: { ok: false, err: 'Status invalid.' } });
    const r = await pool.query(
      'UPDATE quotes SET status=$1 WHERE id=$2 AND company_id=$3', [a.status, id, cid]);
    if (!r.rowCount) return res.json({ result: { ok: false, err: 'Nu a fost găsit.' } });
    audit.fromReq(req, 'quote.set_status', 'quote', id, { status: a.status });
    return res.json({ result: { ok: true } });
  } catch (err) { console.error('quoteSetStatus hiba:', err); return res.json({ result: { ok: false, err: 'Eroare de server' } }); }
};

// ─── Konverzió fuvarrá — Admin/Manager ───────────────────────
// args: [{ id }] vagy [id]
// A MEGLÉVŐ comCreate-et hívja (nincs fuvar-logika duplikáció): az ajánlat
// mezőiből épít egy minimal fuvar-objektumot, majd átállítja az ajánlatot.
handlers.quoteToOrder = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = req.session.user.company_id;
    const a = (args && args[0]) || {};
    const id = parseInt(typeof a === 'object' ? a.id : a, 10);
    if (!id) return res.json({ result: { ok: false, err: 'ID invalid.' } });

    // Tulajdonjog-ellenőrzés + ne konvertáljunk kétszer
    const q = await pool.query(
      `SELECT id, client_id, client_name, loc_from, loc_to, price, valuta, order_id
       FROM quotes WHERE id=$1 AND company_id=$2`, [id, cid]);
    if (!q.rows.length) return res.json({ result: { ok: false, err: 'Nu a fost găsit.' } });
    const row = q.rows[0];
    if (row.order_id) return res.json({ result: { ok: false, err: 'Cotația a fost deja convertită.' } });

    // A fuvar-objektum az ajánlat mezőiből — a comCreate validálja és menti.
    const orderObj = {
      client: row.client_name || '',
      client_id: row.client_id || null,
      pret: row.price != null ? Number(row.price) : 0,
      loc_incarcare: row.loc_from || '',
      loc_descarcare: row.loc_to || '',
      load_type: 'FTL', // comCreate kötelezővé teszi a típust ÚJ fuvarnál
    };

    // A comCreate res.json-ba ír — egy stub res-szel elkapjuk a válaszát.
    let captured = null;
    const stubRes = { json: function (payload) { captured = payload; return payload; } };
    await orderHandlers.comCreate(req, stubRes, [orderObj]);
    const result = (captured && captured.result) || {};
    if (!result.ok || !result.id) {
      return res.json({ result: { ok: false, err: result.err || 'Eroare la crearea comenzii.' } });
    }
    const newOrderId = result.id;

    // Az ajánlat lezárása: elnyert + a fuvar-azonosító mentése (tenant-szűrt)
    await pool.query(
      `UPDATE quotes SET status='awarded', order_id=$1 WHERE id=$2 AND company_id=$3`,
      [String(newOrderId), id, cid]);
    audit.fromReq(req, 'quote.to_order', 'quote', id, { order_id: newOrderId });
    return res.json({ result: { ok: true, order_id: newOrderId } });
  } catch (err) { console.error('quoteToOrder hiba:', err); return res.json({ result: { ok: false, err: 'Eroare de server' } }); }
};

module.exports = handlers;
