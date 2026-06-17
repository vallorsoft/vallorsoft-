// ============================================================
//  VallorSoft — handlers/entityDetail.js
//  Entitás-részletek (jármű / sofőr) drill-in panelhez.
//  CSAK olvasó handlerek — a meglévő (lejárat/szerviz/üzemanyag)
//  adatot szűrik az adott entitásra. Az ADD-műveletek a MÁR LÉTEZŐ,
//  szerep-védett + auditált handlereket hívják (expirySave/serviceCreate).
//  Minden lekérdezés company_id-re szűr + tulajdonjog-ellenőrzés
//  (nincs cross-tenant olvasás), paraméteres SQL.
// ============================================================
const pool = require('../db');

const handlers = {};

function _isAdminOrManager(req) {
  return req.session.user && ['Admin', 'Manager'].includes(req.session.user.pozicio);
}
function _deny(res) {
  return res.json({ result: { ok: false, err: 'Acces interzis' } });
}
function _arg(args) {
  return Array.isArray(args) ? (args[0] || {}) : (args || {});
}

// ════════════════════════════════════════════════════════════
//  JÁRMŰ-RÉSZLETEK
//  Visszaad: a jármű sora + lejáratai (entity_label = rendszám) +
//  szerviz-naplója (vehicle_id) + üzemanyagkártya-tranzakciói (rendszám).
// ════════════════════════════════════════════════════════════
handlers.getVehicleDetail = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const a = _arg(args);
    const cid = req.session.user.company_id;
    const id = parseInt(a.id, 10);
    if (!Number.isFinite(id)) return res.json({ result: { ok: false, err: 'ID invalid.' } });

    // 1) TULAJDONJOG-ELLENŐRZÉS — a jármű a hívó cégéé legyen (nincs cross-tenant olvasás)
    const vr = await pool.query(
      'SELECT * FROM vehicles WHERE id = $1 AND company_id = $2',
      [id, cid]
    );
    if (!vr.rows.length) return res.json({ result: { ok: false, err: 'Vehiculul nu a fost gasit.' } });
    const vehicle = vr.rows[0];
    const plate = vehicle.rendszam || '';

    // 2) Lejáratok — entity_type='vehicle' ÉS a felirat normalizáltan = a rendszám
    //    (a fuel-importtal megegyező normalizálás: nagybetű + csak A-Z0-9),
    //    így a szóköz/kötőjel-eltérés nem okoz hiányt. company_id-szűrt + paraméteres.
    const expR = await pool.query(
      `SELECT id, entity_type, entity_label, doc_type, expiry_date, alert_days, note,
              (expiry_date - CURRENT_DATE)::int AS days_left
       FROM document_expiries
       WHERE company_id = $1 AND entity_type = 'vehicle'
         AND REGEXP_REPLACE(UPPER(COALESCE(entity_label,'')),'[^A-Z0-9]','','g')
             = REGEXP_REPLACE(UPPER($2),'[^A-Z0-9]','','g')
       ORDER BY expiry_date ASC`,
      [cid, plate]
    );

    // 3) Szerviz-napló — vehicle_id szerint, company_id-szűrt
    const svR = await pool.query(
      `SELECT id, vehicle_id, service_date, km, category, description, cost_ron,
              next_due_date, next_due_km
       FROM vehicle_service_log
       WHERE company_id = $1 AND vehicle_id = $2
       ORDER BY service_date DESC, id DESC LIMIT 100`,
      [cid, id]
    );

    // 4) Üzemanyagkártya-tranzakciók — rendszám szerint (normalizált egyezés),
    //    company_id-szűrt, utolsó ~50
    const fuelR = await pool.query(
      `SELECT id, source, rendszam, tx_date, product, qty_l, amount_ron
       FROM fuel_card_transactions
       WHERE company_id = $1
         AND REGEXP_REPLACE(UPPER(COALESCE(rendszam,'')),'[^A-Z0-9]','','g')
             = REGEXP_REPLACE(UPPER($2),'[^A-Z0-9]','','g')
       ORDER BY tx_date DESC, id DESC LIMIT 50`,
      [cid, plate]
    );
    // összesítő a tankoláshoz
    const fuelSumR = await pool.query(
      `SELECT COUNT(*)::int AS db, COALESCE(SUM(qty_l),0)::numeric AS litru,
              COALESCE(SUM(amount_ron),0)::numeric AS suma
       FROM fuel_card_transactions
       WHERE company_id = $1
         AND REGEXP_REPLACE(UPPER(COALESCE(rendszam,'')),'[^A-Z0-9]','','g')
             = REGEXP_REPLACE(UPPER($2),'[^A-Z0-9]','','g')`,
      [cid, plate]
    );

    return res.json({
      result: {
        ok: true,
        vehicle: vehicle,
        expiries: expR.rows,
        service: svR.rows,
        fuel: fuelR.rows,
        fuelTotal: fuelSumR.rows[0],
      },
    });
  } catch (err) {
    console.error('getVehicleDetail hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// ════════════════════════════════════════════════════════════
//  SOFŐR-RÉSZLETEK
//  Visszaad: a sofőr sora + lejáratai (entity_type='driver',
//  entity_label = nume VAGY email) + elszámolás-összesítő (driver_advances).
//  A sofőr-tankolás a fuvarlevelek.alimentari-ból NEM tisztán köthető
//  egy sofőrhöz külön (csak az eltérés-riport aggregálja járművenként) →
//  szándékosan kihagyva (lásd report).
// ════════════════════════════════════════════════════════════
handlers.getDriverDetail = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const a = _arg(args);
    const cid = req.session.user.company_id;
    const email = a.email ? String(a.email).trim().toLowerCase() : null;
    const id = a.id != null ? parseInt(a.id, 10) : null;
    if (!email && !Number.isFinite(id)) return res.json({ result: { ok: false, err: 'Lipsesc datele soferului.' } });

    // 1) TULAJDONJOG-ELLENŐRZÉS — a sofőr a hívó cégéé + Sofer szerep
    let dr;
    if (email) {
      dr = await pool.query(
        `SELECT id, nume, email, tel FROM users
         WHERE company_id = $1 AND pozicio = 'Sofer' AND LOWER(email) = $2`,
        [cid, email]
      );
    } else {
      dr = await pool.query(
        `SELECT id, nume, email, tel FROM users
         WHERE company_id = $1 AND pozicio = 'Sofer' AND id = $2`,
        [cid, id]
      );
    }
    if (!dr.rows.length) return res.json({ result: { ok: false, err: 'Soferul nu a fost gasit.' } });
    const driver = dr.rows[0];

    // 2) Lejáratok — entity_type='driver', a felirat a sofőr neve VAGY e-mailje
    //    (a fleet-extra.js u.nume||u.email-t ment). company_id-szűrt + paraméteres.
    const expR = await pool.query(
      `SELECT id, entity_type, entity_label, doc_type, expiry_date, alert_days, note,
              (expiry_date - CURRENT_DATE)::int AS days_left
       FROM document_expiries
       WHERE company_id = $1 AND entity_type = 'driver'
         AND LOWER(COALESCE(entity_label,'')) IN (LOWER($2), LOWER($3))
       ORDER BY expiry_date ASC`,
      [cid, driver.nume || '', driver.email || '']
    );

    // 3) Elszámolás-összesítő (előlegek) — driver_advances email_sofer szerint,
    //    company_id-szűrt. Best-effort (ha nincs tábla, kihagyjuk).
    let advTotal = null;
    try {
      const advR = await pool.query(
        `SELECT COUNT(*)::int AS db,
                COALESCE(SUM(amount) FILTER (WHERE currency='RON'),0)::numeric AS ron
         FROM driver_advances
         WHERE company_id = $1 AND LOWER(email_sofer) = $2`,
        [cid, (driver.email || '').toLowerCase()]
      );
      advTotal = advR.rows[0];
    } catch (e) { /* driver_advances hiányában csendben kihagyjuk */ }

    return res.json({
      result: {
        ok: true,
        driver: driver,
        expiries: expR.rows,
        advanceTotal: advTotal,
      },
    });
  } catch (err) {
    console.error('getDriverDetail hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// ════════════════════════════════════════════════════════════
//  FUVAR-RÉSZLETEK (read-only drill-in)
//  Visszaad: a fuvar sora + dokumentumai (order_documents + POD documents)
//  + számlái (invoices) + szakaszai (order_legs) + audit-bejegyzései +
//  tracking_token. Minden lekérdezés company_id-szűrt + tulajdonjog-ellenőrzés.
//  CSAK olvasás — a szerkesztés/számlázás/dok-művelet a MÁR LÉTEZŐ
//  (auditált) handlereken/modulokon megy (a kliens azokra linkel).
// ════════════════════════════════════════════════════════════
handlers.getOrderDetail = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const a = _arg(args);
    const cid = req.session.user.company_id;
    const id = a.id != null ? String(a.id).trim() : '';
    if (!id) return res.json({ result: { ok: false, err: 'ID invalid.' } });

    // 1) TULAJDONJOG-ELLENŐRZÉS — a fuvar a hívó cégéé (nincs cross-tenant olvasás)
    const or = await pool.query(
      `SELECT o.*, COALESCE(c.denumire, o.client) AS client_name
       FROM orders o
       LEFT JOIN clients c ON c.id = o.client_id AND c.company_id = o.company_id
       WHERE o.id = $1 AND o.company_id = $2`,
      [id, cid]
    );
    if (!or.rows.length) return res.json({ result: { ok: false, err: 'Comanda nu a fost gasita.' } });
    const order = or.rows[0];

    // 2) Fuvar-dokumentumok (megrendelő PDF / aláírt CMR) — order_id + company_id-szűrt
    const docR = await pool.query(
      `SELECT id, file_name, uploaded_by, created_at,
              (signed_base64 IS NOT NULL) AS signed
       FROM order_documents
       WHERE order_id = $1 AND company_id = $2
       ORDER BY created_at DESC, id DESC LIMIT 100`,
      [id, cid]
    );

    // 3) POD-fotók (sofőr feltöltései) — a documents.order_id-hez kötve.
    //    A documents tábla NEM tárol company_id-t, ezért a fuvar tulajdonjoga
    //    (fenti ellenőrzés) jelenti a tenant-határt: csak a SAJÁT cég fuvarjának
    //    POD-jait kérjük le (order_id = a már verifikált fuvar id-je).
    const podR = await pool.query(
      `SELECT id, tip, file_name, nume_sofer, created_at
       FROM documents
       WHERE order_id = $1
       ORDER BY created_at DESC, id DESC LIMIT 100`,
      [id]
    );

    // 4) Számlák (kimenő) — order_id + company_id-szűrt
    const invR = await pool.query(
      `SELECT id, provider, serie, numar, total, valuta, tva, status, pdf_link,
              efactura_status, created_at
       FROM invoices
       WHERE order_id = $1 AND company_id = $2
       ORDER BY created_at DESC, id DESC LIMIT 50`,
      [id, cid]
    );

    // 5) Szakaszok (order_legs) — order_id + company_id-szűrt
    const legR = await pool.query(
      `SELECT id, leg_number, sofer_type, email_sofer, nume_sofer, firma_extern,
              rendszam_camion, rendszam_remorca, loc_preluare, data_preluare,
              loc_predare, data_predare
       FROM order_legs
       WHERE order_id = $1 AND company_id = $2
       ORDER BY leg_number ASC, id ASC`,
      [id, cid]
    );

    // 6) Audit-bejegyzések — entity_type='order', entity_id = a fuvar id-je,
    //    company_id-szűrt (az audit_log tárol company_id-t → tiszta tenant-határ).
    const audR = await pool.query(
      `SELECT id, user_email, action, detail, ip, created_at
       FROM audit_log
       WHERE company_id = $1 AND entity_type = 'order' AND entity_id = $2
       ORDER BY created_at DESC, id DESC LIMIT 50`,
      [cid, id]
    );

    return res.json({
      result: {
        ok: true,
        order: order,
        documents: docR.rows,
        pod: podR.rows,
        invoices: invR.rows,
        legs: legR.rows,
        activity: audR.rows,
        tracking_token: order.tracking_token || null,
      },
    });
  } catch (err) {
    console.error('getOrderDetail hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// ════════════════════════════════════════════════════════════
//  ÜGYFÉL-PROFIL (read-only drill-in)
//  Visszaad: az ügyfél sora + a fuvarjai (utolsó ~50) + a számlái +
//  portál-hozzáférései (client_users, jelszó-hash NÉLKÜL).
//  Minden lekérdezés company_id-szűrt + tulajdonjog-ellenőrzés.
// ════════════════════════════════════════════════════════════
handlers.getClientProfile = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const a = _arg(args);
    const cid = req.session.user.company_id;
    const id = parseInt(a.id, 10);
    if (!Number.isFinite(id)) return res.json({ result: { ok: false, err: 'ID invalid.' } });

    // 1) TULAJDONJOG-ELLENŐRZÉS — az ügyfél a hívó cégéé (nincs cross-tenant olvasás)
    const cr = await pool.query(
      'SELECT * FROM clients WHERE id = $1 AND company_id = $2',
      [id, cid]
    );
    if (!cr.rows.length) return res.json({ result: { ok: false, err: 'Clientul nu a fost gasit.' } });
    const client = cr.rows[0];

    // 2) Az ügyfél fuvarjai — company_id ÉS client_id szerint, utolsó ~50
    const ordR = await pool.query(
      `SELECT id, loc_incarcare, loc_descarcare, pret, km, status, created_at
       FROM orders
       WHERE company_id = $1 AND client_id = $2
       ORDER BY created_at DESC LIMIT 50`,
      [cid, id]
    );

    // 3) Az ügyfél számlái — a hozzá kötött fuvarok számlái (company_id-szűrt).
    //    Az invoices nem hivatkozik közvetlenül client_id-re → az ügyfél fuvarjai
    //    (orders.client_id) order_id-jén keresztül kötjük.
    const invR = await pool.query(
      `SELECT i.id, i.order_id, i.provider, i.serie, i.numar, i.total, i.valuta,
              i.status, i.pdf_link, i.created_at
       FROM invoices i
       WHERE i.company_id = $1
         AND i.order_id IN (SELECT id FROM orders WHERE company_id = $1 AND client_id = $2)
       ORDER BY i.created_at DESC, i.id DESC LIMIT 50`,
      [cid, id]
    );

    // 4) Portál-hozzáférések (client_users) — company_id ÉS client_id-szűrt,
    //    jelszó-hash NÉLKÜL (csak a státusz-jelzők).
    const cuR = await pool.query(
      `SELECT id, email, nev, activ, last_login,
              (pass_hash IS NOT NULL) AS has_password,
              (invite_token IS NOT NULL) AS pending_invite
       FROM client_users
       WHERE company_id = $1 AND client_id = $2
       ORDER BY created_at DESC`,
      [cid, id]
    );

    return res.json({
      result: {
        ok: true,
        client: client,
        orders: ordR.rows,
        invoices: invR.rows,
        portal: cuR.rows,
      },
    });
  } catch (err) {
    console.error('getClientProfile hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

module.exports = handlers;
