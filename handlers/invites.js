// ============================================================
//  VallorSoft — handlers/invites.js
//  AUTO-KIVÁGOTT a régi server.js /api/execute ágaiból.
//  A handler-törzsek BÁJTRA AZONOSAK az eredetivel.
//  Hívás: handlers.<funkcioNev>(req, res, args)
// ============================================================
const pool = require('../db');
const { sendInviteEmail } = require('../services/email');

const handlers = {};

handlers.invListAll = async function (req, res, args) {
    try {
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      }
      const r = await pool.query(
        `SELECT kod, pozicio, email, status FROM invites WHERE company_id = $1 ORDER BY id DESC`,
        [req.session.user.company_id]
      );
      const list = r.rows.map(row => ({
        kod: row.kod, pozicio: row.pozicio, email: row.email, statusz: row.status,
      }));
      return res.json({ result: list });
    } catch (err) {
      console.error('invListAll hiba:', err);
      return res.json({ result: [] });
    }
  };

handlers.invCreate = async function (req, res, args) {
    try {
      // Admin barmit, Manager csak Sofer meghivot
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      }

      const pozicio = String(args[0] || '').trim();

      // 🔒 Manager csak Sofer meghivot kuldhet
      if (req.session.user.pozicio === 'Manager' && pozicio !== 'Sofer') {
        return res.json({ result: { ok: false, err: 'Manager csak Sofer meghivot generalhat.' } });
      }
    
      const email = String(args[1] || '').trim().toLowerCase();
      const invNume = String(args[2] || '').trim() || null;
      const invTel  = String(args[3] || '').trim() || null;

      if (!['Admin', 'Manager', 'Sofer'].includes(pozicio)) {
        return res.json({ result: { ok: false, err: 'Ervenytelen pozicio.' } });
      }

      // veletlen kod generalas - hasonloan a regi _genCode-hoz
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let kod = 'VS-';
      for (let i = 0; i < 6; i++) {
        kod += chars.charAt(Math.floor(Math.random() * chars.length));
      }

      await pool.query(
        `INSERT INTO invites (kod, pozicio, email, status, company_id, nume, tel) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [kod, pozicio, email, 'Aktiv', req.session.user.company_id || null, invNume, invTel]
      );

      // Email kuldese ha van email cim. A MEGHÍVOTT nevével köszönünk (invNume),
      // NEM a cég igazgatójáéval — a meghívót a meghívott személy kapja.
      if (email) {
        const cegRes = await pool.query('SELECT nev FROM companies WHERE id = $1', [req.session.user.company_id]);
        const cegNev = cegRes.rows[0]?.nev || '';
        sendInviteEmail(email, kod, pozicio, cegNev, invNume)
          .catch(e => console.error('Email hatter hiba:', e.message));
      }

      return res.json({ result: { ok: true, kod: kod } });

    } catch (err) {
      console.error('invCreate hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  };

handlers.invRevoke = async function (req, res, args) {
    try {
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      }
      const kod = String(args[0] || '').trim().toUpperCase();

      // 🔒 Manager csak Sofer meghivot vonhat vissza
      if (req.session.user.pozicio === 'Manager') {
        const check = await pool.query('SELECT pozicio FROM invites WHERE kod = $1 AND company_id = $2', [kod, req.session.user.company_id]);
        if (check.rows.length === 0) {
          return res.json({ result: { ok: false, err: 'Nem talalhato.' } });
        }
        if (check.rows[0].pozicio !== 'Sofer') {
          return res.json({ result: { ok: false, err: 'Manager csak Sofer meghivot vonhat vissza.' } });
        }
      }

      const r = await pool.query(
        `UPDATE invites SET status = 'Visszavonva' WHERE kod = $1 AND company_id = $2`,
        [kod, req.session.user.company_id]
      );
      if (r.rowCount === 0) {
        return res.json({ result: { ok: false, err: 'Nem talalhato.' } });
      }
      return res.json({ result: { ok: true } });
    } catch (err) {
      console.error('invRevoke hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  };

module.exports = handlers;
