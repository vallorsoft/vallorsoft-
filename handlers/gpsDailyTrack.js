// handlers/gpsDailyTrack.js — Napi GPS útvonal lekérdezés (breadcrumb + térkép).
// Adatforrás: `gps_daily_positions` (a scheduler 10 percenként rögzít, mozgás-
// szűrővel, 7 napos retencióval).
//
// Kapuk: Admin/Manager, `company_id`-szűrt, paraméteres SQL.

const pool = require('../db');
const handlers = {};
const _am = (u) => u && ['Admin','Manager'].includes(u.pozicio);

// listVehiclesWithTrack() — a cég azon jármű-rendszámai, amikre az utóbbi 7
// napban ROGZÍTETT breadcrumb van; a jármű-választóhoz.
handlers.listVehiclesWithTrack = async function (req, res) {
  try {
    if (!_am(req.session.user)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = req.session.user.company_id;
    try {
      const r = await pool.query(
        `SELECT g.rendszam,
                COUNT(*)::int AS points_7d,
                MAX(g.recorded_at) AS last_at,
                v.marca, v.model
           FROM gps_daily_positions g
      LEFT JOIN vehicles v ON v.company_id = g.company_id
                          AND UPPER(REGEXP_REPLACE(COALESCE(v.rendszam,''),'[^A-Za-z0-9]','','g'))
                            = UPPER(REGEXP_REPLACE(COALESCE(g.rendszam,''),'[^A-Za-z0-9]','','g'))
          WHERE g.company_id = $1 AND g.recorded_at >= NOW() - INTERVAL '7 days'
          GROUP BY g.rendszam, v.marca, v.model
          ORDER BY MAX(g.recorded_at) DESC`, [cid]);
      return res.json({ result: { ok: true, vehicles: r.rows } });
    } catch (err) {
      if (err && err.code === '42P01') return res.json({ result: { ok: true, vehicles: [], migration_pending: true } });
      throw err;
    }
  } catch (err) {
    console.error('listVehiclesWithTrack hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// getVehicleDailyTrack({rendszam, date}) — egy jármű adott napi (YYYY-MM-DD,
// Europe/Bucharest szerinti nap) pozíció-sorozata időrendben. Max 500 pont / nap
// (a 10 perces scheduler alap-frekvenciáján bőven belül van); DoS-védelem.
handlers.getVehicleDailyTrack = async function (req, res, args) {
  try {
    if (!_am(req.session.user)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = req.session.user.company_id;
    const a = (args && args[0]) || {};
    const plate = String(a.rendszam || '').trim();
    const date = String(a.date || '').trim();
    if (!plate) return res.json({ result: { ok: false, err: 'Nr. înmatriculare lipsă.' } });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.json({ result: { ok: false, err: 'Data invalidă (YYYY-MM-DD).' } });
    try {
      // Europe/Bucharest napi ablak. A `recorded_at` timestamptz, ezért a
      // dátum-alapú összehasonlítást az adott időzónában végezzük.
      const r = await pool.query(
        `SELECT lat, lng, speed_kmh, ignition, recorded_at
           FROM gps_daily_positions
          WHERE company_id = $1 AND rendszam = $2
            AND (recorded_at AT TIME ZONE 'Europe/Bucharest')::date = $3::date
          ORDER BY recorded_at ASC
          LIMIT 500`, [cid, plate, date]);
      return res.json({ result: { ok: true, points: r.rows, count: r.rowCount } });
    } catch (err) {
      if (err && err.code === '42P01') return res.json({ result: { ok: true, points: [], migration_pending: true } });
      throw err;
    }
  } catch (err) {
    console.error('getVehicleDailyTrack hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

module.exports = handlers;
