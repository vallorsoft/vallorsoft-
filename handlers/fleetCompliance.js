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

function _isAdminOrManager(req) {
  return req.session.user && ['Admin', 'Manager'].includes(req.session.user.pozicio);
}
function _deny(res) {
  return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
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
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
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
    if (!docType || !expiry) return res.json({ result: { ok: false, err: 'A dokumentum-típus és a lejárati dátum kötelező.' } });

    if (id) {
      const r = await pool.query(
        `UPDATE document_expiries
         SET entity_type=$3, entity_label=$4, doc_type=$5, expiry_date=$6, alert_days=$7,
             note=$8, last_alert_at=NULL, updated_at=NOW()
         WHERE id=$1 AND company_id=$2`,
        [id, cid, entityType, label || null, docType, expiry, alertDays, f.note || null]
      );
      if (!r.rowCount) return res.json({ result: { ok: false, err: 'Nem található.' } });
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
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
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
    return res.json({ result: { ok: !!r.rowCount, err: r.rowCount ? undefined : 'Nem található.' } });
  } catch (err) {
    console.error('expiryDelete hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
  }
};

// Vezérlőpult-kártya: lejárt + hamarosan lejáró tételek
handlers.getExpiryAlerts = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const r = await pool.query(
      `SELECT id, entity_type, entity_label, doc_type, expiry_date,
              (expiry_date - CURRENT_DATE)::int AS days_left
       FROM document_expiries
       WHERE company_id = $1 AND expiry_date <= CURRENT_DATE + alert_days * INTERVAL '1 day'
       ORDER BY expiry_date ASC LIMIT 20`,
      [req.session.user.company_id]
    );
    return res.json({ result: { ok: true, items: r.rows } });
  } catch (err) {
    console.error('getExpiryAlerts hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
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
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
  }
};

// args: [{vehicle_id, service_date, km, category, description, cost_ron, next_due_date, next_due_km}]
handlers.serviceCreate = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const cid = req.session.user.company_id;
    const f = _arg(args);
    const vehicleId = parseInt(f.vehicle_id, 10);
    if (!Number.isFinite(vehicleId)) return res.json({ result: { ok: false, err: 'Válassz járművet!' } });
    // multi-tenant: a jármű a saját cégé legyen
    const vr = await pool.query('SELECT id FROM vehicles WHERE id=$1 AND company_id=$2', [vehicleId, cid]);
    if (!vr.rows.length) return res.json({ result: { ok: false, err: 'A jármű nem található.' } });
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
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
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
    return res.json({ result: { ok: !!r.rowCount, err: r.rowCount ? undefined : 'Nem található.' } });
  } catch (err) {
    console.error('serviceDelete hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
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
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
  }
};

handlers.advanceCreate = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const cid = req.session.user.company_id;
    const f = _arg(args);
    const email = String(f.email_sofer || '').trim().toLowerCase();
    const amount = parseFloat(f.amount);
    if (!email) return res.json({ result: { ok: false, err: 'Válassz sofőrt!' } });
    if (!Number.isFinite(amount) || amount <= 0) return res.json({ result: { ok: false, err: 'Érvénytelen összeg.' } });
    await pool.query(
      `INSERT INTO driver_advances (company_id, email_sofer, amount, currency, given_at, note, created_by)
       VALUES ($1,$2,$3,'RON',$4,$5,$6)`,
      [cid, email, amount, f.given_at || new Date(), String(f.note || '').trim() || null, req.session.user.email]
    );
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('advanceCreate hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
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
    return res.json({ result: { ok: !!r.rowCount, err: r.rowCount ? undefined : 'Nem található.' } });
  } catch (err) {
    console.error('advanceDelete hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
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
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
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
    if (!email) return res.json({ result: { ok: false, err: 'Válassz sofőrt!' } });
    const from = a.from || '1970-01-01';
    const to = a.to || '2999-12-31';

    // A sofőr a saját céghez tartozzon
    const ur = await pool.query(
      'SELECT nume FROM users WHERE LOWER(email)=LOWER($1) AND company_id=$2', [email, cid]);
    if (!ur.rows.length) return res.json({ result: { ok: false, err: 'A sofőr nem található.' } });

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
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
  }
};

module.exports = handlers;
