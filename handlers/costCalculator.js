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
const { featureEnabled } = require('../lib/featureEnabled');
const { computeOrderToll } = require('../lib/orderToll');
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
//  3.5) VALORCALC ALAPÉRTELMEZETT TÉTELEK — betöltő
//  A Vallorcalc DEFAULT_TRUCK_COSTS / DEFAULT_TRAILER_COSTS /
//  DEFAULT_DRIVER_COSTS bit-pontos átemelése (adatvezérelt).
// ═══════════════════════════════════════════════════════════

const DEFAULT_TRUCK_COSTS = [
  { name: 'Gumiabroncs',       basis_type: 'km',   interval_km: 240000, interval_months: null, amount_lei: 12600, is_gross: true },
  { name: 'Szerviz (revisie)', basis_type: 'km',   interval_km:  80000, interval_months: null, amount_lei:  2450, is_gross: true },
  { name: 'RCA biztosítás',    basis_type: 'time', interval_km: null,   interval_months: 12,   amount_lei: 12000, is_gross: true },
  { name: 'CASCO biztosítás',  basis_type: 'time', interval_km: null,   interval_months: 12,   amount_lei:  7200, is_gross: true },
  { name: 'Fékbetét',          basis_type: 'time', interval_km: null,   interval_months: 12,   amount_lei:  1000, is_gross: true },
  { name: 'Féktárcsa',         basis_type: 'time', interval_km: null,   interval_months: 24,   amount_lei:  2000, is_gross: true },
  { name: 'Lízing',            basis_type: 'time', interval_km: null,   interval_months:  1,   amount_lei:  4300, is_gross: true },
  { name: 'Karbantartás',      basis_type: 'time', interval_km: null,   interval_months: 12,   amount_lei:  7000, is_gross: true },
  { name: 'Váratlan szerviz',  basis_type: 'time', interval_km: null,   interval_months: 12,   amount_lei: 15000, is_gross: true },
];
const DEFAULT_TRAILER_COSTS = [
  { name: 'Gumiabroncs',      basis_type: 'km',   interval_km: 240000, interval_months: null, amount_lei: 10800, is_gross: true },
  { name: 'RCA biztosítás',   basis_type: 'time', interval_km: null,   interval_months: 12,   amount_lei:   500, is_gross: true },
  { name: 'CASCO biztosítás', basis_type: 'time', interval_km: null,   interval_months: 12,   amount_lei:  2200, is_gross: true },
  { name: 'Fékbetét',         basis_type: 'time', interval_km: null,   interval_months: 12,   amount_lei:  1650, is_gross: true },
  { name: 'Féktárcsa',        basis_type: 'time', interval_km: null,   interval_months: 24,   amount_lei:  3450, is_gross: true },
  { name: 'Lízing',           basis_type: 'time', interval_km: null,   interval_months:  1,   amount_lei:  2150, is_gross: true },
];
const DEFAULT_DRIVER_COSTS = [
  { name: 'Fizetés (bruttó)',   amount_lei: 5000, is_gross: true  },
  { name: 'Napidíj (diurna)',   amount_lei: 9000, is_gross: false },
  { name: 'Alkalmazott adók',   amount_lei: 2070, is_gross: false },
];

function _isTrailerVehicle(veh) {
  const t = String(veh && veh.tip || '').toLowerCase();
  return t.indexOf('remorc') !== -1 || t.indexOf('pótkocsi') !== -1 || t.indexOf('potkocsi') !== -1 || t.indexOf('trailer') !== -1;
}

// args: [{ vehicle_id, replace? }]
handlers.vcalcVehicleCostSeedDefaults = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = _cid(req);
    const a = (args && args[0]) || {};
    const vehicle_id = _int(a.vehicle_id);
    if (!vehicle_id) return res.json({ result: { ok: false, err: 'Vehicul lipsă' } });
    const vr = await pool.query('SELECT id, rendszam, marca, tip FROM vehicles WHERE id=$1 AND company_id=$2', [vehicle_id, cid]);
    if (vr.rowCount === 0) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const veh = vr.rows[0];
    const defaults = _isTrailerVehicle(veh) ? DEFAULT_TRAILER_COSTS : DEFAULT_TRUCK_COSTS;
    if (a.replace) await pool.query('DELETE FROM vehicle_cost_items WHERE vehicle_id=$1 AND company_id=$2', [vehicle_id, cid]);
    let inserted = 0;
    for (const it of defaults) {
      await pool.query(
        `INSERT INTO vehicle_cost_items (company_id, vehicle_id, name, basis_type, interval_km, interval_months, amount_lei, is_gross)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [cid, vehicle_id, it.name, it.basis_type, it.interval_km, it.interval_months, it.amount_lei, it.is_gross]
      );
      inserted++;
    }
    try { await audit.fromReq(req, 'valorcalc.vehicle_cost_seed', 'vehicle', String(vehicle_id), { inserted, kind: _isTrailerVehicle(veh) ? 'trailer' : 'truck', replaced: !!a.replace }); } catch {}
    return res.json({ result: { ok: true, inserted, kind: _isTrailerVehicle(veh) ? 'trailer' : 'truck' } });
  } catch (err) { console.error('vcalcVehicleCostSeedDefaults:', err); return res.json({ result: { ok: false, err: 'Eroare de server' } }); }
};

// args: [{ driver_id, replace? }]
handlers.vcalcDriverCostSeedDefaults = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = _cid(req);
    const a = (args && args[0]) || {};
    const driver_id = _int(a.driver_id);
    if (!driver_id) return res.json({ result: { ok: false, err: 'Șofer lipsă' } });
    if (!(await _ownDriver(cid, driver_id))) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    if (a.replace) await pool.query('DELETE FROM driver_cost_items WHERE driver_id=$1 AND company_id=$2', [driver_id, cid]);
    let inserted = 0;
    for (const it of DEFAULT_DRIVER_COSTS) {
      await pool.query(
        `INSERT INTO driver_cost_items (company_id, driver_id, name, amount_lei, is_gross)
         VALUES ($1,$2,$3,$4,$5)`,
        [cid, driver_id, it.name, it.amount_lei, it.is_gross]
      );
      inserted++;
    }
    try { await audit.fromReq(req, 'valorcalc.driver_cost_seed', 'driver', String(driver_id), { inserted, replaced: !!a.replace }); } catch {}
    return res.json({ result: { ok: true, inserted } });
  } catch (err) { console.error('vcalcDriverCostSeedDefaults:', err); return res.json({ result: { ok: false, err: 'Eroare de server' } }); }
};

// args: [{ replace? }]
handlers.vcalcCompanyCostSeedDefaults = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = _cid(req);
    const a = (args && args[0]) || {};
    // A Vallorcalc-ban NEM voltak hardcodolt cég-defaultok — a felhasználó
    // maga vitte fel. Itt egy általános RO transzport-cég sablon-készletet
    // adunk, amit később bármikor módosíthat / törölhet.
    const DEFAULTS = [
      { name: 'Iroda bérleti díja',    basis_type: 'time', interval_months:  1, amount_lei:  1500, is_gross: true },
      { name: 'Könyvelő',              basis_type: 'time', interval_months:  1, amount_lei:  1200, is_gross: true },
      { name: 'Adminisztrátor bér',    basis_type: 'time', interval_months:  1, amount_lei:  4000, is_gross: true },
      { name: 'Kommunikáció (tel/net)',basis_type: 'time', interval_months:  1, amount_lei:   400, is_gross: true },
      { name: 'Banki költségek',       basis_type: 'time', interval_months:  1, amount_lei:   250, is_gross: true },
      { name: 'Licenc-ek (soft/CMR)',  basis_type: 'time', interval_months: 12, amount_lei:  3000, is_gross: true },
    ];
    if (a.replace) await pool.query('DELETE FROM company_cost_items WHERE company_id=$1', [cid]);
    let inserted = 0;
    for (const it of DEFAULTS) {
      await pool.query(
        `INSERT INTO company_cost_items (company_id, name, basis_type, interval_months, amount_lei, is_gross)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [cid, it.name, it.basis_type, it.interval_months, it.amount_lei, it.is_gross]
      );
      inserted++;
    }
    try { await audit.fromReq(req, 'valorcalc.company_cost_seed', 'company', String(cid), { inserted, replaced: !!a.replace }); } catch {}
    return res.json({ result: { ok: true, inserted } });
  } catch (err) { console.error('vcalcCompanyCostSeedDefaults:', err); return res.json({ result: { ok: false, err: 'Eroare de server' } }); }
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
    const cid = _cid(req);
    const s = await _loadSettings(cid);
    // A kalkulátor BNR-alapértéke: a cég rögzített árfolyama (companies.eur_ron_rate),
    // ha nincs, az élő BNR. (A kliens eddig egy nem létező mezőt olvasott → mindig 5.0.)
    let bnr = null;
    try {
      const cr = await pool.query('SELECT eur_ron_rate FROM companies WHERE id=$1', [cid]);
      if (cr.rows[0] && cr.rows[0].eur_ron_rate) bnr = Number(cr.rows[0].eur_ron_rate);
    } catch {}
    if (!bnr) { try { bnr = await fetchBnrEurRon(); } catch {} }
    return res.json({ result: { ok: true, settings: Object.assign({}, s, { eur_ron_rate: bnr && Number.isFinite(Number(bnr)) ? Number(bnr) : null }) } });
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

// Az utolsó 90 nap menetleveleinek gázolaj-tankolásaiból számolt átlagos
// BRUTTÓ ár (RON/liter) — a kalkulátor üzemanyag-ár mezőjének javaslata.
// Csak RON/LEI pénznemű (vagy pénznem nélküli), Motorină / típus nélküli
// sorok; az AdBlue kimarad. Best-effort: hiba vagy adat-hiány → null.
async function _avgFuelPriceRon(cid) {
  try {
    const r = await pool.query(
      `SELECT SUM(NULLIF(a->>'suma','')::numeric) AS suma, SUM(NULLIF(a->>'litru','')::numeric) AS litru
       FROM fuvarlevelek f, jsonb_array_elements(COALESCE(f.alimentari, '[]'::jsonb)) a
       WHERE f.company_id = $1
         AND COALESCE(f.erkezes_dt, f.indulas_dt, f.data_completare) >= NOW() - INTERVAL '90 days'
         AND jsonb_typeof(f.alimentari) = 'array'
         AND COALESCE(a->>'tip', '') NOT ILIKE '%adblue%'
         AND UPPER(COALESCE(NULLIF(a->>'valuta',''), 'RON')) IN ('RON', 'LEI')
         AND COALESCE(a->>'litru','') ~ '^[0-9]+([.][0-9]+)?$'
         AND COALESCE(a->>'suma','') ~ '^[0-9]+([.][0-9]+)?$'`, [cid]
    );
    const row = r.rows[0] || {};
    const suma = Number(row.suma), litru = Number(row.litru);
    if (!(litru > 0) || !(suma > 0)) return null;
    const p = suma / litru;
    // Józan-ész sáv — ennél kisebb/nagyobb érték elírásra utal.
    return (p >= 3 && p <= 20) ? Math.round(p * 100) / 100 : null;
  } catch (e) { console.warn('vcalc _avgFuelPriceRon:', e.message); return null; }
}

const MAX_ORDERS = 20;

// YYYY-MM-DD szövegek közti napok száma (+1, min 1) — UTC-éjfélként értelmezve,
// így nincs DST-/időzóna-csúszás.
function _daysBetween(from, to) {
  if (!from || !to) return 1;
  const a = Date.parse(from + 'T00:00:00Z'), b = Date.parse(to + 'T00:00:00Z');
  const diff = Math.round((b - a) / 86400000) + 1;
  return Number.isFinite(diff) && diff > 0 ? diff : 1;
}

function _uniqIds(list) {
  const out = [];
  for (const x of (Array.isArray(list) ? list : [])) {
    const id = _str(x, 20);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

// A kalkulátornak kellő fuvar-adatok (cégre szűrve). A dátumokat SZÖVEGKÉNT
// adjuk vissza (YYYY-MM-DD) — a pg a DATE-et JS Date-ként (helyi éjfél) adná,
// ami JSON-ban UTC-re csúszva egy nappal korábbi dátumot mutatna. Az
// opcionális oszlopokat `to_jsonb(o)` mintával olvassuk (hiányzó → NULL).
async function _loadOrdersForCalc(cid, ids) {
  const r = await pool.query(
    `SELECT id, client, ref, loc_incarcare, loc_descarcare,
            to_char(data_incarcare, 'YYYY-MM-DD') AS data_incarcare,
            to_char(data_descarcare, 'YYYY-MM-DD') AS data_descarcare,
            pret, km, email_sofer, rendszam_camion, rendszam_remorca, status, sofer_type,
            (to_jsonb(o) ->> 'fuvar_no') AS fuvar_no,
            (to_jsonb(o) ->> 'toll_cost') AS toll_cost,
            (to_jsonb(o) -> 'route_geo' ->> 'km') AS route_km,
            (to_jsonb(o) ->> 'carrier_cost') AS carrier_cost
     FROM orders o WHERE company_id=$1 AND id = ANY($2::varchar[])`, [cid, ids]
  );
  const byId = {};
  for (const row of (r.rows || [])) byId[row.id] = row;
  return ids.map(id => byId[id]).filter(Boolean);
}

function _orderView(ord) {
  // Km: a fuvar km-e; ha 0/üres, a térképes útvonal-becslés (route_geo.km).
  const orderKm = Number(ord.km) > 0 ? Number(ord.km) : null;
  const routeKm = Number(ord.route_km) > 0 ? Number(ord.route_km) : null;
  return {
    id: ord.id, fuvar_no: ord.fuvar_no || null, client: ord.client, ref: ord.ref,
    status: ord.status,
    loc_incarcare: ord.loc_incarcare, loc_descarcare: ord.loc_descarcare,
    data_incarcare: ord.data_incarcare, data_descarcare: ord.data_descarcare,
    km: orderKm || routeKm, km_source: orderKm ? 'order' : (routeKm ? 'route' : null),
    // A fuvar ára NETTÓ EUR (a teljes rendszerben így tároljuk).
    pret: ord.pret != null && Number(ord.pret) > 0 ? Number(ord.pret) : null,
    toll_cost_eur: ord.toll_cost != null && Number(ord.toll_cost) > 0 ? Number(ord.toll_cost) : null,
    // Extern (alvállalkozós) fuvar — a saját jármű-költség nem releváns.
    is_extern: ord.status === 'Extern' || ord.sofer_type === 'Extern',
    carrier_cost_eur: ord.carrier_cost != null && Number(ord.carrier_cost) > 0 ? Number(ord.carrier_cost) : null,
    rendszam_camion: ord.rendszam_camion || null,
  };
}

// Aktív VONTATÓK száma (a cég-költség szétosztásához).
// FIGYELEM: az oszlop neve `activ` (RO), NEM `active`. Hiba esetén csendes
// fallback: legalább 1 aktív vontató — a prefill nem bukhat el miatta.
async function _activeTrucks(cid) {
  try {
    const av = await pool.query(
      "SELECT COUNT(*)::int AS n FROM vehicles WHERE company_id=$1 AND tip='Vontato' AND COALESCE(activ, true) = true", [cid]
    );
    return (av.rows[0] && av.rows[0].n) || 1;
  } catch (avErr) { console.warn('vcalc active-trucks count:', avErr.message); return 1; }
}

// BNR: cég override → élő BNR → 5.0 fallback
async function _bnr(cid) {
  let bnr = null;
  try {
    const cr = await pool.query('SELECT eur_ron_rate FROM companies WHERE id=$1', [cid]);
    if (cr.rows[0] && cr.rows[0].eur_ron_rate) bnr = Number(cr.rows[0].eur_ron_rate);
  } catch {}
  if (!bnr) { try { bnr = await fetchBnrEurRon(); } catch {} }
  if (!bnr || !Number.isFinite(Number(bnr))) bnr = 5.0;
  return Number(bnr);
}

// Egy vagy több fuvar összevont előtöltése. Visszaad: fuvaronkénti nézetet,
// összesített km/útdíj/bevételt, az időszakot (legkorábbi felrakás → legkésőbbi
// lerakás), és az első feloldható vontatót/pótkocsit + minden sofőrt.
async function _prefillCore(cid, ids) {
  const rows = await _loadOrdersForCalc(cid, ids);
  if (!rows.length || rows.length !== ids.length) return null;
  const orders = rows.map(_orderView)
    .sort((x, y) => String(x.data_incarcare || x.data_descarcare || '9999').localeCompare(String(y.data_incarcare || y.data_descarcare || '9999')));

  // Járművek / sofőrök — fuvaronként feloldva, egyedi listába gyűjtve.
  const trucks = [], trailers = [], drivers = [];
  const pushU = (arr, x) => { if (x && !arr.some(e => e.id === x.id)) arr.push(x); };
  for (const ord of rows) {
    const [tr, tl, dr] = await Promise.all([
      _vehicleByPlate(cid, ord.rendszam_camion),
      _vehicleByPlate(cid, ord.rendszam_remorca),
      _driverByEmail(cid, ord.email_sofer),
    ]);
    pushU(trucks, tr); pushU(trailers, tl); pushU(drivers, dr);
  }

  const starts = orders.map(o => o.data_incarcare || o.data_descarcare).filter(Boolean).sort();
  const ends = orders.map(o => o.data_descarcare || o.data_incarcare).filter(Boolean).sort();
  const periodFrom = starts[0] || null;
  const periodTo = ends.length ? ends[ends.length - 1] : periodFrom;
  const sum = (k) => orders.reduce((acc, o) => acc + (Number(o[k]) || 0), 0);

  return {
    orders,
    totals: {
      km: sum('km') || null,
      toll_cost_eur: sum('toll_cost_eur') || null,
      pret: orders.some(o => o.pret != null) ? sum('pret') : null,
      carrier_cost_eur: sum('carrier_cost_eur') || null,
      missing_km: orders.filter(o => !o.km).length,
      missing_price: orders.filter(o => o.pret == null).length,
      extern: orders.filter(o => o.is_extern).length,
    },
    period_from: periodFrom,
    period_to: periodTo,
    trip_days: _daysBetween(periodFrom, periodTo),
    truck: trucks[0] || null, trailer: trailers[0] || null, driver: drivers[0] || null,
    trucks, trailers, drivers,
    active_trucks: await _activeTrucks(cid),
    bnr_eur_lei: await _bnr(cid),
    fuel_price_gross: await _avgFuelPriceRon(cid), // RON/l bruttó javaslat vagy null
  };
}

// args: [{ order_id }] — egy fuvar (a chat `vcalc.order_cost` is ezt hívja; a
// válasz-alak változatlan: order/trip_days/truck/trailer/driver/...).
handlers.vcalcPrefillFromOrder = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = _cid(req);
    const orderId = _str((args && args[0] || {}).order_id, 20);
    if (!orderId) return res.json({ result: { ok: false, err: 'ID cursă lipsă' } });
    const p = await _prefillCore(cid, [orderId]);
    if (!p) return res.json({ result: { ok: false, err: 'Cursă necunoscută' } });
    return res.json({ result: {
      ok: true, order: p.orders[0], trip_days: p.trip_days,
      truck: p.truck, trailer: p.trailer, driver: p.driver,
      active_trucks: p.active_trucks, bnr_eur_lei: p.bnr_eur_lei, fuel_price_gross: p.fuel_price_gross,
    } });
  } catch (err) { console.error('vcalcPrefillFromOrder:', err); return res.json({ result: { ok: false, err: 'Eroare de server' } }); }
};

// args: [{ order_ids: [...] }] — több fuvar ÖSSZEVONT kalkulációja (pl. 2 fuvar
// egy hét alatt). km/útdíj/bevétel összeadva, időszak = min felrakás → max lerakás.
handlers.vcalcPrefillFromOrders = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = _cid(req);
    const ids = _uniqIds((args && args[0] || {}).order_ids);
    if (!ids.length) return res.json({ result: { ok: false, err: 'Alege cel puțin o cursă' } });
    if (ids.length > MAX_ORDERS) return res.json({ result: { ok: false, err: 'Maxim ' + MAX_ORDERS + ' curse într-un calcul' } });
    const p = await _prefillCore(cid, ids);
    if (!p) return res.json({ result: { ok: false, err: 'Cursă necunoscută' } });
    return res.json({ result: Object.assign({ ok: true }, p) });
  } catch (err) { console.error('vcalcPrefillFromOrders:', err); return res.json({ result: { ok: false, err: 'Eroare de server' } }); }
};

// args: [{ order_ids: [...], precise?: bool }] — útdíj fuvaronként az útvonalból:
// „Pontos" = HERE (ha a cégnek van HERE-kulcsa), különben ingyenes becslés.
// NEM írja a fuvarba (a kalkuláció csak számol); a fuvar-szerkesztő 🛣️ gombja ment.
handlers.vcalcEstimateTolls = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = _cid(req);
    if (!(await featureEnabled(cid, 'toll-becsles')))
      return res.json({ result: { ok: false, err: 'Functie nedisponibila in pachetul curent.' } });
    const a = (args && args[0]) || {};
    const ids = _uniqIds(a.order_ids);
    if (!ids.length) return res.json({ result: { ok: false, err: 'Alege cel puțin o cursă' } });
    if (ids.length > MAX_ORDERS) return res.json({ result: { ok: false, err: 'Maxim ' + MAX_ORDERS + ' curse într-un calcul' } });
    const r = await pool.query(
      `SELECT id, loc_incarcare, loc_descarcare, route_geo, (to_jsonb(o) ->> 'fuvar_no') AS fuvar_no
       FROM orders o WHERE company_id=$1 AND id = ANY($2::varchar[])`, [cid, ids]
    );
    if (r.rows.length !== ids.length) return res.json({ result: { ok: false, err: 'Cursă necunoscută' } });
    const byId = {}; r.rows.forEach(o => { byId[o.id] = o; });
    const items = [];
    // Sorban (nem párhuzamosan) — a HERE / geokódoló rate-limit miatt.
    for (const id of ids) {
      const o = byId[id];
      try {
        const out = await computeOrderToll(cid, o, { precise: !!a.precise });
        items.push({ order_id: id, fuvar_no: o.fuvar_no || null, ok: true,
          amount: Number(out.toll.total) || 0, currency: out.toll.currency || 'EUR',
          source: out.source, precise_error: out.preciseError || null, km: out.km });
      } catch (e) {
        items.push({ order_id: id, fuvar_no: o.fuvar_no || null, ok: false, err: (e && e.message) || 'Eroare' });
      }
    }
    return res.json({ result: { ok: true, items } });
  } catch (err) { console.error('vcalcEstimateTolls:', err); return res.json({ result: { ok: false, err: 'Eroare de server' } }); }
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

    // Fuvar(ok): `order_ids` (összevont kalkuláció) VAGY a régi egy `order_id`.
    const orderIds = _uniqIds(Array.isArray(a.order_ids) && a.order_ids.length ? a.order_ids : (a.order_id ? [a.order_id] : []));
    if (orderIds.length > MAX_ORDERS) return res.json({ result: { ok: false, err: 'Maxim ' + MAX_ORDERS + ' curse într-un calcul' } });
    for (const oid of orderIds) {
      if (!(await _ownOrder(cid, oid))) return res.json({ result: { ok: false, err: 'Cursă invalidă' } });
    }
    const orderId = orderIds[0] || null;

    // Km: ha a felhasználó beírta, azzal számolunk; ha nem, a fuvarok km-ének
    // összegével (fuvar km, különben a térképes útvonal-becslés).
    if (!(built.input.tripKm > 0) && orderIds.length) {
      const rows = await _loadOrdersForCalc(cid, orderIds);
      const km = rows.map(_orderView).reduce((acc, o) => acc + (Number(o.km) || 0), 0);
      if (km > 0) built.input.tripKm = km;
    }
    if (!(built.input.tripKm > 0)) return res.json({ result: { ok: false, err: 'Kilometrajul este obligatoriu' } });

    // Időszak (pl. 2 fuvar egy hét alatt) — a napok száma ebből jön, ha nincs megadva.
    const isoD = (x) => (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x)) ? x : null;
    const periodFrom = isoD(a.period_from) || isoD(a.start_date);
    let periodTo = isoD(a.period_to);
    if (periodFrom && periodTo && periodTo < periodFrom) periodTo = periodFrom;
    if (!_int(a.trip_days) && periodFrom && periodTo) built.input.tripDays = _daysBetween(periodFrom, periodTo);

    const result = calculate(built.input);
    const save = _bool(a.save);
    if (!save) return res.json({ result: { ok: true, result } });

    const serial = await _nextSerialNo(cid);
    const baseParams = [
      cid, req.session.user.id || null, _str(a.name, 200), (a.source_mode === 'vallorsoft' || orderIds.length) ? 'vallorsoft' : 'manual',
      orderId, serial,
      built.truckId, built.trailerId, JSON.stringify(built.driverIds),
      periodFrom || null, built.input.tripDays, built.input.tripKm,
      built.input.fuelMethod, built.input.fuelLiterPer100km, built.input.fuelPricePerLiterGross, built.input.fuelTotalGross,
      built.input.excisaApplied, built.input.fuelDiscountApplied, JSON.stringify(built.tolls), built.input.activeTrucksCount,
      built.freightAmount, built.freightAmount != null ? built.freightCurrency : null, built.freightIsGross,
      built.freightGrossLei, built.freightGrossEur, built.bnr, JSON.stringify(result),
    ];
    const COLS = `company_id, created_by, name, source_mode, order_id, serial_no,
         truck_vehicle_id, trailer_vehicle_id, driver_ids,
         start_date, trip_days, trip_km,
         fuel_method, fuel_l_per_100km, fuel_price_gross, fuel_total_gross,
         excisa_applied, fuel_discount_applied, tolls_json, active_trucks,
         freight_revenue_input, freight_revenue_currency, freight_revenue_is_gross,
         freight_revenue_lei, freight_revenue_eur, bnr_eur_lei, result_json`;
    const VALS = `$1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20,$21,$22,$23,$24,$25,$26,$27::jsonb`;
    let row;
    try {
      row = await pool.query(
        `INSERT INTO cost_calculations (${COLS}, order_ids, period_from, period_to, saved_at)
         VALUES (${VALS}, $28::jsonb, $29, $30, NOW()) RETURNING id, serial_no, created_at`,
        baseParams.concat([JSON.stringify(orderIds), periodFrom || null, periodTo || null]));
    } catch (e) {
      // Migráció (db/zz-cost-calc-multi-order.sql) még nem futott → régi oszlopkészlet.
      if (e && e.code !== '42703') throw e;
      row = await pool.query(
        `INSERT INTO cost_calculations (${COLS}, saved_at) VALUES (${VALS}, NOW()) RETURNING id, serial_no, created_at`,
        baseParams);
    }
    try { await audit.fromReq(req, 'valorcalc.calc_save', 'cost_calculation', String(row.rows[0].id), { serial_no: serial, order_id: orderId, order_ids: orderIds }); } catch {}
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
                      (result_json->>'profitEur')::numeric AS profit_eur,
                      COALESCE(to_jsonb(cc) -> 'order_ids', '[]'::jsonb) AS order_ids,
                      (to_jsonb(cc) ->> 'period_from') AS period_from,
                      (to_jsonb(cc) ->> 'period_to') AS period_to
               FROM cost_calculations cc
               WHERE company_id=$1 AND saved_at IS NOT NULL`;
    if (a.order_id) {
      params.push(_str(a.order_id, 20));
      sql += ` AND (order_id = $${params.length} OR COALESCE(to_jsonb(cc) -> 'order_ids', '[]'::jsonb) @> jsonb_build_array($${params.length}::text))`;
    }
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
              to_char(data_incarcare, 'YYYY-MM-DD') AS data_incarcare,
              to_char(data_descarcare, 'YYYY-MM-DD') AS data_descarcare,
              km, pret, status, rendszam_camion,
              (to_jsonb(o) ->> 'fuvar_no') AS fuvar_no,
              (to_jsonb(o) -> 'route_geo' ->> 'km') AS route_km
       FROM orders o
       WHERE company_id=$1 AND status <> 'Anulat'
       ORDER BY COALESCE(data_incarcare, created_at::date) DESC, created_at DESC LIMIT 300`, [cid]
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
      pool.query('SELECT id, rendszam, marca, tip, activ, fuel_per_100km, assigned_driver_email, default_trailer_id FROM vehicles WHERE company_id=$1 ORDER BY rendszam', [cid]),
      pool.query("SELECT id, nume, email FROM users WHERE company_id=$1 AND pozicio='Sofer' ORDER BY nume", [cid]),
    ]);
    return res.json({ result: { ok: true, vehicles: vehR.rows, drivers: drvR.rows } });
  } catch (err) { console.error('vcalcRefLists:', err); return res.json({ result: { ok: false, err: 'Eroare de server' } }); }
};

module.exports = handlers;
