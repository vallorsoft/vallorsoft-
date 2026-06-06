// ============================================================
//  VallorSoft — handlers/dashboard.js
//  AUTO-KIVÁGOTT a régi server.js /api/execute ágaiból.
//  A handler-törzsek BÁJTRA AZONOSAK az eredetivel.
//  Hívás: handlers.<funkcioNev>(req, res, args)
// ============================================================
const pool = require('../db');

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

module.exports = handlers;
