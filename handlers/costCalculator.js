// ============================================================
//  VallorSoft — handlers/costCalculator.js
//  Költség-kalkulátor (a régi Vallorcalc Next.js-alapú számítás
//  Vallorsoftba beolvasztva). Minden művelet Admin/Manager
//  jogosultsághoz kötött, company_id-szűrt, paraméteres SQL,
//  audit-naplózott. Cross-tenant védelem: a hivatkozott jármű/
//  sofőr/fuvar tulajdonjogát a szerver mindig ellenőrzi.
//
//  A számításokat a lib/calcEngine.js (bit-pontos Vallorcalc-port)
//  végzi — a UI-nak és a szerver-oldali auto-előtöltésnek EGY forrás.
// ============================================================
const pool = require('../db');
const audit = require('../lib/audit');
const { calculate, computeFreightRevenue } = require('../lib/calcEngine');
const { fetchBnrEurRon } = (() => { try { return require('../services/bnr'); } catch { return { fetchBnrEurRon: async () => null }; } })();

const handlers = {};

function _am(req) {
  return req.session && req.session.user && ['Admin', 'Manager'].includes(req.session.user.pozicio);
}
function _cid(req) { return req.session.user.company_id; }
function _str(x, n) { const s = x == null ? null : String(x).trim().slice(0, n); return s || null; }
function _num(x) { if (x === '' || x == null) return null; const n = Number(x); return Number.isFinite(n) ? n : null; }
function _int(x) { const n = parseInt(x, 10); return Number.isFinite(n) ? n : null; }
function _bool(x) { return x === true || x === 'true' || x === 1 || x === '1'; }
function _basis(x) { return x === 'km' ? 'km' : 'time'; }
function _discType(x) { return x === 'gross' || x === 'net' ? x : null; }

// ─── Cross-tenant védelmi segéd — a hivatkozott entitás a cégé-e ─
async function _ownVehicle(cid, vehicleId) {
  if (!vehicleId) return true;
  const r = await pool.query('SELECT 1 FROM vehicles WHERE id=$1 AND company_id=$2', [vehicleId, cid]);
  return r.rowCount === 1;
}
async function _ownDriver(cid, driverId) {
  if (!driverId) return true;
  const r = await pool.query("SELECT 1 FROM users WHERE id=$1 AND company_id=$2 AND pozicio='Sofer'", [driverId, cid]);
  return r.rowCount === 1;
}
async function _ownOrder(cid, orderId) {
  if (!orderId) return true;
  const r = await pool.query('SELECT 1 FROM orders WHERE id=$1 AND company_id=$2', [orderId, cid]);
  return r.rowCount === 1;
}

// ═══════════════════════════════════════════════════════════
//  1) JÁRMŰ-KÖLTSÉG-TÉTELEK
// ═══════════════════════════════════════════════════════════

// args: [{ vehicle_id? }] — ha nincs, a cég ÖSSZES tétele
handlers.vcalcVehicleCostList = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = _cid(req);
    const a = (args && args[0]) || {};
    const params = [cid];
    let sql = `SELECT ci.id, ci.vehicle_id, ci.name, ci.basis_type, ci.interval_km,
                      ci.interval_months, ci.amount_lei, ci.is_gross, ci.notes,
                      v.rendszam, v.marca, v.tip
               FROM vehicle_cost_items ci
               JOIN vehicles v ON v.id = ci.vehicle_id AND v.company_id = ci.company_id
               WHERE ci.company_id = $1`;
    if (a.vehicle_id) { params.push(_int(a.vehicle_id)); sql += ` AND ci.vehicle_id = $${params.length}`; }
    sql += ' ORDER BY v.rendszam, ci.name';
    const r = await pool.query(sql, params);
    return res.json({ result: { ok: true, items: r.rows } });
  } catch (err) { console.error('vcalcVehicleCostList:', err); return res.json({ result: { ok: false, err: 'Eroare de server' } }); }
};

// args: [{ id?, vehicle_id, name, basis_type, interval_km?, interval_months?, amount_lei, is_gross, notes? }]
handlers.vcalcVehicleCostSave = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = _cid(req);
    const a = (args && args[0]) || {};
    const vehicle_id = _int(a.vehicle_id);
    if (!vehicle_id) return res.json({ result: { ok: false, err: 'Vehicul lipsă' } });
    if (!(await _ownVehicle(cid, vehicle_id))) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const name = _str(a.name, 200); if (!name) return res.json({ result: { ok: false, err: 'Denumire lipsă' } });
    const basis = _basis(a.basis_type);
    const interval_km = basis === 'km' ? _num(a.interval_km) : null;
    const interval_months = basis === 'time' ? _int(a.interval_months) : null;
    const amount = _num(a.amount_lei);
    if (amount == null) return res.json({ result: { ok: false, err: 'Sumă invalidă' } });
    const is_gross = a.is_gross == null ? true : _bool(a.is_gross);
    const notes = a.notes != null ? _str(a.notes, 2000) : null;
    const id = _int(a.id);
    let row;
    if (id) {
      const own = await pool.query('SELECT 1 FROM vehicle_cost_items WHERE id=$1 AND company_id=$2', [id, cid]);
      if (own.rowCount === 0) return res.json({ result: { ok: false, err: 'Nu există' } });
      row = await pool.query(
        `UPDATE vehicle_cost_items SET vehicle_id=$3, name=$4, basis_type=$5, interval_km=$6,
                interval_months=$7, amount_lei=$8, is_gross=$9, notes=$10, updated_at=NOW()
         WHERE id=$1 AND company_id=$2 RETURNING *`,
        [id, cid, vehicle_id, name, basis, interval_km, interval_months, amount, is_gross, notes]
      );
    } else {
      row = await pool.query(
        `INSERT INTO vehicle_cost_items (company_id, vehicle_id, name, basis_type, interval_km,
                interval_months, amount_lei, is_gross, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [cid, vehicle_id, name, basis, interval_km, interval_months, amount, is_gross, notes]
      );
    }
    try { await audit.fromReq(req, 'valorcalc.vehicle_cost_save', 'vehicle_cost_item', String(row.rows[0].id), { name }); } catch {}
    return res.json({ result: { ok: true, item: row.rows[0] } });
  } catch (err) { console.error('vcalcVehicleCostSave:', err); return res.json({ result: { ok: false, err: 'Eroare de server' } }); }
};

// args: [{ id }]
handlers.vcalcVehicleCostDelete = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = _cid(req);
    const id = _int((args && args[0] || {}).id);
    if (!id) return res.json({ result: { ok: false, err: 'ID lipsă' } });
    const r = await pool.query('DELETE FROM vehicle_cost_items WHERE id=$1 AND company_id=$2', [id, cid]);
    if (r.rowCount === 0) return res.json({ result: { ok: false, err: 'Nu există' } });
    try { await audit.fromReq(req, 'valorcalc.vehicle_cost_delete', 'vehicle_cost_item', String(id), {}); } catch {}
    return res.json({ result: { ok: true } });
  } catch (err) { console.error('vcalcVehicleCostDelete:', err); return res.json({ result: { ok: false, err: 'Eroare de server' } }); }
};

// ═══════════════════════════════════════════════════════════
//  2) SOFŐR-KÖLTSÉG-TÉTELEK
// ═══════════════════════════════════════════════════════════

handlers.vcalcDriverCostList = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = _cid(req);
    const a = (args && args[0]) || {};
    const params = [cid];
    let sql = `SELECT dci.id, dci.driver_id, dci.name, dci.amount_lei, dci.is_gross, dci.notes,
                      u.nume AS driver_name, u.email AS driver_email
               FROM driver_cost_items dci
               JOIN users u ON u.id = dci.driver_id AND u.company_id = dci.company_id
               WHERE dci.company_id = $1`;
    if (a.driver_id) { params.push(_int(a.driver_id)); sql += ` AND dci.driver_id = $${params.length}`; }
    sql += ' ORDER BY u.nume, dci.name';
    const r = await pool.query(sql, params);
    return res.json({ result: { ok: true, items: r.rows } });
  } catch (err) { console.error('vcalcDriverCostList:', err); return res.json({ result: { ok: false, err: 'Eroare de server' } }); }
};

handlers.vcalcDriverCostSave = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = _cid(req);
    const a = (args && args[0]) || {};
    const driver_id = _int(a.driver_id);
    if (!driver_id) return res.json({ result: { ok: false, err: 'Șofer lipsă' } });
    if (!(await _ownDriver(cid, driver_id))) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const name = _str(a.name, 200); if (!name) return res.json({ result: { ok: false, err: 'Denumire lipsă' } });
    const amount = _num(a.amount_lei); if (amount == null) return res.json({ result: { ok: false, err: 'Sumă invalidă' } });
    const is_gross = a.is_gross == null ? true : _bool(a.is_gross);
    const notes = a.notes != null ? _str(a.notes, 2000) : null;
    const id = _int(a.id);
    let row;
    if (id) {
      const own = await pool.query('SELECT 1 FROM driver_cost_items WHERE id=$1 AND company_id=$2', [id, cid]);
      if (own.rowCount === 0) return res.json({ result: { ok: false, err: 'Nu există' } });
      row = await pool.query(
        `UPDATE driver_cost_items SET driver_id=$3, name=$4, amount_lei=$5, is_gross=$6, notes=$7
         WHERE id=$1 AND company_id=$2 RETURNING *`,
        [id, cid, driver_id, name, amount, is_gross, notes]
      );
    } else {
      row = await pool.query(
        `INSERT INTO driver_cost_items (company_id, driver_id, name, amount_lei, is_gross, notes)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [cid, driver_id, name, amount, is_gross, notes]
      );
    }
    try { await audit.fromReq(req, 'valorcalc.driver_cost_save', 'driver_cost_item', String(row.rows[0].id), { name }); } catch {}
    return res.json({ result: { ok: true, item: row.rows[0] } });
  } catch (err) { console.error('vcalcDriverCostSave:', err); return res.json({ result: { ok: false, err: 'Eroare de server' } }); }
};

handlers.vcalcDriverCostDelete = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = _cid(req);
    const id = _int((args && args[0] || {}).id);
    if (!id) return res.json({ result: { ok: false, err: 'ID lipsă' } });
    const r = await pool.query('DELETE FROM driver_cost_items WHERE id=$1 AND company_id=$2', [id, cid]);
    if (r.rowCount === 0) return res.json({ result: { ok: false, err: 'Nu există' } });
    try { await audit.fromReq(req, 'valorcalc.driver_cost_delete', 'driver_cost_item', String(id), {}); } catch {}
    return res.json({ result: { ok: true } });
  } catch (err) { console.error('vcalcDriverCostDelete:', err); return res.json({ result: { ok: false, err: 'Eroare de server' } }); }
};

// ═══════════════════════════════════════════════════════════
//  3) CÉG-KÖLTSÉG-TÉTELEK
// ═══════════════════════════════════════════════════════════

handlers.vcalcCompanyCostList = async function (req, res) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = _cid(req);
    const r = await pool.query(
      `SELECT id, name, basis_type, interval_months, amount_lei, is_gross
       FROM company_cost_items WHERE company_id=$1 ORDER BY name`, [cid]
    );
    return res.json({ result: { ok: true, items: r.rows } });
  } catch (err) { console.error('vcalcCompanyCostList:', err); return res.json({ result: { ok: false, err: 'Eroare de server' } }); }
};

handlers.vcalcCompanyCostSave = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = _cid(req);
    const a = (args && args[0]) || {};
    const name = _str(a.name, 200); if (!name) return res.json({ result: { ok: false, err: 'Denumire lipsă' } });
    const basis = _basis(a.basis_type);
    const interval_months = _int(a.interval_months) || 12;
    const amount = _num(a.amount_lei); if (amount == null) return res.json({ result: { ok: false, err: 'Sumă invalidă' } });
    const is_gross = a.is_gross == null ? true : _bool(a.is_gross);
    const id = _int(a.id);
    let row;
    if (id) {
      const own = await pool.query('SELECT 1 FROM company_cost_items WHERE id=$1 AND company_id=$2', [id, cid]);
      if (own.rowCount === 0) return res.json({ result: { ok: false, err: 'Nu există' } });
      row = await pool.query(
        `UPDATE company_cost_items SET name=$3, basis_type=$4, interval_months=$5,
                amount_lei=$6, is_gross=$7, updated_at=NOW()
         WHERE id=$1 AND company_id=$2 RETURNING *`,
        [id, cid, name, basis, interval_months, amount, is_gross]
      );
    } else {
      row = await pool.query(
        `INSERT INTO company_cost_items (company_id, name, basis_type, interval_months, amount_lei, is_gross)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [cid, name, basis, interval_months, amount, is_gross]
      );
    }
    try { await audit.fromReq(req, 'valorcalc.company_cost_save', 'company_cost_item', String(row.rows[0].id), { name }); } catch {}
    return res.json({ result: { ok: true, item: row.rows[0] } });
  } catch (err) { console.error('vcalcCompanyCostSave:', err); return res.json({ result: { ok: false, err: 'Eroare de server' } }); }
};

handlers.vcalcCompanyCostDelete = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = _cid(req);
    const id = _int((args && args[0] || {}).id);
    if (!id) return res.json({ result: { ok: false, err: 'ID lipsă' } });
    const r = await pool.query('DELETE FROM company_cost_items WHERE id=$1 AND company_id=$2', [id, cid]);
    if (r.rowCount === 0) return res.json({ result: { ok: false, err: 'Nu există' } });
    try { await audit.fromReq(req, 'valorcalc.company_cost_delete', 'company_cost_item', String(id), {}); } catch {}
    return res.json({ result: { ok: true } });
  } catch (err) { console.error('vcalcCompanyCostDelete:', err); return res.json({ result: { ok: false, err: 'Eroare de server' } }); }
};

// ═══════════════════════════════════════════════════════════
//  4) KALKULÁTOR-BEÁLLÍTÁSOK (cégenkénti)
// ═══════════════════════════════════════════════════════════

async function _loadSettings(cid) {
  const r = await pool.query('SELECT * FROM company_calc_settings WHERE company_id=$1', [cid]);
  if (r.rowCount) return r.rows[0];
  // On-the-fly létrehozás default értékekkel — a Vallorcalc singleton-upsert mintája.
  const ins = await pool.query(
    `INSERT INTO company_calc_settings (company_id) VALUES ($1)
     ON CONFLICT (company_id) DO UPDATE SET updated_at=NOW() RETURNING *`, [cid]
  );
  return ins.rows[0];
}

handlers.vcalcSettingsGet = async function (req, res) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const s = await _loadSettings(_cid(req));
    return res.json({ result: { ok: true, settings: s } });
  } catch (err) { console.error('vcalcSettingsGet:', err); return res.json({ result: { ok: false, err: 'Eroare de server' } }); }
};

handlers.vcalcSettingsSave = async function (req, res, args) {
  try {
    if (!_am(req) || req.session.user.pozicio !== 'Admin')
      return res.json({ result: { ok: false, err: 'Doar Admin' } });
    const cid = _cid(req);
    const a = (args && args[0]) || {};
    const annual = _num(a.annual_km_target) ?? 120000;
    const weeks = _int(a.working_weeks_per_year) ?? 48;
    const exLei = _num(a.excisa_discount_lei);
    const exType = exLei != null ? _discType(a.excisa_discount_type) : null;
    const fdLei = _num(a.fuel_discount_lei);
    const fdType = fdLei != null ? _discType(a.fuel_discount_type) : null;
    const r = await pool.query(
      `INSERT INTO company_calc_settings (company_id, annual_km_target, working_weeks_per_year,
              excisa_discount_lei, excisa_discount_type, fuel_discount_lei, fuel_discount_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (company_id) DO UPDATE SET
         annual_km_target=$2, working_weeks_per_year=$3,
         excisa_discount_lei=$4, excisa_discount_type=$5,
         fuel_discount_lei=$6, fuel_discount_type=$7, updated_at=NOW()
       RETURNING *`,
      [cid, annual, weeks, exLei, exType, fdLei, fdType]
    );
    try { await audit.fromReq(req, 'valorcalc.settings_save', 'company_calc_settings', String(cid), {}); } catch {}
    return res.json({ result: { ok: true, settings: r.rows[0] } });
  } catch (err) { console.error('vcalcSettingsSave:', err); return res.json({ result: { ok: false, err: 'Eroare de server' } }); }
};

// ═══════════════════════════════════════════════════════════
//  5) VALLORSOFT-FORRÁS ELŐTÖLTÉS — egy fuvarból auto-fill
//     Ez a KAPCSOLÓS ("Vallorsoft adatok") mód szíve: egyetlen
//     RPC-vel visszaadja a kalkulátornak szükséges MINDEN
//     előszedett paramétert. A UI ezekkel tölti ki a formot,
//     de a felhasználó bármit felülírhat kalkuláció előtt.
// ═══════════════════════════════════════════════════════════

async function _vehicleByPlate(cid, plate) {
  if (!plate) return null;
  const norm = String(plate).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!norm) return null;
  const r = await pool.query(
    `SELECT id, rendszam, marca, tip, fuel_per_100km
     FROM vehicles WHERE company_id=$1
       AND UPPER(REGEXP_REPLACE(rendszam, '[^A-Za-z0-9]', '', 'g')) = $2
     LIMIT 1`, [cid, norm]
  );
  return r.rows[0] || null;
}

async function _driverByEmail(cid, email) {
  if (!email) return null;
  const r = await pool.query(
    "SELECT id, nume, email FROM users WHERE company_id=$1 AND LOWER(email)=LOWER($2) AND pozicio='Sofer' LIMIT 1",
    [cid, email]
  );
  return r.rows[0] || null;
}

// args: [{ order_id }]
handlers.vcalcPrefillFromOrder = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = _cid(req);
    const orderId = _str((args && args[0] || {}).order_id, 20);
    if (!orderId) return res.json({ result: { ok: false, err: 'ID cursă lipsă' } });
    const o = await pool.query(
      `SELECT id, client, ref, loc_incarcare, loc_descarcare, data_incarcare, data_descarcare,
              pret, km, email_sofer, rendszam_camion, rendszam_remorca, toll_cost
       FROM orders WHERE id=$1 AND company_id=$2`, [orderId, cid]
    );
    if (o.rowCount === 0) return res.json({ result: { ok: false, err: 'Cursă necunoscută' } });
    const ord = o.rows[0];

    const [truck, trailer, driver] = await Promise.all([
      _vehicleByPlate(cid, ord.rendszam_camion),
      _vehicleByPlate(cid, ord.rendszam_remorca),
      _driverByEmail(cid, ord.email_sofer),
    ]);

    // Trip-napok: data_descarcare - data_incarcare + 1 (min 1); ha hiányzik → 1
    let tripDays = 1;
    if (ord.data_incarcare && ord.data_descarcare) {
      const a = new Date(ord.data_incarcare), b = new Date(ord.data_descarcare);
      const diff = Math.round((b - a) / (1000 * 60 * 60 * 24)) + 1;
      if (Number.isFinite(diff) && diff > 0) tripDays = diff;
    }

    // Aktív vontatók számlálása (a cég-költség szétosztásához)
    const av = await pool.query(
      "SELECT COUNT(*)::int AS n FROM vehicles WHERE company_id=$1 AND (active IS NULL OR active=true)", [cid]
    );

    // BNR: cég override → élő BNR → 5.0 fallback
    let bnr = null;
    try {
      const cr = await pool.query('SELECT eur_ron_rate FROM companies WHERE id=$1', [cid]);
      if (cr.rows[0] && cr.rows[0].eur_ron_rate) bnr = Number(cr.rows[0].eur_ron_rate);
    } catch {}
    if (!bnr) { try { bnr = await fetchBnrEurRon(); } catch {} }
    if (!bnr || !Number.isFinite(Number(bnr))) bnr = 5.0;

    return res.json({ result: {
      ok: true,
      order: {
        id: ord.id, client: ord.client, ref: ord.ref,
        loc_incarcare: ord.loc_incarcare, loc_descarcare: ord.loc_descarcare,
        data_incarcare: ord.data_incarcare, data_descarcare: ord.data_descarcare,
        km: ord.km ? Number(ord.km) : null,
        pret: ord.pret ? Number(ord.pret) : null,
        toll_cost_eur: ord.toll_cost != null ? Number(ord.toll_cost) : null,
      },
      trip_days: tripDays,
      truck: truck,           // {id, rendszam, marca, tip, fuel_per_100km} vagy null
      trailer: trailer,
      driver: driver,         // {id, nume, email} vagy null
      active_trucks: (av.rows[0] && av.rows[0].n) || 1,
      bnr_eur_lei: Number(bnr),
    } });
  } catch (err) { console.error('vcalcPrefillFromOrder:', err); return res.json({ result: { ok: false, err: 'Eroare de server' } }); }
};

// ═══════════════════════════════════════════════════════════
//  6) KALKULÁLÁS + MENTÉS
// ═══════════════════════════════════════════════════════════

async function _buildEngineInput(cid, a, settings) {
  const truckId = _int(a.truck_vehicle_id);
  const trailerId = _int(a.trailer_vehicle_id);
  const driverIds = Array.isArray(a.driver_ids) ? a.driver_ids.map(_int).filter(Boolean) : [];

  // Cross-tenant védelem — ha van hivatkozás, MIND legyen a cégé.
  if (truckId && !(await _ownVehicle(cid, truckId))) throw new Error('Vehicul (cap tractor) invalid');
  if (trailerId && !(await _ownVehicle(cid, trailerId))) throw new Error('Vehicul (semiremorcă) invalid');
  for (const d of driverIds) { if (!(await _ownDriver(cid, d))) throw new Error('Șofer invalid'); }

  // Költség-tételek lehúzása — a felhasználó manuális kalkulációban is
  // szeretné a mentett tételeket használni (a UI dönti el, mit ad át).
  let truckCosts = [], trailerCosts = [];
  if (truckId) {
    const r = await pool.query(
      `SELECT name, basis_type, interval_km, interval_months, amount_lei, is_gross
       FROM vehicle_cost_items WHERE company_id=$1 AND vehicle_id=$2`, [cid, truckId]
    );
    truckCosts = r.rows.map(c => ({
      name: c.name, basisType: c.basis_type,
      intervalKm: c.interval_km != null ? Number(c.interval_km) : null,
      intervalMonths: c.interval_months,
      amountLei: Number(c.amount_lei), isGross: c.is_gross,
    }));
  }
  if (trailerId) {
    const r = await pool.query(
      `SELECT name, basis_type, interval_km, interval_months, amount_lei, is_gross
       FROM vehicle_cost_items WHERE company_id=$1 AND vehicle_id=$2`, [cid, trailerId]
    );
    trailerCosts = r.rows.map(c => ({
      name: c.name, basisType: c.basis_type,
      intervalKm: c.interval_km != null ? Number(c.interval_km) : null,
      intervalMonths: c.interval_months,
      amountLei: Number(c.amount_lei), isGross: c.is_gross,
    }));
  }
  let driverCosts = [];
  if (driverIds.length) {
    const r = await pool.query(
      `SELECT dci.name, dci.amount_lei, dci.is_gross, u.nume
       FROM driver_cost_items dci
       JOIN users u ON u.id = dci.driver_id
       WHERE dci.company_id=$1 AND dci.driver_id = ANY($2::int[])`,
      [cid, driverIds]
    );
    driverCosts = r.rows.map(c => ({
      name: (c.nume ? c.nume + ' – ' : '') + c.name,
      amountLei: Number(c.amount_lei), isGross: c.is_gross,
    }));
  }
  const cc = await pool.query(
    `SELECT name, basis_type, interval_months, amount_lei, is_gross
     FROM company_cost_items WHERE company_id=$1`, [cid]
  );
  const companyCosts = cc.rows.map(c => ({
    name: c.name, basisType: c.basis_type,
    intervalMonths: c.interval_months,
    amountLei: Number(c.amount_lei), isGross: c.is_gross,
  }));

  const bnr = _num(a.bnr_eur_lei) || 5.0;
  const freightIsGross = a.freight_revenue_is_gross == null ? true : _bool(a.freight_revenue_is_gross);
  const freightAmount = _num(a.freight_revenue_input);
  const freightCurrency = a.freight_revenue_currency === 'eur' ? 'eur' : 'lei';
  const { grossLei: freightGrossLei, grossEur: freightGrossEur } =
    computeFreightRevenue(freightAmount, freightCurrency, freightIsGross, bnr);

  const tolls = Array.isArray(a.tolls) ? a.tolls.map(t => ({
    amountLei: t.input_currency === 'eur' ? (_num(t.amount) || 0) * bnr : (_num(t.amount) || 0),
    description: _str(t.description, 200),
    input_currency: t.input_currency === 'eur' ? 'eur' : 'lei',
    amount: _num(t.amount) || 0,
  })) : [];

  const input = {
    tripKm: _num(a.trip_km) || 0,
    tripDays: _int(a.trip_days) || 1,
    annualKmTarget: Number(settings.annual_km_target) || 120000,
    workingWeeksPerYear: Number(settings.working_weeks_per_year) || 48,
    truckCosts, trailerCosts, driverCosts, companyCosts,
    fuelMethod: a.fuel_method === 'fixed' ? 'fixed' : 'per_liter',
    fuelLiterPer100km: _num(a.fuel_l_per_100km),
    fuelPricePerLiterGross: _num(a.fuel_price_gross),
    fuelTotalGross: _num(a.fuel_total_gross),
    excisaApplied: _bool(a.excisa_applied),
    excisaDiscountLei: settings.excisa_discount_lei != null ? Number(settings.excisa_discount_lei) : null,
    excisaDiscountType: settings.excisa_discount_type,
    fuelDiscountApplied: _bool(a.fuel_discount_applied),
    fuelDiscountLei: settings.fuel_discount_lei != null ? Number(settings.fuel_discount_lei) : null,
    fuelDiscountType: settings.fuel_discount_type,
    tolls: tolls.map(t => ({ amountLei: t.amountLei })),
    activeTrucksCount: _int(a.active_trucks) || 1,
    freightRevenueLei: freightGrossLei,
    bnrEurLei: bnr,
  };
  return { input, tolls, freightGrossLei, freightGrossEur, freightAmount, freightCurrency, freightIsGross, driverIds, truckId, trailerId, bnr };
}

async function _nextSerialNo(cid) {
  const d = new Date();
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  const prefix = `${y}${m}${day}`;
  for (let attempt = 0; attempt < 25; attempt++) {
    const r = await pool.query(
      "SELECT COUNT(*)::int AS n FROM cost_calculations WHERE company_id=$1 AND serial_no LIKE $2",
      [cid, prefix + '-%']
    );
    const candidate = `${prefix}-${String((r.rows[0].n || 0) + 1 + attempt).padStart(3, '0')}`;
    const exists = await pool.query('SELECT 1 FROM cost_calculations WHERE serial_no=$1', [candidate]);
    if (exists.rowCount === 0) return candidate;
  }
  return `${prefix}-${Date.now()}`;
}

// args: [{ ...form..., save?: bool }]
// Válasz: { ok, result, id?, serial_no? }
handlers.vcalcCalculate = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = _cid(req);
    const a = (args && args[0]) || {};
    const settings = await _loadSettings(cid);
    let built;
    try { built = await _buildEngineInput(cid, a, settings); }
    catch (e) { return res.json({ result: { ok: false, err: e.message || 'Date invalide' } }); }

    const orderId = a.order_id ? _str(a.order_id, 20) : null;
    if (orderId && !(await _ownOrder(cid, orderId))) return res.json({ result: { ok: false, err: 'Cursă invalidă' } });

    const result = calculate(built.input);
    const save = _bool(a.save);
    if (!save) return res.json({ result: { ok: true, result } });

    const serial = await _nextSerialNo(cid);
    const row = await pool.query(
      `INSERT INTO cost_calculations
        (company_id, created_by, name, source_mode, order_id, serial_no,
         truck_vehicle_id, trailer_vehicle_id, driver_ids,
         start_date, trip_days, trip_km,
         fuel_method, fuel_l_per_100km, fuel_price_gross, fuel_total_gross,
         excisa_applied, fuel_discount_applied, tolls_json, active_trucks,
         freight_revenue_input, freight_revenue_currency, freight_revenue_is_gross,
         freight_revenue_lei, freight_revenue_eur, bnr_eur_lei, result_json, saved_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20,$21,$22,$23,$24,$25,$26,$27::jsonb,NOW())
       RETURNING id, serial_no, created_at`,
      [
        cid, req.session.user.id || null, _str(a.name, 200), a.source_mode === 'vallorsoft' ? 'vallorsoft' : 'manual',
        orderId, serial,
        built.truckId, built.trailerId, JSON.stringify(built.driverIds),
        a.start_date || null, built.input.tripDays, built.input.tripKm,
        built.input.fuelMethod, built.input.fuelLiterPer100km, built.input.fuelPricePerLiterGross, built.input.fuelTotalGross,
        built.input.excisaApplied, built.input.fuelDiscountApplied, JSON.stringify(built.tolls), built.input.activeTrucksCount,
        built.freightAmount, built.freightAmount != null ? built.freightCurrency : null, built.freightIsGross,
        built.freightGrossLei, built.freightGrossEur, built.bnr, JSON.stringify(result),
      ]
    );
    try { await audit.fromReq(req, 'valorcalc.calc_save', 'cost_calculation', String(row.rows[0].id), { serial_no: serial, order_id: orderId }); } catch {}
    return res.json({ result: { ok: true, result, id: row.rows[0].id, serial_no: row.rows[0].serial_no } });
  } catch (err) { console.error('vcalcCalculate:', err); return res.json({ result: { ok: false, err: 'Eroare de server' } }); }
};

// args: [{ from?, to?, order_id? }]
handlers.vcalcCalcList = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = _cid(req);
    const a = (args && args[0]) || {};
    const params = [cid];
    let sql = `SELECT id, name, source_mode, order_id, serial_no, trip_km, trip_days,
                      freight_revenue_lei, bnr_eur_lei, saved_at, created_at,
                      (result_json->>'totalNetEur')::numeric AS total_net_eur,
                      (result_json->>'profitEur')::numeric AS profit_eur
               FROM cost_calculations
               WHERE company_id=$1 AND saved_at IS NOT NULL`;
    if (a.order_id) { params.push(_str(a.order_id, 20)); sql += ` AND order_id = $${params.length}`; }
    if (a.from) { params.push(a.from); sql += ` AND created_at >= $${params.length}`; }
    if (a.to) { params.push(a.to); sql += ` AND created_at <= $${params.length}`; }
    sql += ' ORDER BY created_at DESC LIMIT 500';
    const r = await pool.query(sql, params);
    return res.json({ result: { ok: true, items: r.rows } });
  } catch (err) { console.error('vcalcCalcList:', err); return res.json({ result: { ok: false, err: 'Eroare de server' } }); }
};

// args: [{ id }]
handlers.vcalcCalcGet = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = _cid(req);
    const id = _int((args && args[0] || {}).id);
    if (!id) return res.json({ result: { ok: false, err: 'ID lipsă' } });
    const r = await pool.query(
      'SELECT * FROM cost_calculations WHERE id=$1 AND company_id=$2', [id, cid]
    );
    if (r.rowCount === 0) return res.json({ result: { ok: false, err: 'Nu există' } });
    return res.json({ result: { ok: true, calc: r.rows[0] } });
  } catch (err) { console.error('vcalcCalcGet:', err); return res.json({ result: { ok: false, err: 'Eroare de server' } }); }
};

// args: [{ id }]
handlers.vcalcCalcDelete = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = _cid(req);
    const id = _int((args && args[0] || {}).id);
    if (!id) return res.json({ result: { ok: false, err: 'ID lipsă' } });
    const r = await pool.query('DELETE FROM cost_calculations WHERE id=$1 AND company_id=$2', [id, cid]);
    if (r.rowCount === 0) return res.json({ result: { ok: false, err: 'Nu există' } });
    try { await audit.fromReq(req, 'valorcalc.calc_delete', 'cost_calculation', String(id), {}); } catch {}
    return res.json({ result: { ok: true } });
  } catch (err) { console.error('vcalcCalcDelete:', err); return res.json({ result: { ok: false, err: 'Eroare de server' } }); }
};

// ═══════════════════════════════════════════════════════════
//  7) Segéd — fuvar-lista a picker-hez (aktív + nemrég lezárt)
// ═══════════════════════════════════════════════════════════

handlers.vcalcOrderPicker = async function (req, res) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = _cid(req);
    const r = await pool.query(
      `SELECT id, client, ref, loc_incarcare, loc_descarcare,
              data_incarcare, data_descarcare, km, pret, status, rendszam_camion
       FROM orders
       WHERE company_id=$1 AND status <> 'Anulat'
       ORDER BY COALESCE(data_incarcare, created_at) DESC LIMIT 200`, [cid]
    );
    return res.json({ result: { ok: true, orders: r.rows } });
  } catch (err) { console.error('vcalcOrderPicker:', err); return res.json({ result: { ok: false, err: 'Eroare de server' } }); }
};

// ═══════════════════════════════════════════════════════════
//  8) Jármű + sofőr rövid lista (dropdown feltöltéshez)
// ═══════════════════════════════════════════════════════════

handlers.vcalcRefLists = async function (req, res) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = _cid(req);
    const [vehR, drvR] = await Promise.all([
      pool.query('SELECT id, rendszam, marca, tip, fuel_per_100km FROM vehicles WHERE company_id=$1 ORDER BY rendszam', [cid]),
      pool.query("SELECT id, nume, email FROM users WHERE company_id=$1 AND pozicio='Sofer' ORDER BY nume", [cid]),
    ]);
    return res.json({ result: { ok: true, vehicles: vehR.rows, drivers: drvR.rows } });
  } catch (err) { console.error('vcalcRefLists:', err); return res.json({ result: { ok: false, err: 'Eroare de server' } }); }
};

module.exports = handlers;
