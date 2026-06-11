// ============================================================
//  VallorSoft — handlers/handover.js
//  Áru-leadás (fuvar-megszakítás) + raktár modul.
//
//  Folyamat:
//   - Admin/Manager: orderHandover → azonnal végleges.
//   - Sofőr: driverHandoverRequest → 'Fuggoben' kérés (push az
//     adminoknak), majd confirmHandover / rejectHandover dönt.
//  Leadáskor a fuvar felrakója a leadás helye lesz, a járművek
//  lekerülnek (pótkocsis parkolásnál a pótkocsi marad), a státusz
//  'Parkolt' / 'Raktarban' — így a fuvarlista/tervezőtábla/radar
//  kiosztandóként mutatja. Raktárba adáskor warehouse_items tétel
//  is készül (kötelező méret/darabszám/súly/lapszám adatokkal).
// ============================================================
const pool = require('../db');
const { sendPushToRole, sendPushToEmail } = require('../services/push');

const handlers = {};

const QTY_UNITS = ['paletta', 'doboz', 'egyeb'];

function _posInt(x) {
  const n = parseInt(x, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function _posNum(x) {
  const n = parseFloat(x);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// A leadási adatok validálása. Raktár esetén a méret/darabszám/súly/
// lapszám KÖTELEZŐ; a dokumentum-feltöltés nem blokkol (csak folyamatos
// figyelmeztetés a felületen), de a lapszámot akkor is meg kell adni.
function validateHandover(data) {
  const d = data || {};
  const type = d.type === 'trailer' || d.type === 'warehouse' ? d.type : null;
  if (!type) return { err: 'Add meg, mi történik az áruval (pótkocsin parkol / raktárba kerül).' };
  const location = String(d.location || '').trim();
  if (!location) return { err: 'A leadás helye (helység) kötelező.' };
  const out = {
    type,
    location,
    new_dest: d.new_dest ? String(d.new_dest).trim() : null,
    note: d.note ? String(d.note).trim() : null,
    rendszam_remorca: d.rendszam_remorca ? String(d.rendszam_remorca).trim().toUpperCase() : null,
  };
  if (type === 'warehouse') {
    out.qty = _posInt(d.qty);
    out.qty_unit = QTY_UNITS.includes(d.qty_unit) ? d.qty_unit : null;
    out.length_cm = _posInt(d.length_cm);
    out.width_cm = _posInt(d.width_cm);
    out.height_cm = _posInt(d.height_cm);
    out.weight_kg = _posNum(d.weight_kg);
    out.doc_pages = _posInt(d.doc_pages);
    if (!out.qty || !out.qty_unit) return { err: 'A darabszám és az egység (paletta/doboz/egyéb) kötelező.' };
    if (!out.length_cm || !out.width_cm || !out.height_cm) return { err: 'A foglalt hely méretei (hossz/szélesség/magasság cm) kötelezők.' };
    if (!out.weight_kg) return { err: 'A súly (kg) kötelező.' };
    if (!out.doc_pages) return { err: 'Add meg, hány lapos a kísérő dokumentum (pl. 10).' };
  }
  return { data: out };
}

// A leadás tényleges végrehajtása (tranzakcióban): order-állapot + raktár-tétel.
async function applyHandover(cid, order, d, byEmail) {
  const newStatus = d.type === 'trailer' ? 'Parkolt' : 'Raktarban';
  const dbc = await pool.connect();
  try {
    await dbc.query('BEGIN');
    await dbc.query(
      `UPDATE orders SET
         status = $3,
         loc_incarcare = $4,                                  -- a folytatás felrakója a leadás helye
         loc_descarcare = COALESCE($5, loc_descarcare),       -- végső cél módosulhat
         data_incarcare = NULL,                               -- az új felrakó-dátum a kiosztáskor dől el
         sofer_type = NULL, email_sofer = NULL, nume_sofer = NULL,
         firma_extern = NULL, telefon_extern = NULL, external_driver_id = NULL,
         rendszam_camion = NULL,
         rendszam_remorca = CASE WHEN $6 = 'warehouse' THEN NULL
                                 ELSE COALESCE($7, rendszam_remorca) END,
         handover_type = $6, handover_loc = $4, handover_at = NOW(),
         handover_status = NULL, handover_by = $8, handover_payload = NULL,
         updated_at = NOW()
       WHERE id = $1 AND company_id = $2`,
      [order.id, cid, newStatus, d.location, d.new_dest, d.type, d.rendszam_remorca, byEmail]
    );
    if (d.type === 'warehouse') {
      await dbc.query(
        `INSERT INTO warehouse_items
           (company_id, order_id, location, qty, qty_unit,
            length_cm, width_cm, height_cm, weight_kg, doc_pages, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [cid, order.id, d.location, d.qty, d.qty_unit,
         d.length_cm, d.width_cm, d.height_cm, d.weight_kg, d.doc_pages, d.note]
      );
    }
    await dbc.query('COMMIT');
  } catch (txErr) {
    await dbc.query('ROLLBACK').catch(() => {});
    throw txErr;
  } finally {
    dbc.release();
  }
  return newStatus;
}

// ─── Admin/Manager: azonnali (végleges) leadás ───────────────
// args: [orderId, {type, location, new_dest?, qty, qty_unit, length_cm,
//        width_cm, height_cm, weight_kg, doc_pages, note?, rendszam_remorca?}]
handlers.orderHandover = async function (req, res, args) {
  try {
    if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
      return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
    }
    const cid = req.session.user.company_id;
    const orderId = String(args[0] || '').trim();
    const v = validateHandover(args[1]);
    if (v.err) return res.json({ result: { ok: false, err: v.err } });

    const or = await pool.query(
      `SELECT id, status FROM orders WHERE id = $1 AND company_id = $2`, [orderId, cid]);
    if (!or.rows.length) return res.json({ result: { ok: false, err: 'Fuvar nem található' } });
    if (['Finalizat', 'Anulat'].includes(or.rows[0].status)) {
      return res.json({ result: { ok: false, err: 'Lezárt/törölt fuvar nem adható le.' } });
    }

    const newStatus = await applyHandover(cid, or.rows[0], v.data, req.session.user.email);
    return res.json({ result: { ok: true, status: newStatus } });
  } catch (err) {
    console.error('orderHandover hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
  }
};

// ─── Sofőr: leadás-kérés (visszaigazolásig 'Fuggoben') ───────
// args: [orderId, {type, location, note?, + opcionális raktár-adatok}]
// A sofőr adatai a handover_payload-ba kerülnek; az admin a vissza-
// igazoláskor kiegészítheti/javíthatja.
handlers.driverHandoverRequest = async function (req, res, args) {
  try {
    if (!req.session.user || req.session.user.pozicio !== 'Sofer') {
      return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
    }
    const me = req.session.user;
    const cid = me.company_id;
    const orderId = String(args[0] || '').trim();
    const d = args[1] || {};
    const type = d.type === 'trailer' || d.type === 'warehouse' ? d.type : null;
    const location = String(d.location || '').trim();
    if (!type) return res.json({ result: { ok: false, err: 'Add meg, mi történik az áruval.' } });
    if (!location) return res.json({ result: { ok: false, err: 'A leadás helye (helység) kötelező.' } });

    const r = await pool.query(
      `UPDATE orders SET
         handover_status = 'Fuggoben', handover_type = $3, handover_loc = $4,
         handover_at = NOW(), handover_by = $5, handover_payload = $6, updated_at = NOW()
       WHERE id = $1 AND company_id = $2
         AND LOWER(email_sofer) = LOWER($5)
         AND status IN ('Alocat', 'In Curs')`,
      [orderId, cid, type, location, me.email, JSON.stringify(d)]
    );
    if (!r.rowCount) {
      return res.json({ result: { ok: false, err: 'A fuvar nem található, nem a tiéd, vagy nem aktív.' } });
    }

    // Push az adminoknak/managereknek — hiba esetén sem törjük a kérést
    try {
      await sendPushToRole(cid, ['Admin', 'Manager'], {
        title: '⛔ Áru-leadás visszaigazolásra vár',
        body: (me.nume || me.email) + ' — ' + orderId + ': '
          + (type === 'trailer' ? '🅿️ pótkocsin parkol' : '📦 raktárba került') + ' @ ' + location,
        icon: '/icon192.png', badge: '/icon192.png',
        tag: 'handover-' + orderId, url: '/manager',
      });
    } catch (e) { console.error('handover push hiba:', e); }

    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('driverHandoverRequest hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
  }
};

// ─── Admin/Manager: sofőr-kérés visszaigazolása ──────────────
// args: [orderId, data] — a data felülírja/kiegészíti a sofőr payloadját.
handlers.confirmHandover = async function (req, res, args) {
  try {
    if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
      return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
    }
    const cid = req.session.user.company_id;
    const orderId = String(args[0] || '').trim();

    const or = await pool.query(
      `SELECT id, status, handover_status, handover_payload, handover_by
       FROM orders WHERE id = $1 AND company_id = $2`, [orderId, cid]);
    if (!or.rows.length) return res.json({ result: { ok: false, err: 'Fuvar nem található' } });
    const o = or.rows[0];
    if (o.handover_status !== 'Fuggoben') {
      return res.json({ result: { ok: false, err: 'Nincs függő leadás-kérés ezen a fuvaron.' } });
    }

    // a sofőr payloadja az alap, az admin mezői felülírják
    const payload = typeof o.handover_payload === 'string'
      ? JSON.parse(o.handover_payload || '{}') : (o.handover_payload || {});
    const merged = Object.assign({}, payload, args[1] || {});
    const v = validateHandover(merged);
    if (v.err) return res.json({ result: { ok: false, err: v.err } });

    const newStatus = await applyHandover(cid, o, v.data, o.handover_by || req.session.user.email);

    // visszajelzés a sofőrnek
    try {
      if (o.handover_by) await sendPushToEmail(o.handover_by, {
        title: '✅ Áru-leadás visszaigazolva',
        body: orderId + ' — ' + v.data.location + (v.data.type === 'trailer' ? ' (pótkocsin parkol)' : ' (raktárban)'),
        icon: '/icon192.png', badge: '/icon192.png',
        tag: 'handover-' + orderId, url: '/sofer',
      });
    } catch (e) { console.error('handover confirm push hiba:', e); }

    return res.json({ result: { ok: true, status: newStatus } });
  } catch (err) {
    console.error('confirmHandover hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
  }
};

// ─── Admin/Manager: sofőr-kérés elutasítása ──────────────────
handlers.rejectHandover = async function (req, res, args) {
  try {
    if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
      return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
    }
    const cid = req.session.user.company_id;
    const orderId = String(args[0] || '').trim();
    const r = await pool.query(
      `UPDATE orders SET
         handover_status = NULL, handover_type = NULL, handover_loc = NULL,
         handover_at = NULL, handover_payload = NULL, updated_at = NOW()
       WHERE id = $1 AND company_id = $2 AND handover_status = 'Fuggoben'
       RETURNING handover_by`,
      [orderId, cid]
    );
    if (!r.rowCount) return res.json({ result: { ok: false, err: 'Nincs függő leadás-kérés.' } });
    try {
      const by = r.rows[0].handover_by;
      if (by) await sendPushToEmail(by, {
        title: '❌ Áru-leadás elutasítva',
        body: orderId + ' — egyeztess a diszpécserrel.',
        icon: '/icon192.png', badge: '/icon192.png',
        tag: 'handover-' + orderId, url: '/sofer',
      });
    } catch (e) { console.error('handover reject push hiba:', e); }
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('rejectHandover hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
  }
};

// ─── Függő sofőr-kérések listája (banner a fuvarlistán) ──────
handlers.getPendingHandovers = async function (req, res, args) {
  try {
    if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
      return res.json({ result: [] });
    }
    const r = await pool.query(
      `SELECT id, client, loc_incarcare, loc_descarcare, rendszam_camion, rendszam_remorca,
              nume_sofer, email_sofer, handover_type, handover_loc, handover_at,
              handover_by, handover_payload
       FROM orders
       WHERE company_id = $1 AND handover_status = 'Fuggoben'
       ORDER BY handover_at DESC`,
      [req.session.user.company_id]
    );
    return res.json({ result: r.rows });
  } catch (err) {
    console.error('getPendingHandovers hiba:', err);
    return res.json({ result: [] });
  }
};

// ─── Raktár fül: tétel-lista (dokumentum-számmal) ────────────
handlers.getWarehouseItems = async function (req, res, args) {
  try {
    if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
      return res.json({ result: [] });
    }
    const r = await pool.query(
      `SELECT w.*, o.client, o.loc_descarcare, o.status AS order_status,
              (SELECT COUNT(*)::int FROM documents d WHERE d.order_id = w.order_id) AS doc_count
       FROM warehouse_items w
       JOIN orders o ON o.id = w.order_id AND o.company_id = w.company_id
       WHERE w.company_id = $1
       ORDER BY (w.status = 'Raktarban') DESC, w.created_at DESC
       LIMIT 500`,
      [req.session.user.company_id]
    );
    return res.json({ result: r.rows });
  } catch (err) {
    console.error('getWarehouseItems hiba:', err);
    return res.json({ result: [] });
  }
};

module.exports = handlers;
