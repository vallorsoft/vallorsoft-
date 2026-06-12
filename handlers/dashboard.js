// ============================================================
//  VallorSoft — handlers/dashboard.js
//  AUTO-KIVÁGOTT a régi server.js /api/execute ágaiból.
//  A handler-törzsek BÁJTRA AZONOSAK az eredetivel.
//  Hívás: handlers.<funkcioNev>(req, res, args)
// ============================================================
const pool = require('../db');
const { getPositions } = require('../lib/vehiclePositions');

const handlers = {};

handlers.dashStats = async function (req, res, args) {
    try {
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      }
      const cid = req.session.user.company_id;

      // Fuvarok statusz szerint
      const statusR = await pool.query(
        `SELECT status, COUNT(*)::int AS db FROM orders WHERE company_id = $1 GROUP BY status`,
        [cid]
      );

      // Havi bevétel (elmúlt 12 hónap)
      const bevR = await pool.query(
        `SELECT TO_CHAR(created_at, 'YYYY-MM') AS ho, SUM(pret)::numeric AS osszeg
         FROM orders WHERE company_id = $1 AND created_at >= NOW() - INTERVAL '12 months'
         GROUP BY ho ORDER BY ho`,
        [cid]
      );

      // Sofőrök km összesítő
      const kmR = await pool.query(
        `SELECT nume_sofer, SUM(km)::numeric AS total_km
         FROM orders WHERE company_id = $1 AND km > 0 AND nume_sofer IS NOT NULL
         GROUP BY nume_sofer ORDER BY total_km DESC LIMIT 10`,
        [cid]
      );

      // Járművek kihasználtsága (hány fuvarhoz rendelték)
      const jarmuR = await pool.query(
        `SELECT rendszam_camion AS rendszam, COUNT(*)::int AS fuvarok
         FROM orders WHERE company_id = $1 AND rendszam_camion IS NOT NULL
         GROUP BY rendszam_camion ORDER BY fuvarok DESC LIMIT 10`,
        [cid]
      );

      // Cég neve
      const cegR = await pool.query('SELECT nev FROM companies WHERE id = $1', [cid]);

      return res.json({ result: {
        ok: true,
        ceg_nev: cegR.rows[0]?.nev || '—',
        statuszok: statusR.rows,
        havi_bevetel: bevR.rows,
        sofor_km: kmR.rows,
        jarmu_kihasznaltsag: jarmuR.rows
      }});
    } catch (err) {
      console.error('dashStats hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  };

// ------------------------------------------------------------
//  ÚJ DASHBOARD-ADATOK (redesign) — Admin/Manager vezérlőpult
//  A séma tényleges oszlopaihoz igazítva:
//   - orders: nincs `destination`/`driver_id` -> loc_descarcare + nume_sofer/email_sofer (users join)
//   - vehicles: nincs `status` szöveg -> `activ` BOOLEAN (aktív/álló)
//   - vehicle_gps_map: nincs tárolt lat/lng -> élő pozíció a GPS-szolgáltatótól (cargotrack)
//  Multi-tenant: minden lekérdezés company_id-re szűr.
// ------------------------------------------------------------

// args lehet tömb ([8]) vagy objektum ({limit:8}) — mindkettőt kezeljük
function _argObj(args) {
  if (Array.isArray(args)) return { limit: args[0] };
  return args || {};
}

handlers.getRecentOrders = async function (req, res, args) {
  try {
    if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
      return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
    }
    const cid = req.session.user.company_id;
    const a = _argObj(args);
    let limit = parseInt(a.limit, 10);
    if (!Number.isFinite(limit) || limit <= 0) limit = 8;
    if (limit > 50) limit = 50;

    const { rows } = await pool.query(
      `SELECT o.id, o.loc_incarcare, o.loc_descarcare,
              o.nume_sofer, o.email_sofer, u.nume AS driver_user_name,
              o.status, o.created_at
       FROM orders o
       LEFT JOIN users u
         ON LOWER(u.email) = LOWER(o.email_sofer) AND u.company_id = o.company_id
       WHERE o.company_id = $1
       ORDER BY o.created_at DESC
       LIMIT $2`,
      [cid, limit]
    );
    return res.json({ result: { ok: true, orders: rows } });
  } catch (err) {
    console.error('getRecentOrders hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
  }
};

handlers.getVehicleStatusSummary = async function (req, res, args) {
  try {
    if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
      return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
    }
    const cid = req.session.user.company_id;
    // A vehicles táblának `activ` BOOLEAN oszlopa van (nincs szöveges status).
    const { rows } = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE activ = TRUE)::int  AS active,
         COUNT(*) FILTER (WHERE activ = FALSE)::int AS inactive,
         COUNT(*) FILTER (WHERE activ IS NULL)::int AS unknown
       FROM vehicles WHERE company_id = $1`,
      [cid]
    );
    const r = rows[0] || { active: 0, inactive: 0, unknown: 0 };
    return res.json({ result: { ok: true, active: r.active, inactive: r.inactive, unknown: r.unknown } });
  } catch (err) {
    console.error('getVehicleStatusSummary hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
  }
};

// A pozíció-lekérés + cache a lib/vehiclePositions.js-ben él (a Visszfuvar-
// radar is onnan olvas, így a két felület egy közös 30 mp-es cache-en
// osztozik a GPS-szolgáltató felé).
handlers.getActiveVehiclePositions = async function (req, res, args) {
  try {
    if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
      return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
    }
    const payload = await getPositions(req.session.user.company_id);
    return res.json({ result: payload });
  } catch (err) {
    console.error('getActiveVehiclePositions hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
  }
};

// A saját cég funkció-kapcsolói (a sidebar elrejtéséhez). Hiányzó kulcs = engedélyezett.
handlers.getMyFeatures = async function (req, res, args) {
  try {
    if (!req.session.user) return res.json({ result: { ok: false, err: 'Nincs bejelentkezve' } });
    const cid = req.session.user.company_id;
    if (!cid) return res.json({ result: { ok: true, features: {} } });
    const r = await pool.query('SELECT feature_key, enabled FROM company_features WHERE company_id = $1', [cid]);
    const features = {};
    r.rows.forEach((row) => { features[row.feature_key] = row.enabled; });
    return res.json({ result: { ok: true, features } });
  } catch (err) {
    console.error('getMyFeatures hiba:', err);
    return res.json({ result: { ok: true, features: {} } });
  }
};

module.exports = handlers;
