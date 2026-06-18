// ============================================================
//  VallorSoft — handlers/fleetCompliance.js
//  Flotta-megfelelés modulok (3. fázis):
//   1) Lejárat-figyelés (document_expiries) — ITP/RCA/rovinietă/tahográf...
//   2) Szerviz & karbantartás napló (vehicle_service_log)
//   3) Sofőr-elszámolás / decont (driver_advances + fuvarlevél-költések + diurna)
//  Minden lekérdezés company_id-re szűr (multi-tenant).
// ============================================================
const pool = require('../db');

const handlers = {};

// Szerviz-esedékesség riasztási küszöbök (km- és dátum-alapú emlékeztető):
//  - SERVICE_WARN_KM: ennyi km-rel a `next_due_km` előtt (vagy ha már túllépte) jelez
//  - SERVICE_WARN_DAYS: ennyi nappal a `next_due_date` előtt (vagy ha már lejárt) jelez
const SERVICE_WARN_KM = 2000;
const SERVICE_WARN_DAYS = 30;

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
//  1) LEJÁRAT-FIGYELÉS
// ════════════════════════════════════════════════════════════

handlers.expiryList = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const r = await pool.query(
      `SELECT id, entity_type, entity_label, doc_type, expiry_date, alert_days, note,
              (expiry_date - CURRENT_DATE)::int AS days_left
       FROM document_expiries
       WHERE company_id = $1
       ORDER BY expiry_date ASC`,
      [req.session.user.company_id]
    );
    return res.json({ result: { ok: true, items: r.rows } });
  } catch (err) {
    console.error('expiryList hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// args: [id|null, {entity_type, entity_label, doc_type, expiry_date, alert_days, note}]
handlers.expirySave = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const cid = req.session.user.company_id;
    const id = args[0] ? parseInt(args[0], 10) : null;
    const f = args[1] || {};
    const entityType = ['vehicle', 'driver', 'company'].includes(f.entity_type) ? f.entity_type : 'vehicle';
    const label = String(f.entity_label || '').trim();
    const docType = String(f.doc_type || '').trim();
    const expiry = f.expiry_date;
    let alertDays = parseInt(f.alert_days, 10);
    if (!Number.isFinite(alertDays) || alertDays < 0 || alertDays > 365) alertDays = 30;
    if (!docType || !expiry) return res.json({ result: { ok: false, err: 'Tipul documentului si data expirarii sunt obligatorii.' } });

    if (id) {
      const r = await pool.query(
        `UPDATE document_expiries
         SET entity_type=$3, entity_label=$4, doc_type=$5, expiry_date=$6, alert_days=$7,
             note=$8, last_alert_at=NULL, updated_at=NOW()
         WHERE id=$1 AND company_id=$2`,
        [id, cid, entityType, label || null, docType, expiry, alertDays, f.note || null]
      );
      if (!r.rowCount) return res.json({ result: { ok: false, err: 'Nu a fost gasit.' } });
    } else {
      await pool.query(
        `INSERT INTO document_expiries (company_id, entity_type, entity_label, doc_type, expiry_date, alert_days, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [cid, entityType, label || null, docType, expiry, alertDays, f.note || null]
      );
    }
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('expirySave hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

handlers.expiryDelete = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const id = parseInt(args[0], 10);
    const r = await pool.query(
      'DELETE FROM document_expiries WHERE id = $1 AND company_id = $2',
      [id, req.session.user.company_id]
    );
    return res.json({ result: { ok: !!r.rowCount, err: r.rowCount ? undefined : 'Nu a fost gasit.' } });
  } catch (err) {
    console.error('expiryDelete hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// Vezérlőpult-kártya: lejárt + hamarosan lejáró tételek
handlers.getExpiryAlerts = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const cid = req.session.user.company_id;
    const r = await pool.query(
      `SELECT id, entity_type, entity_label, doc_type, expiry_date,
              (expiry_date - CURRENT_DATE)::int AS days_left
       FROM document_expiries
       WHERE company_id = $1 AND expiry_date <= CURRENT_DATE + alert_days * INTERVAL '1 day'
       ORDER BY expiry_date ASC LIMIT 20`,
      [cid]
    );
    let items = r.rows;
    // UIT (RO e-Transport) lejáró kódok beolvasztása — a 5/15 napos érvényesség
    // végéhez közeledő AKTÍV kódok (még nem leállított), max 2 nappal lejárat előtt
    // vagy már lejárt, de még nem leállítva. Best-effort (ha nincs tábla, kihagyjuk).
    try {
      const u = await pool.query(
        `SELECT order_id, uit_code, valid_until AS expiry_date,
                (valid_until - CURRENT_DATE)::int AS days_left
         FROM order_uit_codes
         WHERE company_id = $1 AND valid_until IS NOT NULL
           AND status <> 'stopped'
           AND valid_until <= CURRENT_DATE + 2
         ORDER BY valid_until ASC LIMIT 20`,
        [cid]
      );
      const uitItems = u.rows.map(function (x) {
        return {
          id: 'uit-' + x.order_id,
          entity_type: 'uit',
          entity_label: x.order_id,
          doc_type: 'Cod UIT ' + String(x.uit_code || '').slice(0, 10),
          expiry_date: x.expiry_date,
          days_left: x.days_left,
        };
      });
      items = items.concat(uitItems).sort(function (a, b) { return a.days_left - b.days_left; });
    } catch (e) { /* order_uit_codes hiányában csendben kihagyjuk */ }
    return res.json({ result: { ok: true, items: items } });
  } catch (err) {
    console.error('getExpiryAlerts hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// ════════════════════════════════════════════════════════════
//  2) SZERVIZ & KARBANTARTÁS
// ════════════════════════════════════════════════════════════

handlers.serviceList = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const a = _arg(args);
    const cid = req.session.user.company_id;
    const params = [cid];
    let where = 's.company_id = $1';
    const vehicleId = parseInt(a.vehicleId, 10);
    if (Number.isFinite(vehicleId)) { params.push(vehicleId); where += ' AND s.vehicle_id = $2'; }
    const r = await pool.query(
      `SELECT s.id, s.vehicle_id, v.rendszam, s.service_date, s.km, s.category,
              s.description, s.cost_ron, s.next_due_date, s.next_due_km
       FROM vehicle_service_log s
       JOIN vehicles v ON v.id = s.vehicle_id
       WHERE ${where}
       ORDER BY s.service_date DESC, s.id DESC LIMIT 300`,
      params
    );
    return res.json({ result: { ok: true, items: r.rows } });
  } catch (err) {
    console.error('serviceList hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// args: [{vehicle_id, service_date, km, category, description, cost_ron, next_due_date, next_due_km}]
handlers.serviceCreate = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const cid = req.session.user.company_id;
    const f = _arg(args);
    const vehicleId = parseInt(f.vehicle_id, 10);
    if (!Number.isFinite(vehicleId)) return res.json({ result: { ok: false, err: 'Selecteaza un vehicul!' } });
    // multi-tenant: a jármű a saját cégé legyen
    const vr = await pool.query('SELECT id FROM vehicles WHERE id=$1 AND company_id=$2', [vehicleId, cid]);
    if (!vr.rows.length) return res.json({ result: { ok: false, err: 'Vehiculul nu a fost gasit.' } });
    const num = (x) => { const n = parseFloat(x); return Number.isFinite(n) ? n : null; };
    await pool.query(
      `INSERT INTO vehicle_service_log
         (company_id, vehicle_id, service_date, km, category, description, cost_ron, next_due_date, next_due_km)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [cid, vehicleId, f.service_date || new Date(), num(f.km), f.category || 'javitas',
       String(f.description || '').trim() || null, num(f.cost_ron), f.next_due_date || null, num(f.next_due_km)]
    );
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('serviceCreate hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

handlers.serviceDelete = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const id = parseInt(args[0], 10);
    const r = await pool.query(
      'DELETE FROM vehicle_service_log WHERE id = $1 AND company_id = $2',
      [id, req.session.user.company_id]
    );
    return res.json({ result: { ok: !!r.rowCount, err: r.rowCount ? undefined : 'Nu a fost gasit.' } });
  } catch (err) {
    console.error('serviceDelete hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// ────────────────────────────────────────────────────────────
//  Szerviz-esedékesség (km- és dátum-alapú) — közös segéd.
//  Járművenként a LEGUTÓBBI szerviz-bejegyzés `next_due_km`/`next_due_date`
//  mezőjét veti össze az ÉLŐ GPS km-órával (gps_mileage_log legutóbbi
//  snapshotja) és a mai dátummal. A küszöbön belüli (vagy már túllépett)
//  tételeket adja vissza. Best-effort: ha a tábla/oszlop hiányzik → üres.
//  opts.onlyStale=true → csak a hetente-egyszer logika szerint esedékes
//  (utoljára 7+ napja riasztott) tételek — a schedulernek.
// ────────────────────────────────────────────────────────────
async function computeServiceDueAlerts(cid, opts) {
  const onlyStale = !!(opts && opts.onlyStale);
  let rows;
  try {
    ({ rows } = await pool.query(
      `WITH last_srv AS (
         SELECT DISTINCT ON (s.vehicle_id)
                s.id, s.vehicle_id, v.rendszam, s.next_due_km, s.next_due_date,
                s.category, s.service_date, s.last_alert_at
         FROM vehicle_service_log s
         JOIN vehicles v ON v.id = s.vehicle_id
         WHERE s.company_id = $1
           AND (s.next_due_km IS NOT NULL OR s.next_due_date IS NOT NULL)
         ORDER BY s.vehicle_id, s.service_date DESC NULLS LAST, s.id DESC
       ),
       last_km AS (
         SELECT DISTINCT ON (norm) norm, mileage FROM (
           SELECT UPPER(REGEXP_REPLACE(rendszam,'[^A-Za-z0-9]','','g')) AS norm, mileage, logged_on
           FROM gps_mileage_log WHERE company_id = $1
         ) z ORDER BY norm, logged_on DESC
       )
       SELECT ls.id, ls.vehicle_id, ls.rendszam, ls.next_due_km, ls.next_due_date,
              ls.category, ls.last_alert_at,
              (ls.next_due_date - CURRENT_DATE)::int AS days_left,
              lk.mileage AS current_km
       FROM last_srv ls
       LEFT JOIN last_km lk
         ON lk.norm = UPPER(REGEXP_REPLACE(ls.rendszam,'[^A-Za-z0-9]','','g'))`,
      [cid]));
  } catch (e) {
    return []; // migráció előtt / tábla hiányában csendben üres
  }

  const items = [];
  for (const r of rows) {
    const nextKm = r.next_due_km != null ? parseInt(r.next_due_km, 10) : null;
    const curKm = r.current_km != null ? Math.round(parseFloat(r.current_km)) : null;
    const kmLeft = (nextKm != null && curKm != null) ? (nextKm - curKm) : null;
    const daysLeft = r.days_left != null ? parseInt(r.days_left, 10) : null;

    const kmDue = kmLeft != null && kmLeft <= SERVICE_WARN_KM;
    const dateDue = daysLeft != null && daysLeft <= SERVICE_WARN_DAYS;
    if (!kmDue && !dateDue) continue;

    // hetente-egyszer duplikáció-őr (csak a schedulernek)
    if (onlyStale && r.last_alert_at) {
      const last = new Date(r.last_alert_at);
      const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
      if (last > weekAgo) continue;
    }

    items.push({
      id: r.id,
      vehicle_id: r.vehicle_id,
      rendszam: r.rendszam,
      category: r.category || null,
      next_due_km: kmDue ? nextKm : null,
      current_km: kmDue ? curKm : null,
      km_left: kmDue ? kmLeft : null,
      next_due_date: dateDue ? r.next_due_date : null,
      days_left: dateDue ? daysLeft : null,
    });
  }

  // Sürgősség szerint: a túllépett/lejárt elöl, majd a legkevesebb hátralévő
  items.sort(function (a, b) {
    const sa = Math.min(a.km_left != null ? a.km_left : 9e9, a.days_left != null ? a.days_left : 9e9);
    const sb = Math.min(b.km_left != null ? b.km_left : 9e9, b.days_left != null ? b.days_left : 9e9);
    return sa - sb;
  });
  return items;
}

// Vezérlőpult-kártya: km-/dátum-alapú esedékes szervizek (read-only).
handlers.getServiceDueAlerts = async function (req, res) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const items = await computeServiceDueAlerts(req.session.user.company_id, { onlyStale: false });
    return res.json({ result: { ok: true, items: items.slice(0, 30) } });
  } catch (err) {
    console.error('getServiceDueAlerts hiba:', err);
    return res.json({ result: { ok: true, items: [] } }); // migráció előtt: üres
  }
};

// ════════════════════════════════════════════════════════════
//  3) SOFŐR-ELSZÁMOLÁS (DECONT)
// ════════════════════════════════════════════════════════════

// args: [{email, from, to}] — előlegek listája (email nélkül: mind)
handlers.advanceList = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const a = _arg(args);
    const cid = req.session.user.company_id;
    const params = [cid];
    let where = 'company_id = $1';
    if (a.email) { params.push(String(a.email).toLowerCase()); where += ` AND LOWER(email_sofer) = $${params.length}`; }
    if (a.from) { params.push(a.from); where += ` AND given_at >= $${params.length}`; }
    if (a.to)   { params.push(a.to);   where += ` AND given_at <= $${params.length}`; }
    const r = await pool.query(
      `SELECT id, email_sofer, amount, currency, given_at, note, created_by
       FROM driver_advances WHERE ${where} ORDER BY given_at DESC, id DESC LIMIT 300`,
      params
    );
    return res.json({ result: { ok: true, items: r.rows } });
  } catch (err) {
    console.error('advanceList hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

handlers.advanceCreate = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const cid = req.session.user.company_id;
    const f = _arg(args);
    const email = String(f.email_sofer || '').trim().toLowerCase();
    const amount = parseFloat(f.amount);
    if (!email) return res.json({ result: { ok: false, err: 'Selecteaza un sofer!' } });
    if (!Number.isFinite(amount) || amount <= 0) return res.json({ result: { ok: false, err: 'Suma invalida.' } });
    await pool.query(
      `INSERT INTO driver_advances (company_id, email_sofer, amount, currency, given_at, note, created_by)
       VALUES ($1,$2,$3,'RON',$4,$5,$6)`,
      [cid, email, amount, f.given_at || new Date(), String(f.note || '').trim() || null, req.session.user.email]
    );
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('advanceCreate hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

handlers.advanceDelete = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const id = parseInt(args[0], 10);
    const r = await pool.query(
      'DELETE FROM driver_advances WHERE id = $1 AND company_id = $2',
      [id, req.session.user.company_id]
    );
    return res.json({ result: { ok: !!r.rowCount, err: r.rowCount ? undefined : 'Nu a fost gasit.' } });
  } catch (err) {
    console.error('advanceDelete hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// Diurna napidíj-ráták (cég-szintű, admin állítja) — decont-számításhoz
handlers.setDiurnaRates = async function (req, res, args) {
  try {
    if (!req.session.user || req.session.user.pozicio !== 'Admin') return _deny(res);
    const f = _arg(args);
    const num = (x) => { const n = parseFloat(x); return Number.isFinite(n) && n >= 0 ? n : null; };
    await pool.query(
      'UPDATE companies SET diurna_ext_rate = $1, diurna_int_rate = $2 WHERE id = $3',
      [num(f.ext), num(f.int), req.session.user.company_id]
    );
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('setDiurnaRates hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// Teljes elszámolás egy sofőrre + időszakra:
//  + kiadott előlegek (driver_advances)
//  − készpénzes költések (fuvarlevél: alimentari + achizitii, plata='Cash')
//  = kassza-egyenleg;  külön: diurna-járandóság (napok × cég-ráta)
// args: [{email, from, to}]
handlers.getDriverSettlement = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const a = _arg(args);
    const cid = req.session.user.company_id;
    const email = String(a.email || '').trim().toLowerCase();
    if (!email) return res.json({ result: { ok: false, err: 'Selecteaza un sofer!' } });
    const from = a.from || '1970-01-01';
    const to = a.to || '2999-12-31';

    // A sofőr a saját céghez tartozzon
    const ur = await pool.query(
      'SELECT nume FROM users WHERE LOWER(email)=LOWER($1) AND company_id=$2', [email, cid]);
    if (!ur.rows.length) return res.json({ result: { ok: false, err: 'Soferul nu a fost gasit.' } });

    // Előlegek
    const advR = await pool.query(
      `SELECT COALESCE(SUM(amount),0)::numeric AS total, COUNT(*)::int AS db
       FROM driver_advances
       WHERE company_id=$1 AND LOWER(email_sofer)=$2 AND given_at >= $3 AND given_at <= $4`,
      [cid, email, from, to]
    );

    // Menetlevél-költések fizetési mód szerint (Cash külön — azt a kasszából költötte)
    const ktgR = await pool.query(
      `SELECT COALESCE(NULLIF(x.plata,''),'?') AS plata,
              SUM(x.osszeg)::numeric AS osszeg, COUNT(*)::int AS db
       FROM (
         SELECT a.elem->>'plata' AS plata, (a.elem->>'suma')::numeric AS osszeg
         FROM fuvarlevelek f, jsonb_array_elements(f.alimentari) a(elem)
         WHERE LOWER(f.email_sofer)=$1 AND f.data_completare >= $2::date AND f.data_completare < ($3::date + 1)
         UNION ALL
         SELECT c.elem->>'plata', (c.elem->>'pret')::numeric
         FROM fuvarlevelek f, jsonb_array_elements(f.achizitii) c(elem)
         WHERE LOWER(f.email_sofer)=$1 AND f.data_completare >= $2::date AND f.data_completare < ($3::date + 1)
       ) x
       GROUP BY 1 ORDER BY osszeg DESC NULLS LAST`,
      [email, from, to]
    );

    // Diurna napok + km az időszak menetleveleiből
    const diuR = await pool.query(
      `SELECT COALESCE(SUM(diurna_externa),0)::int AS d_ext,
              COALESCE(SUM(diurna_interna),0)::int AS d_int,
              COALESCE(SUM(total_km),0)::numeric AS km,
              COUNT(*)::int AS menetlevelek
       FROM fuvarlevelek
       WHERE LOWER(email_sofer)=$1 AND data_completare >= $2::date AND data_completare < ($3::date + 1)`,
      [email, from, to]
    );

    // Cég diurna-rátái
    const rateR = await pool.query(
      'SELECT diurna_ext_rate, diurna_int_rate FROM companies WHERE id = $1', [cid]);
    const rates = rateR.rows[0] || {};

    const adv = advR.rows[0];
    const diu = diuR.rows[0];
    const cash = ktgR.rows.find((x) => /cash/i.test(x.plata || ''));
    const cashSpent = cash ? parseFloat(cash.osszeg) || 0 : 0;
    const extRate = rates.diurna_ext_rate != null ? parseFloat(rates.diurna_ext_rate) : null;
    const intRate = rates.diurna_int_rate != null ? parseFloat(rates.diurna_int_rate) : null;
    const diurnaTotal = (extRate != null || intRate != null)
      ? Math.round(((diu.d_ext * (extRate || 0)) + (diu.d_int * (intRate || 0))) * 100) / 100
      : null;

    return res.json({ result: {
      ok: true,
      sofer: { email, nume: ur.rows[0].nume },
      eloleg_total: adv.total, eloleg_db: adv.db,
      koltesek: ktgR.rows,             // fizetési mód szerinti bontás
      cash_koltes: cashSpent,
      kassza_egyenleg: Math.round(((parseFloat(adv.total) || 0) - cashSpent) * 100) / 100,
      diurna: { ext_nap: diu.d_ext, int_nap: diu.d_int, ext_rate: extRate, int_rate: intRate, total: diurnaTotal },
      km: diu.km, menetlevelek: diu.menetlevelek,
    }});
  } catch (err) {
    console.error('getDriverSettlement hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// ════════════════════════════════════════════════════════════
//  4) ÜZEMANYAGKÁRTYA-IMPORT (OMV/MOL/DKV/Eurowag CSV)
// ════════════════════════════════════════════════════════════
const _fcCrypto = require('crypto');

// args: [{source, rows:[{rendszam, tx_date, product, qty_l, amount_ron}]}]
// Dedup: hash(forrás|rendszám|dátum|liter|összeg) — kétszeri import nem duplikál.
handlers.fuelImportRows = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const cid = req.session.user.company_id;
    const f = _arg(args);
    const source = String(f.source || 'egyeb').toLowerCase().slice(0, 30);
    const rows = Array.isArray(f.rows) ? f.rows.slice(0, 2000) : [];
    if (!rows.length) return res.json({ result: { ok: false, err: 'Nu exista randuri de importat.' } });

    let inserted = 0, skipped = 0;
    for (const r of rows) {
      const rendszam = String(r.rendszam || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 50);
      const qty = parseFloat(r.qty_l);
      const amount = parseFloat(r.amount_ron);
      const date = r.tx_date;
      if (!date || !Number.isFinite(qty) || !Number.isFinite(amount)) { skipped++; continue; }
      const hash = _fcCrypto.createHash('sha256')
        .update([source, rendszam, date, qty.toFixed(2), amount.toFixed(2)].join('|'))
        .digest('hex');
      const ins = await pool.query(
        `INSERT INTO fuel_card_transactions (company_id, source, rendszam, tx_date, product, qty_l, amount_ron, dedup_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (company_id, dedup_hash) DO NOTHING`,
        [cid, source, rendszam || null, date, String(r.product || '').slice(0, 100) || null, qty, amount, hash]
      );
      if (ins.rowCount) inserted++; else skipped++;
    }
    return res.json({ result: { ok: true, inserted, skipped } });
  } catch (err) {
    console.error('fuelImportRows hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server (a rulat migrarea phase4?)' } });
  }
};

handlers.fuelCardList = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const a = _arg(args);
    const cid = req.session.user.company_id;
    const params = [cid];
    let where = 'company_id = $1';
    if (a.from) { params.push(a.from); where += ` AND tx_date >= $${params.length}`; }
    if (a.to)   { params.push(a.to);   where += ` AND tx_date <= $${params.length}`; }
    const r = await pool.query(
      `SELECT id, source, rendszam, tx_date, product, qty_l, amount_ron
       FROM fuel_card_transactions WHERE ${where}
       ORDER BY tx_date DESC, id DESC LIMIT 200`, params);
    const sumR = await pool.query(
      `SELECT COUNT(*)::int AS db, COALESCE(SUM(qty_l),0)::numeric AS litru, COALESCE(SUM(amount_ron),0)::numeric AS suma
       FROM fuel_card_transactions WHERE ${where}`, params);
    return res.json({ result: { ok: true, items: r.rows, total: sumR.rows[0] } });
  } catch (err) {
    console.error('fuelCardList hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server (a rulat migrarea phase4?)' } });
  }
};

// Kártya-tranzakciók vs. a sofőr által beírt tankolások (Motorină),
// rendszámonként — a >10% eltérés gyanús (elírás vagy visszaélés).
handlers.fuelCompare = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const a = _arg(args);
    const cid = req.session.user.company_id;
    const from = a.from || '1970-01-01';
    const to = a.to || '2999-12-31';

    const cardR = await pool.query(
      `SELECT rendszam, COALESCE(SUM(qty_l),0)::numeric AS litru, COALESCE(SUM(amount_ron),0)::numeric AS suma
       FROM fuel_card_transactions
       WHERE company_id=$1 AND tx_date >= $2 AND tx_date <= $3 AND rendszam IS NOT NULL
       GROUP BY rendszam`, [cid, from, to]);

    const drvR = await pool.query(
      `SELECT UPPER(REGEXP_REPLACE(f.numar_camion,'[^A-Za-z0-9]','','g')) AS rendszam,
              COALESCE(SUM((a.elem->>'litru')::numeric),0) AS litru,
              COALESCE(SUM((a.elem->>'suma')::numeric),0) AS suma
       FROM fuvarlevelek f
       JOIN users u ON LOWER(u.email)=LOWER(f.email_sofer) AND u.company_id=$1,
            jsonb_array_elements(f.alimentari) a(elem)
       WHERE f.data_completare >= $2::date AND f.data_completare < ($3::date + 1)
         AND COALESCE(a.elem->>'tip','Motorină') <> 'AdBlue'
         AND COALESCE(f.numar_camion,'') <> ''
       GROUP BY 1`, [cid, from, to]);

    const map = new Map();
    cardR.rows.forEach((r) => map.set(r.rendszam, { rendszam: r.rendszam, card_l: parseFloat(r.litru), card_ron: parseFloat(r.suma), drv_l: 0, drv_ron: 0 }));
    drvR.rows.forEach((r) => {
      const cur = map.get(r.rendszam) || { rendszam: r.rendszam, card_l: 0, card_ron: 0 };
      cur.drv_l = parseFloat(r.litru); cur.drv_ron = parseFloat(r.suma);
      map.set(r.rendszam, cur);
    });
    const rows = [...map.values()].map((x) => {
      x.diff_l = Math.round((x.drv_l - x.card_l) * 10) / 10;
      x.diff_pct = x.card_l > 0 ? Math.round(((x.drv_l - x.card_l) / x.card_l) * 1000) / 10 : null;
      return x;
    }).sort((a2, b2) => Math.abs(b2.diff_l) - Math.abs(a2.diff_l));

    return res.json({ result: { ok: true, rows } });
  } catch (err) {
    console.error('fuelCompare hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// ════════════════════════════════════════════════════════════
//  5) GPS-KM vs. MENETLEVÉL-KM (a napi gps_mileage_log snapshotból)
// ════════════════════════════════════════════════════════════
handlers.getGpsKmComparison = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const a = _arg(args);
    const cid = req.session.user.company_id;
    const from = a.from || '1970-01-01';
    const to = a.to || '2999-12-31';

    const gpsR = await pool.query(
      `SELECT rendszam,
              (MAX(mileage) - MIN(mileage))::numeric AS gps_km,
              COUNT(*)::int AS napok
       FROM gps_mileage_log
       WHERE company_id=$1 AND logged_on >= $2::date AND logged_on <= $3::date
       GROUP BY rendszam HAVING COUNT(*) >= 2`, [cid, from, to]);
    if (!gpsR.rows.length) return res.json({ result: { ok: true, rows: [] } });

    const drvR = await pool.query(
      `SELECT UPPER(REGEXP_REPLACE(f.numar_camion,'[^A-Za-z0-9]','','g')) AS rendszam,
              COALESCE(SUM(f.total_km),0)::numeric AS drv_km
       FROM fuvarlevelek f
       JOIN users u ON LOWER(u.email)=LOWER(f.email_sofer) AND u.company_id=$1
       WHERE f.data_completare >= $2::date AND f.data_completare < ($3::date + 1)
         AND COALESCE(f.numar_camion,'') <> ''
       GROUP BY 1`, [cid, from, to]);
    const drvMap = new Map();
    drvR.rows.forEach((r) => drvMap.set(r.rendszam, parseFloat(r.drv_km) || 0));

    const rows = gpsR.rows.map((g) => {
      const norm = String(g.rendszam || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const drvKm = drvMap.get(norm) || 0;
      const gpsKm = parseFloat(g.gps_km) || 0;
      return {
        rendszam: g.rendszam, gps_km: Math.round(gpsKm), drv_km: Math.round(drvKm),
        diff_km: Math.round(drvKm - gpsKm),
        diff_pct: gpsKm > 0 ? Math.round(((drvKm - gpsKm) / gpsKm) * 1000) / 10 : null,
        napok: g.napok,
      };
    }).sort((a2, b2) => Math.abs(b2.diff_km) - Math.abs(a2.diff_km));
    return res.json({ result: { ok: true, rows } });
  } catch (err) {
    console.error('getGpsKmComparison hiba:', err);
    return res.json({ result: { ok: true, rows: [] } }); // migráció előtt: üres
  }
};

// A `computeServiceDueAlerts` belső segéd NEM-enumerable → NEM hívható
// /api/execute-on át (a registry csak az enumerálható handlereket másolja),
// de require-rel a scheduler eléri (services/scheduler.js).
module.exports = handlers;
Object.defineProperty(module.exports, 'computeServiceDueAlerts', { enumerable: false, value: computeServiceDueAlerts });
