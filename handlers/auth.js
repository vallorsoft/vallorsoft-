// ============================================================
//  VallorSoft — handlers/auth.js
//  AUTO-KIVÁGOTT a régi server.js /api/execute ágaiból.
//  A handler-törzsek BÁJTRA AZONOSAK az eredetivel.
//  Hívás: handlers.<funkcioNev>(req, res, args)
// ============================================================
const pool = require('../db');
const bcrypt = require('bcrypt');

const handlers = {};

handlers.authMe = async function (req, res, args) {
    return res.json({ result: req.session.user || null });
  };

handlers.authLogout = async function (req, res, args) {
    req.session.destroy(function(err) {
      if (err) {
        return res.json({ result: { ok: false, err: 'Logout hiba' } });
      }
      res.clearCookie('connect.sid');
      return res.json({ result: { ok: true } });
    });
    return;
  };

handlers.authRegister = async function (req, res, args) {
    try {
      const p = args[0] || {};
      const nume = String(p.nume || '').trim();
      const email = String(p.email || '').trim().toLowerCase();
      const tel = String(p.tel || '').trim();
      const jelszo = String(p.jelszo || '');
      const kod = String(p.kod || '').trim().toUpperCase();

      if (!nume || !email || !jelszo || !kod) {
        return res.json({ result: { ok: false, err: 'Minden mezo kotelezo.' } });
      }
      if (jelszo.length < 6) {
        return res.json({ result: { ok: false, err: 'A jelszo legalabb 6 karakter legyen.' } });
      }

      const invResult = await pool.query(
        'SELECT id, pozicio, email, status, company_id FROM invites WHERE kod = $1',
        [kod]
      );

      if (invResult.rows.length === 0) {
        return res.json({ result: { ok: false, err: 'Ismeretlen meghivokod.' } });
      }

      const invite = invResult.rows[0];

      if (invite.status && invite.status.toLowerCase().startsWith('felhaszn')) {
        return res.json({ result: { ok: false, err: 'Ezt a meghivokodot mar felhasznaltak.' } });
      }
      if (invite.status && invite.status.toLowerCase().startsWith('visszavon')) {
        return res.json({ result: { ok: false, err: 'Ezt a meghivot visszavontak.' } });
      }
      if (invite.email && invite.email.toLowerCase() !== email) {
        return res.json({ result: { ok: false, err: 'A meghivo nem ehhez az email-cimhez tartozik.' } });
      }

      const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
      if (existing.rows.length > 0) {
        return res.json({ result: { ok: false, err: 'Ez az email mar regisztralt.' } });
      }

      const passwordHash = await bcrypt.hash(jelszo, 10);
      await pool.query(
        `INSERT INTO users (nume, email, tel, pozicio, password_hash, company_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [nume, email, tel, invite.pozicio, passwordHash, invite.company_id || null]
      );

      await pool.query(
        `UPDATE invites SET status = 'Felhasznalva', used_by = $1 WHERE id = $2`,
        [email, invite.id]
      );

      return res.json({
        result: { ok: true, msg: 'Sikeres regisztracio. Most mar bejelentkezhet.', pozicio: invite.pozicio }
      });

    } catch (err) {
      console.error('Register hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  };

module.exports = handlers;
