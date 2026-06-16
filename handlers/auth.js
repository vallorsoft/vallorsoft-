// ============================================================
//  VallorSoft — handlers/auth.js
//  AUTO-KIVÁGOTT a régi server.js /api/execute ágaiból.
//  A handler-törzsek BÁJTRA AZONOSAK az eredetivel.
//  Hívás: handlers.<funkcioNev>(req, res, args)
// ============================================================
const pool = require('../db');
const bcrypt = require('bcrypt');
const planLimits = require('../lib/planLimits');
const { validatePassword } = require('../lib/passwordPolicy');

const handlers = {};

handlers.authMe = async function (req, res, args) {
    return res.json({ result: req.session.user || null });
  };

handlers.authLogout = async function (req, res, args) {
    req.session.destroy(function(err) {
      if (err) {
        return res.json({ result: { ok: false, err: 'Eroare la deconectare' } });
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
        return res.json({ result: { ok: false, err: 'Toate campurile sunt obligatorii.' } });
      }
      const pwCheck = validatePassword(jelszo);
      if (!pwCheck.ok) {
        return res.json({ result: { ok: false, err: pwCheck.err } });
      }

      const invResult = await pool.query(
        'SELECT id, pozicio, email, status, company_id FROM invites WHERE kod = $1',
        [kod]
      );

      if (invResult.rows.length === 0) {
        return res.json({ result: { ok: false, err: 'Cod de invitatie necunoscut.' } });
      }

      const invite = invResult.rows[0];

      if (invite.status && invite.status.toLowerCase().startsWith('felhaszn')) {
        return res.json({ result: { ok: false, err: 'Acest cod de invitatie a fost deja folosit.' } });
      }
      if (invite.status && invite.status.toLowerCase().startsWith('visszavon')) {
        return res.json({ result: { ok: false, err: 'Aceasta invitatie a fost retrasa.' } });
      }
      if (invite.email && invite.email.toLowerCase() !== email) {
        return res.json({ result: { ok: false, err: 'Invitatia nu apartine acestei adrese de e-mail.' } });
      }

      const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
      if (existing.rows.length > 0) {
        return res.json({ result: { ok: false, err: 'Acest e-mail este deja inregistrat.' } });
      }

      // Csomag-limit: felhasználó-darabszám (NULL = korlátlan)
      const _lim = await planLimits.checkLimit(invite.company_id, 'users');
      if (!_lim.ok) {
        return res.json({ result: { ok: false, err: 'Limita de utilizatori a pachetului a fost atinsă (' + _lim.used + '/' + _lim.limit + ').' } });
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
        result: { ok: true, msg: 'Inregistrare reusita. Acum va puteti autentifica.', pozicio: invite.pozicio }
      });

    } catch (err) {
      console.error('Register hiba:', err);
      return res.json({ result: { ok: false, err: 'Eroare de server' } });
    }
  };

module.exports = handlers;
