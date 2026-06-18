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
const audit = require('../lib/audit');

const handlers = {};
const APP_URL = require('../lib/appUrl').appBaseUrl('http://localhost:3000');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function _am(req) { return req.session.user && ['Admin', 'Manager'].includes(req.session.user.pozicio); }
function _num(x) { return (x === '' || x == null) ? null : Number(x); }
function _str(x, n) { const s = x == null ? null : String(x).trim().slice(0, n || 255); return s || null; }

// ─── Alvállalkozó-törzs ──────────────────────────────────────
handlers.carrierList = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = req.session.user.company_id;
    const r = await pool.query(
      `SELECT c.*,
              COALESCE((SELECT SUM(ci.amount - ci.paid_amount) FROM carrier_invoices ci
                        WHERE ci.carrier_id = c.id AND ci.status <> 'paid'), 0)::numeric AS open_balance,
              (SELECT COUNT(*) FROM carrier_users cu WHERE cu.carrier_id = c.id AND cu.activ)::int AS portal_users,
              (SELECT g.name FROM carrier_groups g WHERE g.id = c.group_id AND g.company_id = c.company_id) AS group_name
       FROM carriers c WHERE c.company_id = $1 ORDER BY c.aktiv DESC, c.nev`, [cid]);
    return res.json({ result: { ok: true, items: r.rows } });
  } catch (err) { console.error('carrierList hiba:', err); return res.json({ result: { ok: false, err: 'Eroare de server' } }); }
};

handlers.carrierSave = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = req.session.user.company_id;
    const a = (args && args[0]) || {};
    const nev = _str(a.nev, 255);
    if (!nev) return res.json({ result: { ok: false, err: 'Numele firmei este obligatoriu.' } });
    // Csoport: csak akkor állítjuk, ha a kérés explicit küldi (undefined → érintetlen).
    // A csoportnak a hívó cégéhez kell tartoznia (cross-tenant védelem).
    let groupId; // undefined = ne nyúljunk hozzá
    if (a.group_id !== undefined) {
      groupId = (a.group_id === '' || a.group_id == null) ? null : parseInt(a.group_id, 10);
      if (groupId != null) {
        const g = await pool.query('SELECT id FROM carrier_groups WHERE id=$1 AND company_id=$2', [groupId, cid]);
        if (!g.rows.length) return res.json({ result: { ok: false, err: 'Grupul nu a fost găsit.' } });
      }
    }
    const f = {
      nev, cui: _str(a.cui, 40), email: _str(a.email, 255), telefon: _str(a.telefon, 50),
      iban: _str(a.iban, 40), nota: _str(a.nota, 1000),
      payment_term_days: a.payment_term_days != null && a.payment_term_days !== '' ? parseInt(a.payment_term_days, 10) : 30,
      cmr_insurance_expiry: a.cmr_insurance_expiry || null,
      aktiv: a.aktiv === undefined ? true : !!a.aktiv,
    };
    if (a.id) {
      const id = parseInt(a.id, 10);
      let r;
      if (groupId !== undefined) {
        r = await pool.query(
          `UPDATE carriers SET nev=$1, cui=$2, email=$3, telefon=$4, iban=$5, nota=$6,
             payment_term_days=$7, cmr_insurance_expiry=$8, aktiv=$9, group_id=$10
           WHERE id=$11 AND company_id=$12`,
          [f.nev, f.cui, f.email, f.telefon, f.iban, f.nota, f.payment_term_days, f.cmr_insurance_expiry, f.aktiv, groupId, id, cid]);
      } else {
        r = await pool.query(
          `UPDATE carriers SET nev=$1, cui=$2, email=$3, telefon=$4, iban=$5, nota=$6,
             payment_term_days=$7, cmr_insurance_expiry=$8, aktiv=$9
           WHERE id=$10 AND company_id=$11`,
          [f.nev, f.cui, f.email, f.telefon, f.iban, f.nota, f.payment_term_days, f.cmr_insurance_expiry, f.aktiv, id, cid]);
      }
      if (!r.rowCount) return res.json({ result: { ok: false, err: 'Nu a fost găsit.' } });
      audit.fromReq(req, 'carrier.update', 'carrier', id, { nev: f.nev });
      return res.json({ result: { ok: true, id } });
    }
    const ins = await pool.query(
      `INSERT INTO carriers (company_id, nev, cui, email, telefon, iban, nota, payment_term_days, cmr_insurance_expiry, aktiv, group_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [cid, f.nev, f.cui, f.email, f.telefon, f.iban, f.nota, f.payment_term_days, f.cmr_insurance_expiry, f.aktiv, groupId === undefined ? null : groupId]);
    audit.fromReq(req, 'carrier.create', 'carrier', ins.rows[0].id, { nev: f.nev });
    return res.json({ result: { ok: true, id: ins.rows[0].id } });
  } catch (err) { console.error('carrierSave hiba:', err); return res.json({ result: { ok: false, err: 'Eroare de server' } }); }
};

handlers.carrierDelete = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = req.session.user.company_id;
    const id = parseInt(args && args[0], 10);
    if (!id) return res.json({ result: { ok: false, err: 'ID-ul este obligatoriu.' } });
    const inv = await pool.query('SELECT 1 FROM carrier_invoices WHERE carrier_id=$1 AND company_id=$2 LIMIT 1', [id, cid]);
    if (inv.rows.length) return res.json({ result: { ok: false, err: 'Are factură de furnizor asociată — mai bine dezactivează-l mai întâi.' } });
    await pool.query('DELETE FROM carrier_users WHERE carrier_id=$1 AND company_id=$2', [id, cid]);
    await pool.query('DELETE FROM carrier_vehicles WHERE carrier_id=$1 AND company_id=$2', [id, cid]);
    const r = await pool.query('DELETE FROM carriers WHERE id=$1 AND company_id=$2', [id, cid]);
    if (r.rowCount) audit.fromReq(req, 'carrier.delete', 'carrier', id, null);
    return res.json({ result: { ok: !!r.rowCount } });
  } catch (err) { console.error('carrierDelete hiba:', err); return res.json({ result: { ok: false, err: 'Eroare de server' } }); }
};

// Az alvállalkozó által felvitt jármű(vek) — a diszpécser is látja
handlers.carrierVehicleList = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = req.session.user.company_id;
    const carrierId = parseInt(args && args[0], 10) || null;
    const params = [cid]; let where = 'company_id=$1';
    if (carrierId) { params.push(carrierId); where += ' AND carrier_id=$2'; }
    const r = await pool.query(`SELECT * FROM carrier_vehicles WHERE ${where} ORDER BY created_at DESC`, params);
    return res.json({ result: { ok: true, items: r.rows } });
  } catch (err) { console.error('carrierVehicleList hiba:', err); return res.json({ result: { ok: false, err: 'Eroare de server' } }); }
};

// ─── Szállítói számlák (AP) ──────────────────────────────────
handlers.carrierInvoiceList = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
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
  } catch (err) { console.error('carrierInvoiceList hiba:', err); return res.json({ result: { ok: false, err: 'Eroare de server' } }); }
};

// Extern fuvarok — a számlához köthető fuvarok választójához
handlers.carrierAssignableOrders = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = req.session.user.company_id;
    const carrierId = parseInt(args && args[0], 10) || null;
    const params = [cid];
    let q = `SELECT id, loc_incarcare, loc_descarcare, pret, carrier_cost, carrier_id, firma_extern, data_incarcare
             FROM orders WHERE company_id=$1 AND sofer_type='Extern' AND status<>'Anulat'`;
    if (carrierId) { params.push(carrierId); q += ` AND (carrier_id=$2 OR carrier_id IS NULL)`; }
    q += ` ORDER BY created_at DESC LIMIT 200`;
    const r = await pool.query(q, params);
    return res.json({ result: { ok: true, items: r.rows } });
  } catch (err) { console.error('carrierAssignableOrders hiba:', err); return res.json({ result: { ok: false, err: 'Eroare de server' } }); }
};

handlers.carrierInvoiceSave = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = req.session.user.company_id;
    const a = (args && args[0]) || {};
    const carrierId = parseInt(a.carrier_id, 10);
    if (!carrierId) return res.json({ result: { ok: false, err: 'Selectează un subcontractant.' } });
    const cc = await pool.query('SELECT id FROM carriers WHERE id=$1 AND company_id=$2', [carrierId, cid]);
    if (!cc.rows.length) return res.json({ result: { ok: false, err: 'Subcontractantul nu a fost găsit.' } });
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
  } catch (err) { console.error('carrierInvoiceSave hiba:', err); return res.json({ result: { ok: false, err: 'Eroare de server' } }); }
};

// args: [invoiceId, amount|'full']
handlers.carrierInvoicePayment = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = req.session.user.company_id;
    const id = parseInt(args && args[0], 10);
    if (!id) return res.json({ result: { ok: false, err: 'ID-ul este obligatoriu.' } });
    const r = await pool.query('SELECT amount, paid_amount FROM carrier_invoices WHERE id=$1 AND company_id=$2', [id, cid]);
    if (!r.rows.length) return res.json({ result: { ok: false, err: 'Nu a fost găsit.' } });
    const amount = Number(r.rows[0].amount) || 0;
    let paid;
    if (args[1] === 'full') paid = amount;
    else paid = Math.max(0, Math.min(amount, (Number(r.rows[0].paid_amount) || 0) + (Number(args[1]) || 0)));
    const status = paid >= amount && amount > 0 ? 'paid' : (paid > 0 ? 'partial' : 'unpaid');
    await pool.query('UPDATE carrier_invoices SET paid_amount=$1, status=$2, paid_at=CASE WHEN $2=$3 THEN NOW() ELSE paid_at END WHERE id=$4 AND company_id=$5',
      [paid, status, 'paid', id, cid]);
    return res.json({ result: { ok: true, status, paid_amount: paid } });
  } catch (err) { console.error('carrierInvoicePayment hiba:', err); return res.json({ result: { ok: false, err: 'Eroare de server' } }); }
};

handlers.carrierInvoiceDelete = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = req.session.user.company_id;
    const id = parseInt(args && args[0], 10);
    const r = await pool.query('DELETE FROM carrier_invoices WHERE id=$1 AND company_id=$2', [id, cid]);
    return res.json({ result: { ok: !!r.rowCount } });
  } catch (err) { console.error('carrierInvoiceDelete hiba:', err); return res.json({ result: { ok: false, err: 'Eroare de server' } }); }
};

// ─── Alvállalkozói portál-hozzáférések ───────────────────────
handlers.carrierPortalList = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
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
  } catch (err) { console.error('carrierPortalList hiba:', err); return res.json({ result: { ok: false, err: 'Eroare de server' } }); }
};

handlers.carrierPortalInvite = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = req.session.user.company_id;
    const a = (args && args[0]) || {};
    const carrierId = parseInt(a.carrier_id, 10);
    const email = String(a.email || '').trim().toLowerCase();
    const nev = _str(a.nev, 120);
    if (!carrierId) return res.json({ result: { ok: false, err: 'Selectează un subcontractant.' } });
    if (!EMAIL_RE.test(email)) return res.json({ result: { ok: false, err: 'E-mail invalid.' } });
    const cc = await pool.query('SELECT id FROM carriers WHERE id=$1 AND company_id=$2', [carrierId, cid]);
    if (!cc.rows.length) return res.json({ result: { ok: false, err: 'Subcontractantul nu a fost găsit.' } });
    const ex = await pool.query('SELECT id, company_id FROM carrier_users WHERE LOWER(email)=$1', [email]);
    if (ex.rows.length && ex.rows[0].company_id !== cid) {
      return res.json({ result: { ok: false, err: 'Acest e-mail este deja înregistrat la alt transportator.' } });
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
    if (sendResetEmail) { try { await sendResetEmail(email, nev || email, link, await emailLang(cid), cid); emailed = true; } catch (_) { emailed = false; } }
    return res.json({ result: { ok: true, link, emailed } });
  } catch (err) { console.error('carrierPortalInvite hiba:', err); return res.json({ result: { ok: false, err: 'Eroare de server' } }); }
};

handlers.carrierPortalSetActive = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = req.session.user.company_id;
    const id = parseInt(args && args[0], 10);
    const activ = !!(args && args[1]);
    if (!id) return res.json({ result: { ok: false, err: 'ID-ul este obligatoriu.' } });
    const r = await pool.query('UPDATE carrier_users SET activ=$1 WHERE id=$2 AND company_id=$3', [activ, id, cid]);
    return res.json({ result: { ok: !!r.rowCount } });
  } catch (err) { console.error('carrierPortalSetActive hiba:', err); return res.json({ result: { ok: false, err: 'Eroare de server' } }); }
};

// ── Carrier dokumentumok — admin oldalról ──

handlers.carrierGetDocs = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = req.session.user.company_id;
    const carrierId = parseInt(args && args.carrierId, 10);
    if (!carrierId) return res.json({ result: { ok: false, err: 'Lipsă carrierId' } });
    const r = await pool.query(
      `SELECT id, carrier_id, order_id, file_name, mime, kind, uploaded_by, created_at
       FROM carrier_documents
       WHERE company_id=$1 AND carrier_id=$2
       ORDER BY created_at DESC`,
      [cid, carrierId]
    );
    return res.json({ result: { ok: true, docs: r.rows } });
  } catch (err) { console.error('carrierGetDocs hiba:', err); return res.json({ result: { ok: false, err: 'Eroare de server' } }); }
};

handlers.carrierDocDownload = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = req.session.user.company_id;
    const docId = parseInt(args && args.docId, 10);
    if (!docId) return res.json({ result: { ok: false, err: 'Lipsă docId' } });
    const r = await pool.query(
      `SELECT file_name, mime, data_base64 FROM carrier_documents WHERE id=$1 AND company_id=$2`,
      [docId, cid]
    );
    if (!r.rows.length) return res.json({ result: { ok: false, err: 'Nu s-a găsit' } });
    return res.json({ result: { ok: true, ...r.rows[0] } });
  } catch (err) { console.error('carrierDocDownload hiba:', err); return res.json({ result: { ok: false, err: 'Eroare de server' } }); }
};

handlers.carrierDocUploadAdmin = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = req.session.user.company_id;
    const a = args || {};
    const { carrierId, orderId, fileName, mime, data_base64, kind } = a;
    if (!carrierId || !data_base64) return res.json({ result: { ok: false, err: 'Lipsă date' } });
    // Ownership ellenőrzés — csak a saját cég alvállalkozójához
    const ck = await pool.query('SELECT id FROM carriers WHERE id=$1 AND company_id=$2', [carrierId, cid]);
    if (!ck.rows.length) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    // Méretkorlát ~10MB
    if (data_base64.length > 14 * 1024 * 1024) return res.json({ result: { ok: false, err: 'Fișier prea mare (max 10MB)' } });
    const allowedKinds = ['cmr', 'invoice', 'insurance', 'contract', 'other'];
    const docKind = allowedKinds.includes(kind) ? kind : 'invoice';
    const r = await pool.query(
      `INSERT INTO carrier_documents (company_id, carrier_id, order_id, file_name, mime, data_base64, kind, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [cid, parseInt(carrierId, 10), orderId || null,
       String(fileName || 'factura').slice(0, 200),
       String(mime || 'application/pdf').slice(0, 100),
       data_base64, docKind, req.session.user.email]
    );
    return res.json({ result: { ok: true, id: r.rows[0].id } });
  } catch (err) { console.error('carrierDocUploadAdmin hiba:', err); return res.json({ result: { ok: false, err: 'Eroare de server' } }); }
};

// ─── Alvállalkozó-csoportok ──────────────────────────────────
handlers.carrierGroupList = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = req.session.user.company_id;
    const r = await pool.query(
      `SELECT g.id, g.name, g.created_at,
              (SELECT COUNT(*) FROM carriers c WHERE c.group_id = g.id AND c.company_id = g.company_id)::int AS carrier_count
       FROM carrier_groups g WHERE g.company_id = $1 ORDER BY g.name`, [cid]);
    return res.json({ result: { ok: true, items: r.rows } });
  } catch (err) { console.error('carrierGroupList hiba:', err); return res.json({ result: { ok: false, err: 'Eroare de server' } }); }
};

// args: [{ id?, name }] — id megadásánál átnevezés (csak a saját cég csoportja)
handlers.carrierGroupSave = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = req.session.user.company_id;
    const a = (args && args[0]) || {};
    const name = _str(a.name, 120);
    if (!name) return res.json({ result: { ok: false, err: 'Numele grupului este obligatoriu.' } });
    if (a.id) {
      const id = parseInt(a.id, 10);
      const r = await pool.query('UPDATE carrier_groups SET name=$1 WHERE id=$2 AND company_id=$3', [name, id, cid]);
      if (!r.rowCount) return res.json({ result: { ok: false, err: 'Nu a fost găsit.' } });
      audit.fromReq(req, 'carrier_group.update', 'carrier_group', id, { name });
      return res.json({ result: { ok: true, id } });
    }
    const ins = await pool.query('INSERT INTO carrier_groups (company_id, name) VALUES ($1,$2) RETURNING id', [cid, name]);
    audit.fromReq(req, 'carrier_group.create', 'carrier_group', ins.rows[0].id, { name });
    return res.json({ result: { ok: true, id: ins.rows[0].id } });
  } catch (err) { console.error('carrierGroupSave hiba:', err); return res.json({ result: { ok: false, err: 'Eroare de server' } }); }
};

// args: [groupId] — csak a saját cég csoportját törli; a hivatkozó alvállalkozók group_id=NULL lesz
handlers.carrierGroupDelete = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = req.session.user.company_id;
    const id = parseInt(args && args[0], 10);
    if (!id) return res.json({ result: { ok: false, err: 'ID-ul este obligatoriu.' } });
    // Ownership-ellenőrzés a törlés előtt
    const own = await pool.query('SELECT id FROM carrier_groups WHERE id=$1 AND company_id=$2', [id, cid]);
    if (!own.rows.length) return res.json({ result: { ok: false, err: 'Nu a fost găsit.' } });
    // A csoportra hivatkozó alvállalkozókat feloldjuk (csak a saját cégben)
    await pool.query('UPDATE carriers SET group_id=NULL WHERE group_id=$1 AND company_id=$2', [id, cid]);
    const r = await pool.query('DELETE FROM carrier_groups WHERE id=$1 AND company_id=$2', [id, cid]);
    audit.fromReq(req, 'carrier_group.delete', 'carrier_group', id, null);
    return res.json({ result: { ok: !!r.rowCount } });
  } catch (err) { console.error('carrierGroupDelete hiba:', err); return res.json({ result: { ok: false, err: 'Eroare de server' } }); }
};

// args: [carrierId, groupId|null] — egy alvállalkozó csoportjának beállítása
handlers.carrierSetGroup = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = req.session.user.company_id;
    const carrierId = parseInt(args && args[0], 10);
    if (!carrierId) return res.json({ result: { ok: false, err: 'ID-ul este obligatoriu.' } });
    let groupId = (args[1] === '' || args[1] == null) ? null : parseInt(args[1], 10);
    // Ownership: az alvállalkozó a hívó cégéhez tartozik?
    const cc = await pool.query('SELECT id FROM carriers WHERE id=$1 AND company_id=$2', [carrierId, cid]);
    if (!cc.rows.length) return res.json({ result: { ok: false, err: 'Subcontractantul nu a fost găsit.' } });
    // A csoport (ha van) szintén a hívó cégéhez tartozik?
    if (groupId != null) {
      const g = await pool.query('SELECT id FROM carrier_groups WHERE id=$1 AND company_id=$2', [groupId, cid]);
      if (!g.rows.length) return res.json({ result: { ok: false, err: 'Grupul nu a fost găsit.' } });
    }
    const r = await pool.query('UPDATE carriers SET group_id=$1 WHERE id=$2 AND company_id=$3', [groupId, carrierId, cid]);
    audit.fromReq(req, 'carrier.set_group', 'carrier', carrierId, { group_id: groupId });
    return res.json({ result: { ok: !!r.rowCount } });
  } catch (err) { console.error('carrierSetGroup hiba:', err); return res.json({ result: { ok: false, err: 'Eroare de server' } }); }
};

module.exports = handlers;
