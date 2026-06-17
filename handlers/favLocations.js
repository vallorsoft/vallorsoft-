// ============================================================
//  VallorSoft — handlers/favLocations.js
//  Kedvenc helyszínek (gyakran használt felrakó/lerakó címek) — RPC.
//  Multi-tenant: minden lekérdezés company_id-szűrt, paraméteres SQL.
//  Lista: bármely belépett felhasználó; írás: csak Admin/Manager.
// ============================================================
const pool = require('../db');
const audit = require('../lib/audit');

const handlers = {};

function _am(req) { return req.session.user && ['Admin', 'Manager'].includes(req.session.user.pozicio); }
function _str(x, n) { const s = x == null ? null : String(x).trim().slice(0, n); return s || null; }
function _num(x) { if (x === '' || x == null) return null; const n = Number(x); return Number.isFinite(n) ? n : null; }

const TYPES = ['load', 'unload', 'both'];

// Lista — bármely belépett felhasználó a saját cégéé
handlers.favLocationList = async function (req, res) {
  try {
    if (!req.session.user) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = req.session.user.company_id;
    const r = await pool.query(
      `SELECT id, label, address, lat, lng, type, created_at
       FROM favorite_locations WHERE company_id=$1 ORDER BY label`, [cid]);
    return res.json({ result: { ok: true, items: r.rows } });
  } catch (err) { console.error('favLocationList hiba:', err); return res.json({ result: { ok: false, err: 'Eroare de server' } }); }
};

// args: [{ id?, label, address, lat?, lng?, type? }]
handlers.favLocationSave = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = req.session.user.company_id;
    const a = (args && args[0]) || {};
    const label = _str(a.label, 120);
    const address = _str(a.address, 300);
    if (!label) return res.json({ result: { ok: false, err: 'Eticheta este obligatorie.' } });
    if (!address) return res.json({ result: { ok: false, err: 'Adresa este obligatorie.' } });
    const type = TYPES.includes(a.type) ? a.type : 'both';
    const lat = _num(a.lat), lng = _num(a.lng);
    if (a.id) {
      const id = parseInt(a.id, 10);
      const r = await pool.query(
        `UPDATE favorite_locations SET label=$1, address=$2, lat=$3, lng=$4, type=$5
         WHERE id=$6 AND company_id=$7`,
        [label, address, lat, lng, type, id, cid]);
      if (!r.rowCount) return res.json({ result: { ok: false, err: 'Nu a fost găsit.' } });
      audit.fromReq(req, 'fav_location.update', 'favorite_location', id, { label });
      return res.json({ result: { ok: true, id } });
    }
    const ins = await pool.query(
      `INSERT INTO favorite_locations (company_id, label, address, lat, lng, type)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [cid, label, address, lat, lng, type]);
    audit.fromReq(req, 'fav_location.create', 'favorite_location', ins.rows[0].id, { label });
    return res.json({ result: { ok: true, id: ins.rows[0].id } });
  } catch (err) { console.error('favLocationSave hiba:', err); return res.json({ result: { ok: false, err: 'Eroare de server' } }); }
};

// args: [id]
handlers.favLocationDelete = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = req.session.user.company_id;
    const id = parseInt(args && args[0], 10);
    if (!id) return res.json({ result: { ok: false, err: 'ID-ul este obligatoriu.' } });
    const r = await pool.query('DELETE FROM favorite_locations WHERE id=$1 AND company_id=$2', [id, cid]);
    if (r.rowCount) audit.fromReq(req, 'fav_location.delete', 'favorite_location', id, null);
    return res.json({ result: { ok: !!r.rowCount } });
  } catch (err) { console.error('favLocationDelete hiba:', err); return res.json({ result: { ok: false, err: 'Eroare de server' } }); }
};

module.exports = handlers;
