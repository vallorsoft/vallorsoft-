// handlers/orderPostDelivery.js — fuvar dokumentum-nyomkövetés (post-delivery).
// Számlaszám, posta cím, posta elküldve/átvéve, fizetés (kézi + számla-provider
// lekérés). A meglévő `orders.payment_status`/`paid_amount` mezőket NEM érinti —
// külön `payment_status_ext` mezőben él, hogy a kézi „fizetve" jelzés / provider-
// lekérés (FGO getStatus, stb.) ne ütközzön az invoice-flow-val.
//
// Kapuk: Admin/Manager, `company_id`-szűrt, paraméteres SQL, audit.

const pool = require('../db');
const { decrypt } = require('../lib/crypto');
const billing = require('../services/billing');
const audit = require('../lib/audit');

const handlers = {};
const _am = (u) => u && ['Admin','Manager'].includes(u.pozicio);
const _own = (req) => req.session.user.company_id;
const PS_VALID = ['pending', 'paid', 'delayed'];

function _clip(v, max){ if(v == null) return null; var s = String(v).trim(); if(!s) return null; return s.slice(0, max); }
function _dateOrNull(v){
  if(!v) return null;
  var s = String(v).trim();
  if(!s) return null;
  // Elfogadunk YYYY-MM-DD vagy ISO stringet; a DB DATE-re castol.
  if(!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  return s.slice(0, 10);
}

// setOrderPostDelivery({ order_id, invoice_no?, postal_address?, postal_sent_at?,
//   postal_received_at?, payment_status_ext?, payment_received_at?, post_notes? })
// A `undefined` mezőket nem érinti; explicit `null`/`''` → NULL-ra állít.
handlers.setOrderPostDelivery = async function (req, res, args) {
  try {
    if (!_am(req.session.user)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const a = (args && args[0]) || {};
    const orderId = String(a.order_id || '').trim();
    if (!orderId) return res.json({ result: { ok: false, err: 'ID-ul cursei este obligatoriu.' } });
    const cid = _own(req);
    // Cross-tenant védelem: csak a saját cég fuvarját írhatjuk.
    const own = await pool.query(`SELECT id FROM orders WHERE id=$1 AND company_id=$2`, [orderId, cid]);
    if (!own.rows.length) return res.json({ result: { ok: false, err: 'Transportul nu a fost gasit.' } });

    const sets = [];
    const vals = [];
    let i = 1;
    if (a.invoice_no !== undefined)          { sets.push(`invoice_no = $${i++}`);          vals.push(_clip(a.invoice_no, 50)); }
    if (a.postal_address !== undefined)      { sets.push(`postal_address = $${i++}`);      vals.push(_clip(a.postal_address, 500)); }
    if (a.postal_sent_at !== undefined)      { sets.push(`postal_sent_at = $${i++}`);      vals.push(_dateOrNull(a.postal_sent_at)); }
    if (a.postal_received_at !== undefined)  { sets.push(`postal_received_at = $${i++}`);  vals.push(_dateOrNull(a.postal_received_at)); }
    if (a.payment_status_ext !== undefined) {
      const v = _clip(a.payment_status_ext, 20);
      if (v && !PS_VALID.includes(v)) return res.json({ result: { ok: false, err: 'payment_status_ext invalid' } });
      sets.push(`payment_status_ext = $${i++}`); vals.push(v || 'pending');
    }
    if (a.payment_received_at !== undefined) { sets.push(`payment_received_at = $${i++}`); vals.push(_dateOrNull(a.payment_received_at)); }
    if (a.post_notes !== undefined)          { sets.push(`post_notes = $${i++}`);          vals.push(_clip(a.post_notes, 2000)); }
    // Kézi bevitelnél a forrás mindig 'manual', amíg valaki nem fut le FGO-lekérést.
    if (a.payment_status_ext !== undefined) {
      sets.push(`payment_ext_source = $${i++}`); vals.push('manual');
      sets.push(`payment_ext_checked_at = NOW()`);
    }

    if (!sets.length) return res.json({ result: { ok: false, err: 'Nu s-au trimis modificari.' } });

    vals.push(orderId); vals.push(cid);
    await pool.query(
      `UPDATE orders SET ${sets.join(', ')} WHERE id = $${i++} AND company_id = $${i}`,
      vals
    );
    // Audit — a mező-változásokat naplózzuk, de a POST-DELIVERY általában nem PII.
    try {
      audit.fromReq(req, 'order.post_delivery.set', 'order', orderId, {
        fields: Object.keys(a).filter(k => k !== 'order_id')
      });
    } catch(_){}

    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('setOrderPostDelivery hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// checkInvoicePaidExternal({ order_id }) — a cég aktív billing-provider-én lekéri
// a fuvarhoz rögzített `invoice_no` fizetési állapotát, és eltárolja a
// `payment_status_ext` mezőt (pending/paid/delayed).
//
// Az `invoice_no` formátuma: 'SERIExxxx' (pl. 'FCT00123'). A serie/numar szétvágás
// a legutolsó ~4 jegy alapján (a legtöbb provider így számol) — a felhasználó
// jelezheti kézzel az `invoice_no`-t bármelyik formában; ha a lekérés hasal,
// visszaadjuk a szerver-üzenetet és a status NEM változik.
handlers.checkInvoicePaidExternal = async function (req, res, args) {
  try {
    if (!_am(req.session.user)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const orderId = String((args && args[0] && args[0].order_id) || '').trim();
    if (!orderId) return res.json({ result: { ok: false, err: 'ID cursa lipsa.' } });
    const cid = _own(req);
    const or = await pool.query(
      `SELECT id, invoice_no, pret FROM orders WHERE id=$1 AND company_id=$2`,
      [orderId, cid]);
    if (!or.rows.length) return res.json({ result: { ok: false, err: 'Cursa nu a fost gasita.' } });
    const invNo = String(or.rows[0].invoice_no || '').trim();
    if (!invNo) return res.json({ result: { ok: false, err: 'Nu exista numar de factura la aceasta cursa.' } });

    // Aktív számlázó (a cég sajátja).
    const br = await pool.query(
      `SELECT provider, credentials FROM billing_integrations WHERE company_id=$1 AND is_active=true LIMIT 1`,
      [cid]);
    if (!br.rows.length) return res.json({ result: { ok: false, err: 'Nu exista un provider de facturare configurat.' } });
    let creds = {};
    try { creds = JSON.parse(decrypt(br.rows[0].credentials.enc)); }
    catch(_) { return res.json({ result: { ok: false, err: 'Datele de facturare nu pot fi citite.' } }); }

    // serie + numar szétvágás: az invoice_no első NEM-számjegy előtt = serie,
    // utána = numar. Ha csak számjegyeket tartalmaz → serie='', numar=teljes.
    var serie = '', numar = invNo;
    var m = invNo.match(/^([A-Za-z]+)(\d+)$/);
    if (m) { serie = m[1]; numar = m[2]; }

    const adapter = billing.getAdapter(br.rows[0].provider, creds);
    if (!adapter || typeof adapter.getInvoice !== 'function') {
      return res.json({ result: { ok: false, err: 'Provider-ul nu suporta interogarea statusului.' } });
    }
    const r = await adapter.getInvoice(serie, numar);
    if (!r.ok) return res.json({ result: { ok: false, err: r.message || 'Provider a returnat eroare.' } });

    // Fizetés-értékek — a providerenkénti nyers mezőnevek eltérnek (csak FGO
    // adapter dokumentált `value`/`paid` néven; a többi RAW API-választ ad
    // vissza, amiben más lehet a kulcsnév). Több lehetséges kulcsnevet
    // próbálunk sorban; ha EGYIKET sem találjuk, NEM írjuk felül a státuszt
    // hamis „pending"-re — inkább hibát adunk, hogy a felhasználó tudja: a
    // provider válaszát nem tudtuk értelmezni (a nyers válasz `raw`-ban van,
    // fejlesztői diagnosztikához).
    const inv = r.invoice || {};
    const _num = (obj, keys) => {
      for (const k of keys) { if (obj[k] != null && obj[k] !== '') { const n = Number(obj[k]); if (isFinite(n)) return n; } }
      return null;
    };
    const value = _num(inv, ['value', 'total', 'totalAmount', 'amount', 'valoare']);
    const paid  = _num(inv, ['paid', 'paid_amount', 'paidValue', 'amountPaid', 'valoareAchitata']);
    if (value == null || paid == null) {
      return res.json({ result: { ok: false, err: 'Nu s-a putut interpreta răspunsul providerului (' + br.rows[0].provider + ') — structura necunoscută.' } });
    }
    var newStatus = 'pending';
    if (value > 0 && paid >= value) newStatus = 'paid';
    else if (paid > 0 && paid < value) newStatus = 'delayed';
    // A `payment_received_at` csak a kézi jelzés része — a provider nem ad megbízható dátumot.

    await pool.query(
      `UPDATE orders SET payment_status_ext=$1, payment_ext_source='fgo', payment_ext_checked_at=NOW()
        WHERE id=$2 AND company_id=$3`,
      [newStatus, orderId, cid]);

    try { audit.fromReq(req, 'order.post_delivery.check', 'order', orderId, { status: newStatus, provider: br.rows[0].provider }); } catch(_){}

    return res.json({ result: { ok: true, status: newStatus, value: value, paid: paid, provider: br.rows[0].provider } });
  } catch (err) {
    console.error('checkInvoicePaidExternal hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// ─── Tömeges dokumentum-nyomkövetés ─────────────────────────────────────
// setOrderPostDeliveryBulk({ order_ids:[...], finalize?, invoice_no?,
//   postal_sent_at?, postal_received_at?, payment_status_ext?,
//   payment_received_at?, post_notes?, sync_finance? })
// Pl. „a szeptemberi összes fuvart kiszámláztuk, postáztuk, beszedtük".
// Csak a megadott (nem `undefined`) mezőket írja, mind a kijelölt fuvarokra.
// `finalize` → Alocat/In Curs/Extern fuvar Finalizat-ra (a trigger tölti a
// finalized_at-et). `sync_finance` + paid → a Pénzügy kintlévőség is rendeződik
// (orders.payment_status/paid_amount — csak Finalizat, áras fuvarnál).
const BULK_MAX = 500;
handlers.setOrderPostDeliveryBulk = async function (req, res, args) {
  try {
    if (!_am(req.session.user)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const a = (args && args[0]) || {};
    const ids = [...new Set((Array.isArray(a.order_ids) ? a.order_ids : [])
      .map((x) => String(x || '').trim()).filter((x) => /^[A-Za-z0-9_-]{1,60}$/.test(x)))];
    if (!ids.length) return res.json({ result: { ok: false, err: 'Nu ați selectat nicio cursă.' } });
    if (ids.length > BULK_MAX) return res.json({ result: { ok: false, err: 'Maximum ' + BULK_MAX + ' curse odată.' } });
    const cid = _own(req);

    const sets = [];
    const vals = [];
    let i = 1;
    if (a.invoice_no !== undefined)          { sets.push(`invoice_no = $${i++}`);          vals.push(_clip(a.invoice_no, 50)); }
    if (a.postal_sent_at !== undefined)      { sets.push(`postal_sent_at = $${i++}`);      vals.push(_dateOrNull(a.postal_sent_at)); }
    if (a.postal_received_at !== undefined)  { sets.push(`postal_received_at = $${i++}`);  vals.push(_dateOrNull(a.postal_received_at)); }
    let paid = false;
    if (a.payment_status_ext !== undefined) {
      const v = _clip(a.payment_status_ext, 20);
      if (!v || !PS_VALID.includes(v)) return res.json({ result: { ok: false, err: 'payment_status_ext invalid' } });
      paid = v === 'paid';
      sets.push(`payment_status_ext = $${i++}`); vals.push(v);
      sets.push(`payment_ext_source = 'manual'`);
      sets.push(`payment_ext_checked_at = NOW()`);
    }
    if (a.payment_received_at !== undefined) { sets.push(`payment_received_at = $${i++}`); vals.push(_dateOrNull(a.payment_received_at)); }
    if (a.post_notes !== undefined)          { sets.push(`post_notes = $${i++}`);          vals.push(_clip(a.post_notes, 2000)); }
    const finalize = a.finalize === true;
    if (!sets.length && !finalize) return res.json({ result: { ok: false, err: 'Nu s-au trimis modificari.' } });

    const client = await pool.connect();
    let updated = 0, finalized = 0, financeSynced = 0;
    try {
      await client.query('BEGIN');
      // Csak a saját cég (nem törölt) fuvarjai — idegen id egyszerűen kimarad.
      const own = await client.query(
        `SELECT id FROM orders WHERE company_id = $1 AND id = ANY($2::text[]) AND status <> 'Anulat'`, [cid, ids]);
      const ownIds = own.rows.map((r) => r.id);
      if (!ownIds.length) { await client.query('ROLLBACK'); return res.json({ result: { ok: false, err: 'Transportul nu a fost gasit.' } }); }
      if (finalize) {
        const f = await client.query(
          `UPDATE orders SET status = 'Finalizat', updated_at = NOW()
            WHERE company_id = $1 AND id = ANY($2::text[]) AND status IN ('Alocat','In Curs','Extern')`, [cid, ownIds]);
        finalized = f.rowCount || 0;
      }
      if (sets.length) {
        const u = await client.query(
          `UPDATE orders SET ${sets.join(', ')} WHERE company_id = $${i} AND id = ANY($${i + 1}::text[])`,
          vals.concat([cid, ownIds]));
        updated = u.rowCount || 0;
      }
      if (paid && a.sync_finance === true) {
        const recv = _dateOrNull(a.payment_received_at);
        const s = await client.query(
          `UPDATE orders SET payment_status = 'paid',
                  paid_amount = GREATEST(COALESCE(pret,0), COALESCE(paid_amount,0)),
                  paid_at = COALESCE(paid_at, $3::date::timestamp, NOW()), updated_at = NOW()
            WHERE company_id = $1 AND id = ANY($2::text[]) AND status = 'Finalizat'
              AND COALESCE(pret,0) > 0 AND COALESCE(payment_status,'unpaid') <> 'paid'`,
          [cid, ownIds, recv]);
        financeSynced = s.rowCount || 0;
      }
      await client.query('COMMIT');
      try {
        audit.fromReq(req, 'order.post_delivery.bulk', 'order', null, {
          count: ownIds.length, finalized, finance_synced: financeSynced,
          fields: Object.keys(a).filter((k) => k !== 'order_ids'),
        });
      } catch (_) {}
      return res.json({ result: { ok: true, count: ownIds.length, updated, finalized, finance_synced: financeSynced,
        skipped: ids.length - ownIds.length } });
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw e;
    } finally { client.release(); }
  } catch (err) {
    console.error('setOrderPostDeliveryBulk hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

module.exports = handlers;
