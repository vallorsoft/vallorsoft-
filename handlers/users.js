// ============================================================
//  VallorSoft — handlers/users.js
//  AUTO-KIVÁGOTT a régi server.js /api/execute ágaiból.
//  A handler-törzsek BÁJTRA AZONOSAK az eredetivel.
//  Hívás: handlers.<funkcioNev>(req, res, args)
// ============================================================
const pool = require('../db');
const bcrypt = require('bcrypt');

const handlers = {};

// ── Cég e-mail nyelve (meghívó/jelszó-e-mailek) — admin állítja, alap 'ro' ──
handlers.getEmailLang = async function (req, res, args) {
  try {
    if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) return res.json({ result: { ok: false } });
    const r = await pool.query('SELECT email_lang FROM companies WHERE id = $1', [req.session.user.company_id]);
    return res.json({ result: { ok: true, lang: (r.rows[0] && r.rows[0].email_lang === 'hu') ? 'hu' : 'ro' } });
  } catch (e) { return res.json({ result: { ok: false } }); }
};
handlers.setEmailLang = async function (req, res, args) {
  try {
    if (!req.session.user || req.session.user.pozicio !== 'Admin') return res.json({ result: { ok: false, err: 'Csak admin állíthatja.' } });
    const lang = (args && args[0] === 'hu') ? 'hu' : 'ro';
    await pool.query('UPDATE companies SET email_lang = $1 WHERE id = $2', [lang, req.session.user.company_id]);
    return res.json({ result: { ok: true } });
  } catch (e) { console.error('setEmailLang hiba:', e); return res.json({ result: { ok: false, err: 'Szerver hiba' } }); }
};

handlers.userListAll = async function (req, res, args) {
    try {
      if (!['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: [] });
      }
      const cid = req.session.user.company_id;
      if (!cid) return res.json({ result: [] });
      const r = await pool.query(
        'SELECT id, nume, email, tel, pozicio FROM users WHERE company_id = $1 AND (pozicio_dev IS NOT TRUE) ORDER BY id',
        [cid]
      );
      return res.json({ result: r.rows });
    } catch (e) {
      console.error(e);
      return res.json({ result: [] });
    }
  };

handlers.getInternalDrivers = async function (req, res, args) {
    try {
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: [] });
      }
      const cid = req.session.user.company_id;
      const r = await pool.query(
        `SELECT id, nume, email, tel FROM users
         WHERE company_id = $1 AND pozicio = 'Sofer'
         ORDER BY nume`,
        [cid]
      );
      return res.json({ result: r.rows });
    } catch (e) {
      console.error('getInternalDrivers hiba:', e);
      return res.json({ result: [] });
    }
  };

handlers.userUpdate = async function (req, res, args) {
    try {
      // Admin es Manager hivhatja, de a Manager korlatozott (lejjebb)
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      }

      const targetEmail = String(args[0] || '').trim().toLowerCase();
      const fields = args[1] || {};

      if (!targetEmail) {
        return res.json({ result: { ok: false, err: 'Email kotelezo.' } });
      }

      // Lekerjuk a cel-felhasznalot a DB-bol
      const targetRes = await pool.query(
        'SELECT id, email, pozicio, company_id FROM users WHERE email = $1',
        [targetEmail]
      );
      if (targetRes.rows.length === 0) {
        return res.json({ result: { ok: false, err: 'Felhasznalo nem talalhato.' } });
      }
      const targetUser = targetRes.rows[0];
      const isSelf = targetEmail === req.session.user.email.toLowerCase();
      const callerRole = req.session.user.pozicio;

      // 🔒 Ceg-szures: csak sajat ceg useret modosithatja
      if (targetUser.company_id !== req.session.user.company_id) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag.' } });
      }

      // 🔒 Manager nem modosithatja Admin vagy mas Manager adatait
      if (callerRole === 'Manager' && !isSelf && targetUser.pozicio !== 'Sofer') {
        return res.json({ result: { ok: false, err: 'Manager csak Sofer adatait modosithatja.' } });
      }

      // 🔒 Admin nem modosithatja mas Admin jelszavat vagy emailjet
      if (callerRole === 'Admin' && !isSelf && targetUser.pozicio === 'Admin') {
        if (fields.jelszo) {
          return res.json({ result: { ok: false, err: 'Admin mas Admin jelszavat nem valtoztathatja.' } });
        }
      }

      // dinamikusan epitjuk az UPDATE-et csak azokra a mezokre, amik vannak
      const updates = [];
      const values = [];
      let i = 1;

      if (fields.nume !== undefined) {
        updates.push(`nume = $${i++}`);
        values.push(fields.nume);
      }
      if (fields.tel !== undefined) {
        updates.push(`tel = $${i++}`);
        values.push(fields.tel);
      }
      if (fields.pozicio !== undefined) {
        if (!['Admin', 'Manager', 'Sofer'].includes(fields.pozicio)) {
          return res.json({ result: { ok: false, err: 'Ervenytelen pozicio.' } });
        }

        // 🔒 1. SZABALY: Admin ne tudja a SAJAT poziciojat megvaltoztatni (lefokozas tiltva)
        if (isSelf && fields.pozicio !== targetUser.pozicio) {
          return res.json({ result: { ok: false, err: 'Sajat poziciodat nem modosithatod.' } });
        }

        // 🔒 3. SZABALY: Manager / Sofer pozicio szerkezeti vedelme
        // - utolso Admin nem fokozhato le (rendszer mindig kell legyen egy Admin)
        if (targetUser.pozicio === 'Admin' && fields.pozicio !== 'Admin') {
          const adminCount = await pool.query(
            "SELECT COUNT(*)::int AS db FROM users WHERE pozicio = 'Admin' AND company_id = $1",
            [req.session.user.company_id]
          );
          if (adminCount.rows[0].db <= 1) {
            return res.json({ result: { ok: false, err: 'Nem maradhat a rendszer Admin nelkul.' } });
          }
        }

        updates.push(`pozicio = $${i++}`);
        values.push(fields.pozicio);
      }
      if (fields.jelszo) {
        const hash = await bcrypt.hash(fields.jelszo, 10);
        updates.push(`password_hash = $${i++}`);
        values.push(hash);
      }

      if (updates.length === 0) {
        return res.json({ result: { ok: false, err: 'Nincs mit modositani.' } });
      }

      // Az iras maga is cegre szurve fut — egy kesobbi refaktor ne nyithasson cross-tenant rest
      values.push(targetEmail);
      values.push(req.session.user.company_id);
      const sql = `UPDATE users SET ${updates.join(', ')} WHERE email = $${i} AND company_id = $${i + 1}`;
      const r = await pool.query(sql, values);

      if (r.rowCount === 0) {
        return res.json({ result: { ok: false, err: 'Felhasznalo nem talalhato.' } });
      }

      return res.json({ result: { ok: true } });

    } catch (err) {
      console.error('userUpdate hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  };

handlers.userDelete = async function (req, res, args) {
    try {
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      }
      const targetEmail = String(args[0] || '').trim().toLowerCase();
      if (!targetEmail) {
        return res.json({ result: { ok: false, err: 'Email kotelezo.' } });
      }

      // 🔒 2. SZABALY: ne torolhesse sajat magat
      if (targetEmail === req.session.user.email.toLowerCase()) {
        return res.json({ result: { ok: false, err: 'Sajat magadat nem torolheted.' } });
      }

      // 🔒 Lekerjuk a cel-felhasznalo poziciojat es ceg-id-jet
      const targetRes = await pool.query(
        'SELECT pozicio, company_id FROM users WHERE email = $1',
        [targetEmail]
      );
      if (targetRes.rows.length === 0) {
        return res.json({ result: { ok: false, err: 'Felhasznalo nem talalhato.' } });
      }

      // 🔒 Csak sajat ceg useret torolheti
      if (targetRes.rows[0].company_id !== req.session.user.company_id) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag.' } });
      }

      // 🔒 Manager csak Sofer felhasznalot torolhet
      if (req.session.user.pozicio === 'Manager' && targetRes.rows[0].pozicio !== 'Sofer') {
        return res.json({ result: { ok: false, err: 'Manager csak Sofer felhasznalot torolhet.' } });
      }

      // 🔒 KIEGESZITES: utolso Admin torlese sem engedett
      if (targetRes.rows[0].pozicio === 'Admin') {
        const adminCount = await pool.query(
          "SELECT COUNT(*)::int AS db FROM users WHERE pozicio = 'Admin' AND company_id = $1",
          [req.session.user.company_id]
        );
        if (adminCount.rows[0].db <= 1) {
          return res.json({ result: { ok: false, err: 'Az utolso Admin nem torolheto.' } });
        }
      }

      const r = await pool.query('DELETE FROM users WHERE email = $1 AND company_id = $2', [targetEmail, req.session.user.company_id]);
      if (r.rowCount === 0) {
        return res.json({ result: { ok: false, err: 'Felhasznalo nem talalhato.' } });
      }
      return res.json({ result: { ok: true } });
    } catch (err) {
      console.error('userDelete hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  };

handlers.settingsChangePassword = async function (req, res, args) {
    try {
      if (!req.session.user) return res.json({ result: { ok: false, err: 'Nincs bejelentkezve.' } });
      const { current, newPwd } = args[0] || {};
      if (!current || !newPwd) return res.json({ result: { ok: false, err: 'Minden mező kötelező.' } });
      if (newPwd.length < 6) return res.json({ result: { ok: false, err: 'Az új jelszó legalább 6 karakter legyen.' } });

      const r = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.session.user.id]);
      if (!r.rows.length) return res.json({ result: { ok: false, err: 'Felhasználó nem található.' } });

      const ok = await bcrypt.compare(current, r.rows[0].password_hash);
      if (!ok) return res.json({ result: { ok: false, err: 'A jelenlegi jelszó helytelen.' } });

      const hash = await bcrypt.hash(newPwd, 10);
      await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.session.user.id]);
      return res.json({ result: { ok: true } });
    } catch (err) {
      console.error('settingsChangePassword hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba.' } });
    }
  };

handlers.settingsSaveProfile = async function (req, res, args) {
    try {
      if (!req.session.user) return res.json({ result: { ok: false, err: 'Nincs bejelentkezve.' } });
      const { nume, tel } = args[0] || {};
      if (!nume || !String(nume).trim()) return res.json({ result: { ok: false, err: 'A név kötelező.' } });

      const newNume = String(nume).trim();
      const newTel  = String(tel || '').trim();
      await pool.query('UPDATE users SET nume = $1, tel = $2 WHERE id = $3', [newNume, newTel, req.session.user.id]);

      // session frissítése
      req.session.user.nume = newNume;
      req.session.user.tel  = newTel;
      return res.json({ result: { ok: true } });
    } catch (err) {
      console.error('settingsSaveProfile hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba.' } });
    }
  };

handlers.settings2faDisable = async function (req, res, args) {
    try {
      if (!req.session.user) return res.json({ result: { ok: false, err: 'Nincs bejelentkezve.' } });
      const { currentPwd } = args[0] || {};
      if (!currentPwd) return res.json({ result: { ok: false, err: 'A jelszó megadása kötelező a 2FA kikapcsolásához.' } });

      const r = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.session.user.id]);
      if (!r.rows.length) return res.json({ result: { ok: false, err: 'Felhasználó nem található.' } });

      const ok = await bcrypt.compare(currentPwd, r.rows[0].password_hash);
      if (!ok) return res.json({ result: { ok: false, err: 'Helytelen jelszó.' } });

      await pool.query('UPDATE users SET totp_enabled = FALSE, totp_secret = NULL, totp_backup_codes = NULL WHERE id = $1', [req.session.user.id]);
      return res.json({ result: { ok: true } });
    } catch (err) {
      console.error('settings2faDisable hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba.' } });
    }
  };

handlers.settings2faStatus = async function (req, res, args) {
    try {
      if (!req.session.user) return res.json({ result: { ok: false } });
      const r = await pool.query('SELECT totp_enabled FROM users WHERE id = $1', [req.session.user.id]);
      const enabled = r.rows.length ? !!r.rows[0].totp_enabled : false;
      return res.json({ result: { ok: true, totp_enabled: enabled } });
    } catch (err) {
      return res.json({ result: { ok: false, totp_enabled: false } });
    }
  };

module.exports = handlers;
