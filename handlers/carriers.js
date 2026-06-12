// ============================================================
//  VallorSoft — handlers/carriers.js
//  Alvállalkozó-törzs + szállítói számlák (AP) + alvállalkozói portál-
//  hozzáférések kezelése a fuvarozó (admin/manager) oldaláról. RPC.
// ============================================================
const pool = require('../db');
const crypto = require('crypto');

let sendResetEmail = null;
try { ({ sendResetEmail } = require('../services/email')); } catch (_) { /* opcionális */ }
const { emailLang } = require('../lib/companyLang');

const handlers = {};
const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function _am(req) { return req.session.user && ['Admin', 'Manager'].includes(req.session.user.pozicio); }
function _num(x) { return (x === '' || x == null) ? null : Number(x); }
function _str(x, n) { const s = x == null ? null : String(x).trim().slice(0, n || 255); return s || null; }

// ─── Alvállalkozó-törzs ──────────────────────────────────────
handlers.carrierList = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
    const cid = req.session.user.company_id;
    const r = await pool.query(
      `SELECT c.*,
              COALESCE((SELECT SUM(ci.amount - ci.paid_amount) FROM carrier_invoices ci
                        WHERE ci.carrier_id = c.id AND ci.status <> 'paid'), 0)::numeric AS open_balance,
              (SELECT COUNT(*) FROM carrier_users cu WHERE cu.carrier_id = c.id AND cu.activ)::int AS portal_users
       FROM carriers c WHERE c.company_id = $1 ORDER BY c.aktiv DESC, c.nev`, [cid]);
    return res.json({ result: { ok: true, items: r.rows } });
  } catch (err) { console.error('carrierList hiba:', err); return res.json({ result: { ok: false, err: 'Szerver hiba' } }); }
};

handlers.carrierSave = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
    const cid = req.session.user.company_id;
    const a = (args && args[0]) || {};
    const nev = _str(a.nev, 255);
    if (!nev) return res.json({ result: { ok: false, err: 'A cégnév kötelező.' } });
    const f = {
      nev, cui: _str(a.cui, 40), email: _str(a.email, 255), telefon: _str(a.telefon, 50),
      iban: _str(a.iban, 40), nota: _str(a.nota, 1000),
      payment_term_days: a.payment_term_days != null && a.payment_term_days !== '' ? parseInt(a.payment_term_days, 10) : 30,
      cmr_insurance_expiry: a.cmr_insurance_expiry || null,
      aktiv: a.aktiv === undefined ? true : !!a.aktiv,
    };
    if (a.id) {
      const r = await pool.query(
        `UPDATE carriers SET nev=$1, cui=$2, email=$3, telefon=$4, iban=$5, nota=$6,
           payment_term_days=$7, cmr_insurance_expiry=$8, aktiv=$9
         WHERE id=$10 AND company_id=$11`,
        [f.nev, f.cui, f.email, f.telefon, f.iban, f.nota, f.payment_term_days, f.cmr_insurance_expiry, f.aktiv, parseInt(a.id, 10), cid]);
      if (!r.rowCount) return res.json({ result: { ok: false, err: 'Nem található.' } });
      return res.json({ result: { ok: true, id: parseInt(a.id, 10) } });
    }
    const ins = await pool.query(
      `INSERT INTO carriers (company_id, nev, cui, email, telefon, iban, nota, payment_term_days, cmr_insurance_expiry, aktiv)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [cid, f.nev, f.cui, f.email, f.telefon, f.iban, f.nota, f.payment_term_days, f.cmr_insurance_expiry, f.aktiv]);
    return res.json({ result: { ok: true, id: ins.rows[0].id } });
  } catch (err) { console.error('carrierSave hiba:', err); return res.json({ result: { ok: false, err: 'Szerver hiba' } }); }
};

handlers.carrierDelete = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
    const cid = req.session.user.company_id;
    const id = parseInt(args && args[0], 10);
    if (!id) return res.json({ result: { ok: false, err: 'ID kötelező.' } });
    const inv = await pool.query('SELECT 1 FROM carrier_invoices WHERE carrier_id=$1 AND company_id=$2 LIMIT 1', [id, cid]);
    if (inv.rows.length) return res.json({ result: { ok: false, err: 'Van hozzá szállítói számla — előbb inkább tedd inaktívvá.' } });
    await pool.query('DELETE FROM carrier_users WHERE carrier_id=$1 AND company_id=$2', [id, cid]);
    await pool.query('DELETE FROM carrier_vehicles WHERE carrier_id=$1 AND company_id=$2', [id, cid]);
    const r = await pool.query('DELETE FROM carriers WHERE id=$1 AND company_id=$2', [id, cid]);
    return res.json({ result: { ok: !!r.rowCount } });
  } catch (err) { console.error('carrierDelete hiba:', err); return res.json({ result: { ok: false, err: 'Szerver hiba' } }); }
};

// Az alvállalkozó által felvitt jármű(vek) — a diszpécser is látja
handlers.carrierVehicleList = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
    const cid = req.session.user.company_id;
    const carrierId = parseInt(args && args[0], 10) || null;
    const params = [cid]; let where = 'company_id=$1';
    if (carrierId) { params.push(carrierId); where += ' AND carrier_id=$2'; }
    const r = await pool.query(`SELECT * FROM carrier_vehicles WHERE ${where} ORDER BY created_at DESC`, params);
    return res.json({ result: { ok: true, items: r.rows } });
  } catch (err) { console.error('carrierVehicleList hiba:', err); return res.json({ result: { ok: false, err: 'Szerver hiba' } }); }
};

// ─── Szállítói számlák (AP) ──────────────────────────────────
handlers.carrierInvoiceList = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
    const cid = req.session.user.company_id;
    const r = await pool.query(
      `SELECT ci.*, c.nev AS carrier_nev
       FROM carrier_invoices ci JOIN carriers c ON c.id = ci.carrier_id AND c.company_id = ci.company_id
       WHERE ci.company_id = $1 ORDER BY (ci.status<>'paid') DESC, ci.due_date NULLS LAST, ci.created_at DESC
       LIMIT 500`, [cid]);
    const sum = await pool.query(
      `SELECT
         COALESCE(SUM(amount-paid_amount) FILTER (WHERE status<>'paid'),0)::numeric AS open_total,
         COALESCE(SUM(amount-paid_amount) FILTER (WHERE status<>'paid' AND due_date IS NOT NULL AND due_date <= NOW()+INTERVAL '7 days' AND due_date >= NOW()),0)::numeric AS due_soon,
         COALESCE(SUM(amount-paid_amount) FILTER (WHERE status<>'paid' AND due_date IS NOT NULL AND due_date < NOW()),0)::numeric AS overdue,
         COUNT(*) FILTER (WHERE status<>'paid')::int AS open_cnt
       FROM carrier_invoices WHERE company_id=$1`, [cid]);
    return res.json({ result: { ok: true, items: r.rows, summary: sum.rows[0] } });
  } catch (err) { console.error('carrierInvoiceList hiba:', err); return res.json({ result: { ok: false, err: 'Szerver hiba' } }); }
};

// Extern fuvarok — a számlához köthető fuvarok választójához
handlers.carrierAssignableOrders = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
    const cid = req.session.user.company_id;
    const carrierId = parseInt(args && args[0], 10) || null;
    const params = [cid];
    let q = `SELECT id, loc_incarcare, loc_descarcare, pret, carrier_cost, carrier_id, firma_extern, data_incarcare
             FROM orders WHERE company_id=$1 AND sofer_type='Extern' AND status<>'Anulat'`;
    if (carrierId) { params.push(carrierId); q += ` AND (carrier_id=$2 OR carrier_id IS NULL)`; }
    q += ` ORDER BY created_at DESC LIMIT 200`;
    const r = await pool.query(q, params);
    return res.json({ result: { ok: true, items: r.rows } });
  } catch (err) { console.error('carrierAssignableOrders hiba:', err); return res.json({ result: { ok: false, err: 'Szerver hiba' } }); }
};

handlers.carrierInvoiceSave = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
    const cid = req.session.user.company_id;
    const a = (args && args[0]) || {};
    const carrierId = parseInt(a.carrier_id, 10);
    if (!carrierId) return res.json({ result: { ok: false, err: 'Válassz alvállalkozót.' } });
    const cc = await pool.query('SELECT id FROM carriers WHERE id=$1 AND company_id=$2', [carrierId, cid]);
    if (!cc.rows.length) return res.json({ result: { ok: false, err: 'Alvállalkozó nem található.' } });
    const orderIds = Array.isArray(a.order_ids) ? a.order_ids.map((x) => String(x)).slice(0, 100) : [];
    const amount = Number(a.amount) || 0;
    const currency = ['EUR', 'RON', 'HUF', 'PLN', 'USD'].includes(a.currency) ? a.currency : 'EUR';
    const ins = await pool.query(
      `INSERT INTO carrier_invoices (company_id, carrier_id, invoice_number, issue_date, due_date, amount, currency, order_ids, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [cid, carrierId, _str(a.invoice_number, 80), a.issue_date || null, a.due_date || null, amount, currency,
       JSON.stringify(orderIds), _str(a.note, 1000)]);
    // a kötött fuvarokra rávezetjük az alvállalkozót (ha még nincs)
    if (orderIds.length) {
      await pool.query(
        `UPDATE orders SET carrier_id = COALESCE(carrier_id, $1) WHERE company_id=$2 AND id = ANY($3::text[])`,
        [carrierId, cid, orderIds]).catch(() => {});
    }
    return res.json({ result: { ok: true, id: ins.rows[0].id } });
  } catch (err) { console.error('carrierInvoiceSave hiba:', err); return res.json({ result: { ok: false, err: 'Szerver hiba' } }); }
};

// args: [invoiceId, amount|'full']
handlers.carrierInvoicePayment = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
    const cid = req.session.user.company_id;
    const id = parseInt(args && args[0], 10);
    if (!id) return res.json({ result: { ok: false, err: 'ID kötelező.' } });
    const r = await pool.query('SELECT amount, paid_amount FROM carrier_invoices WHERE id=$1 AND company_id=$2', [id, cid]);
    if (!r.rows.length) return res.json({ result: { ok: false, err: 'Nem található.' } });
    const amount = Number(r.rows[0].amount) || 0;
    let paid;
    if (args[1] === 'full') paid = amount;
    else paid = Math.max(0, Math.min(amount, (Number(r.rows[0].paid_amount) || 0) + (Number(args[1]) || 0)));
    const status = paid >= amount && amount > 0 ? 'paid' : (paid > 0 ? 'partial' : 'unpaid');
    await pool.query('UPDATE carrier_invoices SET paid_amount=$1, status=$2, paid_at=CASE WHEN $2=$3 THEN NOW() ELSE paid_at END WHERE id=$4 AND company_id=$5',
      [paid, status, 'paid', id, cid]);
    return res.json({ result: { ok: true, status, paid_amount: paid } });
  } catch (err) { console.error('carrierInvoicePayment hiba:', err); return res.json({ result: { ok: false, err: 'Szerver hiba' } }); }
};

handlers.carrierInvoiceDelete = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
    const cid = req.session.user.company_id;
    const id = parseInt(args && args[0], 10);
    const r = await pool.query('DELETE FROM carrier_invoices WHERE id=$1 AND company_id=$2', [id, cid]);
    return res.json({ result: { ok: !!r.rowCount } });
  } catch (err) { console.error('carrierInvoiceDelete hiba:', err); return res.json({ result: { ok: false, err: 'Szerver hiba' } }); }
};

// ─── Alvállalkozói portál-hozzáférések ───────────────────────
handlers.carrierPortalList = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
    const cid = req.session.user.company_id;
    const carrierId = parseInt(args && args[0], 10) || null;
    const params = [cid]; let where = 'cu.company_id=$1';
    if (carrierId) { params.push(carrierId); where += ' AND cu.carrier_id=$2'; }
    const r = await pool.query(
      `SELECT cu.id, cu.email, cu.nev, cu.activ, cu.last_login, cu.carrier_id,
              (cu.pass_hash IS NOT NULL) AS has_password, (cu.invite_token IS NOT NULL) AS pending_invite,
              c.nev AS carrier_nev
       FROM carrier_users cu JOIN carriers c ON c.id=cu.carrier_id AND c.company_id=cu.company_id
       WHERE ${where} ORDER BY cu.created_at DESC`, params);
    return res.json({ result: { ok: true, items: r.rows } });
  } catch (err) { console.error('carrierPortalList hiba:', err); return res.json({ result: { ok: false, err: 'Szerver hiba' } }); }
};

handlers.carrierPortalInvite = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
    const cid = req.session.user.company_id;
    const a = (args && args[0]) || {};
    const carrierId = parseInt(a.carrier_id, 10);
    const email = String(a.email || '').trim().toLowerCase();
    const nev = _str(a.nev, 120);
    if (!carrierId) return res.json({ result: { ok: false, err: 'Válassz alvállalkozót.' } });
    if (!EMAIL_RE.test(email)) return res.json({ result: { ok: false, err: 'Érvénytelen e-mail.' } });
    const cc = await pool.query('SELECT id FROM carriers WHERE id=$1 AND company_id=$2', [carrierId, cid]);
    if (!cc.rows.length) return res.json({ result: { ok: false, err: 'Alvállalkozó nem található.' } });
    const ex = await pool.query('SELECT id, company_id FROM carrier_users WHERE LOWER(email)=$1', [email]);
    if (ex.rows.length && ex.rows[0].company_id !== cid) {
      return res.json({ result: { ok: false, err: 'Ez az e-mail már egy másik fuvarozónál van regisztrálva.' } });
    }
    const token = crypto.randomBytes(24).toString('hex');
    const expires = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    if (ex.rows.length) {
      await pool.query(`UPDATE carrier_users SET carrier_id=$1, nev=COALESCE($2,nev), invite_token=$3, invite_expires=$4, activ=TRUE WHERE id=$5`,
        [carrierId, nev, token, expires, ex.rows[0].id]);
    } else {
      await pool.query(`INSERT INTO carrier_users (company_id, carrier_id, email, nev, invite_token, invite_expires) VALUES ($1,$2,$3,$4,$5,$6)`,
        [cid, carrierId, email, nev, token, expires]);
    }
    const link = APP_URL + '/carrier?token=' + token;
    let emailed = false;
    if (sendResetEmail) { try { await sendResetEmail(email, nev || email, link, await emailLang(cid)); emailed = true; } catch (_) { emailed = false; } }
    return res.json({ result: { ok: true, link, emailed } });
  } catch (err) { console.error('carrierPortalInvite hiba:', err); return res.json({ result: { ok: false, err: 'Szerver hiba' } }); }
};

handlers.carrierPortalSetActive = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
    const cid = req.session.user.company_id;
    const id = parseInt(args && args[0], 10);
    const activ = !!(args && args[1]);
    if (!id) return res.json({ result: { ok: false, err: 'ID kötelező.' } });
    const r = await pool.query('UPDATE carrier_users SET activ=$1 WHERE id=$2 AND company_id=$3', [activ, id, cid]);
    return res.json({ result: { ok: !!r.rowCount } });
  } catch (err) { console.error('carrierPortalSetActive hiba:', err); return res.json({ result: { ok: false, err: 'Szerver hiba' } }); }
};

module.exports = handlers;
