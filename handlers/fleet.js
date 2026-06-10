// ============================================================
//  VallorSoft — handlers/fleet.js
//  AUTO-KIVÁGOTT a régi server.js /api/execute ágaiból.
//  A handler-törzsek BÁJTRA AZONOSAK az eredetivel.
//  Hívás: handlers.<funkcioNev>(req, res, args)
// ============================================================
const pool = require('../db');

const handlers = {};

// --- Segédfüggvények a teherjármű-paraméterekhez (HERE routing) ---
function _intOrNull(x) {
  if (x === '' || x === null || x === undefined) return null;
  const n = parseInt(x, 10);
  return Number.isFinite(n) ? n : null;
}
function _numOrNull(x) {
  if (x === '' || x === null || x === undefined) return null;
  const n = parseFloat(x);
  return Number.isFinite(n) ? n : null;
}
function _enumOrNull(x, allowed) {
  if (x === null || x === undefined) return null;
  const s = String(x).trim();
  return allowed.includes(s) ? s : null;
}
const TRUCK_TYPES = ['straight', 'tractor', 'lightTruck'];
const TUNNEL_CATS = ['B', 'C', 'D', 'E'];
const HAZMAT_KINDS = ['explosive', 'gas', 'flammable', 'combustible', 'organic', 'poison', 'harmfulToWater'];

handlers.vehicleList = async function (req, res, args) {
    try {
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: [] });
      }
      const r = await pool.query(
        'SELECT * FROM vehicles WHERE company_id = $1 ORDER BY tip, rendszam',
        [req.session.user.company_id]
      );
      return res.json({ result: r.rows });
    } catch (err) {
      console.error('vehicleList hiba:', err);
      return res.json({ result: [] });
    }
  };

handlers.vehicleCreate = async function (req, res, args) {
    try {
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      }

      const v = args[0] || {};
      const rendszam = String(v.rendszam || '').trim().toUpperCase();
      const tip = String(v.tip || '').trim();
      const marca = v.marca ? String(v.marca).trim() : null;
      const model = v.model ? String(v.model).trim() : null;
      const an = v.an ? parseInt(v.an, 10) : null;
      const nota = v.nota ? String(v.nota).trim() : null;

      if (!rendszam) {
        return res.json({ result: { ok: false, err: 'A rendszam kotelezo.' } });
      }
      if (!['Vontato', 'Potkocsi'].includes(tip)) {
        return res.json({ result: { ok: false, err: 'Ervenytelen tipus.' } });
      }

      await pool.query(
        `INSERT INTO vehicles (rendszam, tip, marca, model, an, nota, company_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [rendszam, tip, marca, model, an, nota, req.session.user.company_id]
      );
      return res.json({ result: { ok: true } });
    } catch (err) {
      if (err.code === '23505') {
        return res.json({ result: { ok: false, err: 'Ez a rendszam mar letezik.' } });
      }
      console.error('vehicleCreate hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  };

handlers.vehicleUpdate = async function (req, res, args) {
    try {
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      }

      const id = parseInt(args[0], 10);
      const f = args[1] || {};
      if (!id) {
        return res.json({ result: { ok: false, err: 'ID kotelezo.' } });
      }

      const updates = [];
      const values = [];
      let i = 1;

      if (f.rendszam !== undefined) {
        updates.push(`rendszam = $${i++}`);
        values.push(String(f.rendszam).trim().toUpperCase());
      }
      if (f.tip !== undefined) {
        if (!['Vontato', 'Potkocsi'].includes(f.tip)) {
          return res.json({ result: { ok: false, err: 'Ervenytelen tipus.' } });
        }
        updates.push(`tip = $${i++}`);
        values.push(f.tip);
      }
      if (f.marca !== undefined) {
        updates.push(`marca = $${i++}`);
        values.push(f.marca);
      }
      if (f.model !== undefined) {
        updates.push(`model = $${i++}`);
        values.push(f.model);
      }
      if (f.an !== undefined) {
        updates.push(`an = $${i++}`);
        values.push(f.an ? parseInt(f.an, 10) : null);
      }
      if (f.nota !== undefined) {
        updates.push(`nota = $${i++}`);
        values.push(f.nota);
      }
      if (f.activ !== undefined) {
        updates.push(`activ = $${i++}`);
        values.push(!!f.activ);
      }

      // --- Teherjármű paraméterek (HERE routing) ---
      if (f.height_cm !== undefined)          { updates.push(`height_cm = $${i++}`);          values.push(_intOrNull(f.height_cm)); }
      if (f.width_cm !== undefined)           { updates.push(`width_cm = $${i++}`);           values.push(_intOrNull(f.width_cm)); }
      if (f.length_cm !== undefined)          { updates.push(`length_cm = $${i++}`);          values.push(_intOrNull(f.length_cm)); }
      if (f.weight_kg !== undefined)          { updates.push(`weight_kg = $${i++}`);          values.push(_intOrNull(f.weight_kg)); }
      if (f.weight_per_axle_kg !== undefined) { updates.push(`weight_per_axle_kg = $${i++}`); values.push(_intOrNull(f.weight_per_axle_kg)); }
      if (f.axle_count !== undefined)         { updates.push(`axle_count = $${i++}`);         values.push(_intOrNull(f.axle_count)); }
      if (f.trailer_count !== undefined)      { updates.push(`trailer_count = $${i++}`);      values.push(_intOrNull(f.trailer_count)); }
      if (f.truck_type !== undefined)         { updates.push(`truck_type = $${i++}`);         values.push(_enumOrNull(f.truck_type, TRUCK_TYPES)); }
      if (f.tunnel_category !== undefined)    { updates.push(`tunnel_category = $${i++}`);    values.push(_enumOrNull(f.tunnel_category, TUNNEL_CATS)); }
      if (f.hazardous_goods !== undefined)    { updates.push(`hazardous_goods = $${i++}`);    values.push(_enumOrNull(f.hazardous_goods, HAZMAT_KINDS)); }
      if (f.fuel_per_100km !== undefined)     { updates.push(`fuel_per_100km = $${i++}`);     values.push(_numOrNull(f.fuel_per_100km)); }

      if (updates.length === 0) {
        return res.json({ result: { ok: false, err: 'Nincs mit modositani.' } });
      }

      updates.push(`updated_at = NOW()`);
      // Multi-tenant: a jármű csak a saját céghez tartozhat
      values.push(id);
      values.push(req.session.user.company_id);
      const sql = `UPDATE vehicles SET ${updates.join(', ')} WHERE id = $${i} AND company_id = $${i + 1}`;
      const r = await pool.query(sql, values);

      if (r.rowCount === 0) {
        return res.json({ result: { ok: false, err: 'Nem talalhato.' } });
      }
      return res.json({ result: { ok: true } });
    } catch (err) {
      if (err.code === '23505') {
        return res.json({ result: { ok: false, err: 'Ez a rendszam mar letezik.' } });
      }
      console.error('vehicleUpdate hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  };

handlers.vehicleDelete = async function (req, res, args) {
    try {
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      }
      const id = parseInt(args[0], 10);
      if (!id) {
        return res.json({ result: { ok: false, err: 'ID kotelezo.' } });
      }
      const r = await pool.query('DELETE FROM vehicles WHERE id = $1 AND company_id = $2', [id, req.session.user.company_id]);
      if (r.rowCount === 0) {
        return res.json({ result: { ok: false, err: 'Nem talalhato.' } });
      }
      return res.json({ result: { ok: true } });
    } catch (err) {
      console.error('vehicleDelete hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  };

handlers.extDriverList = async function (req, res, args) {
    try {
      if (!req.session.user) {
        return res.json({ result: [] });
      }
      const r = await pool.query(
        `SELECT id, nume, firma, telefon, email, rendszam_camion, rendszam_remorca, nota, created_at
         FROM external_drivers WHERE company_id = $1 ORDER BY nume, firma`,
        [req.session.user.company_id]
      );
      return res.json({ result: r.rows });
    } catch (err) {
      console.error('extDriverList hiba:', err);
      return res.json({ result: [] });
    }
  };

handlers.extDriverCreate = async function (req, res, args) {
    try {
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      }

      const d = args[0] || {};
      const nume = d.nume ? String(d.nume).trim() : null;
      const firma = d.firma ? String(d.firma).trim() : null;
      const telefon = d.telefon ? String(d.telefon).trim() : null;
      const email = d.email ? String(d.email).trim().toLowerCase() : null;
      const rendszam_camion = d.rendszam_camion ? String(d.rendszam_camion).trim().toUpperCase() : null;
      const rendszam_remorca = d.rendszam_remorca ? String(d.rendszam_remorca).trim().toUpperCase() : null;
      const nota = d.nota ? String(d.nota).trim() : null;

      // legalabb egy mezo kotelezo (nume vagy firma)
      if (!nume && !firma) {
        return res.json({ result: { ok: false, err: 'A nev vagy a ceg neve kotelezo.' } });
      }

      const r = await pool.query(
        `INSERT INTO external_drivers (nume, firma, telefon, email, rendszam_camion, rendszam_remorca, nota, company_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [nume, firma, telefon, email, rendszam_camion, rendszam_remorca, nota, req.session.user.company_id]
      );
      return res.json({ result: { ok: true, id: r.rows[0].id } });
    } catch (err) {
      console.error('extDriverCreate hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  };

handlers.extDriverUpdate = async function (req, res, args) {
    try {
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      }

      const id = parseInt(args[0], 10);
      const f = args[1] || {};
      if (!id) {
        return res.json({ result: { ok: false, err: 'ID kotelezo.' } });
      }

      const updates = [];
      const values = [];
      let i = 1;

      if (f.nume !== undefined) {
        updates.push(`nume = $${i++}`);
        values.push(f.nume ? String(f.nume).trim() : null);
      }
      if (f.firma !== undefined) {
        updates.push(`firma = $${i++}`);
        values.push(f.firma ? String(f.firma).trim() : null);
      }
      if (f.telefon !== undefined) {
        updates.push(`telefon = $${i++}`);
        values.push(f.telefon ? String(f.telefon).trim() : null);
      }
      if (f.email !== undefined) {
        updates.push(`email = $${i++}`);
        values.push(f.email ? String(f.email).trim().toLowerCase() : null);
      }
      if (f.rendszam_camion !== undefined) {
        updates.push(`rendszam_camion = $${i++}`);
        values.push(f.rendszam_camion ? String(f.rendszam_camion).trim().toUpperCase() : null);
      }
      if (f.rendszam_remorca !== undefined) {
        updates.push(`rendszam_remorca = $${i++}`);
        values.push(f.rendszam_remorca ? String(f.rendszam_remorca).trim().toUpperCase() : null);
      }
      if (f.nota !== undefined) {
        updates.push(`nota = $${i++}`);
        values.push(f.nota ? String(f.nota).trim() : null);
      }

      if (updates.length === 0) {
        return res.json({ result: { ok: false, err: 'Nincs mit modositani.' } });
      }

      updates.push(`updated_at = NOW()`);
      values.push(id);
      values.push(req.session.user.company_id);
      const sql = `UPDATE external_drivers SET ${updates.join(', ')} WHERE id = $${i} AND company_id = $${i + 1}`;
      const r = await pool.query(sql, values);

      if (r.rowCount === 0) {
        return res.json({ result: { ok: false, err: 'Nem talalhato.' } });
      }
      return res.json({ result: { ok: true } });
    } catch (err) {
      console.error('extDriverUpdate hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  };

handlers.extDriverDelete = async function (req, res, args) {
    try {
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      }
      const id = parseInt(args[0], 10);
      if (!id) {
        return res.json({ result: { ok: false, err: 'ID kotelezo.' } });
      }
      const r = await pool.query('DELETE FROM external_drivers WHERE id = $1 AND company_id = $2', [id, req.session.user.company_id]);
      if (r.rowCount === 0) {
        return res.json({ result: { ok: false, err: 'Nem talalhato.' } });
      }
      return res.json({ result: { ok: true } });
    } catch (err) {
      console.error('extDriverDelete hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  };

module.exports = handlers;
