// ============================================================
//  VallorSoft — handlers/developer.js
//  AUTO-KIVÁGOTT a régi server.js /api/execute ágaiból.
//  A handler-törzsek BÁJTRA AZONOSAK az eredetivel.
//  Hívás: handlers.<funkcioNev>(req, res, args)
// ============================================================
const pool = require('../db');
const { sendInviteEmail } = require('../services/email');

const handlers = {};

handlers.devCompanyList = async function (req, res, args) {
      const isDev = req.session.user && req.session.user.is_dev;
    if (!isDev) return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
    try {
      const r = await pool.query(`
        SELECT c.*,
          (SELECT COUNT(*)::int FROM users u WHERE u.company_id = c.id) AS user_count,
          (SELECT COUNT(*)::int FROM orders o WHERE o.company_id = c.id) AS order_count,
          (SELECT COUNT(*)::int FROM bug_reports b WHERE b.company_id = c.id AND b.is_read = FALSE) AS unread_bugs
        FROM companies c ORDER BY c.created_at DESC
      `);
      return res.json({ result: r.rows });
    } catch (err) { return res.json({ result: [] }); }
  };

handlers.devCompanyUpdate = async function (req, res, args) {
      const isDev = req.session.user && req.session.user.is_dev;
    if (!isDev) return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
    try {
      const id = parseInt(args[0], 10);
      const f = args[1] || {};
      const updates = []; const values = []; let i = 1;
      if (f.nev !== undefined) { updates.push(`nev=$${i++}`); values.push(f.nev); }
      if (f.subscription_status !== undefined) { updates.push(`subscription_status=$${i++}`); values.push(f.subscription_status); }
      if (f.paid_until !== undefined) { updates.push(`paid_until=$${i++}`); values.push(f.paid_until || null); }
      if (f.email_contact !== undefined) { updates.push(`email_contact=$${i++}`); values.push(f.email_contact); }
      if (f.telefon !== undefined) { updates.push(`telefon=$${i++}`); values.push(f.telefon); }
      if (f.max_users !== undefined) { updates.push(`max_users=$${i++}`); values.push(parseInt(f.max_users)); }
      if (f.max_trucks !== undefined) { updates.push(`max_trucks=$${i++}`); values.push(parseInt(f.max_trucks)); }
      if (f.igazgato_nev !== undefined) { updates.push(`igazgato_nev=$${i++}`); values.push(f.igazgato_nev); }
      if (!updates.length) return res.json({ result: { ok: false, err: 'Nincs mit modositani' } });
      values.push(id);
      await pool.query(`UPDATE companies SET ${updates.join(',')} WHERE id=$${i}`, values);
      return res.json({ result: { ok: true } });
    } catch (err) { return res.json({ result: { ok: false, err: 'Szerver hiba' } }); }
  };

handlers.devCompanyCreate = async function (req, res, args) {
      const isDev = req.session.user && req.session.user.is_dev;
    if (!isDev) return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
    try {
      const f = args[0] || {};
      const r = await pool.query(
        `INSERT INTO companies (nev, subscription_status, paid_until, email_contact, telefon, max_users, max_trucks, igazgato_nev)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [f.nev, f.subscription_status||'active', f.paid_until||null, f.email_contact||null, f.telefon||null, f.max_users||10, f.max_trucks||10, f.igazgato_nev||null]
      );
      const companyId = r.rows[0].id;

      // Auto Admin meghivokod generalas
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let kod = 'VS-';
      for (let i = 0; i < 6; i++) kod += chars.charAt(Math.floor(Math.random() * chars.length));

      await pool.query(
        `INSERT INTO invites (kod, pozicio, email, status, company_id, nume, tel) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [kod, 'Admin', f.email_contact||null, 'Aktiv', companyId]
      );

      if (f.email_contact) {
        sendInviteEmail(f.email_contact, kod, 'Admin', f.nev, f.igazgato_nev||null)
          .catch(e => console.error('Email hatter hiba:', e.message));
      }

      return res.json({ result: { ok: true, id: companyId, invite_kod: kod } });
    } catch (err) { return res.json({ result: { ok: false, err: 'Szerver hiba' } }); }
  };

handlers.devCompanyDelete = async function (req, res, args) {
      const isDev = req.session.user && req.session.user.is_dev;
    if (!isDev) return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
    try {
      const id = parseInt(args[0], 10);
      const kod = String(args[1] || '');
      if (kod !== 'vallorsoftcegtorlo1') {
        return res.json({ result: { ok: false, err: 'Helytelen megerosito kod.' } });
      }
      // Cascade torles — tranzakcióban: félbeszakadásnál ne maradjanak árva sorok
      const dbc = await pool.connect();
      try {
        await dbc.query('BEGIN');
        const users = await dbc.query('SELECT email FROM users WHERE company_id = $1', [id]);
        const emails = users.rows.map(u => u.email);
        if (emails.length > 0) {
          await dbc.query('DELETE FROM border_crossings WHERE email_sofer = ANY($1)', [emails]);
          await dbc.query('DELETE FROM documents WHERE email_sofer = ANY($1)', [emails]);
          await dbc.query('DELETE FROM fuvarlevelek WHERE email_sofer = ANY($1)', [emails]);
          await dbc.query('DELETE FROM stamps WHERE email = ANY($1)', [emails]);
        }
        const orderIds = await dbc.query('SELECT id FROM orders WHERE company_id = $1', [id]);
        if (orderIds.rows.length > 0) {
          const oids = orderIds.rows.map(o => o.id);
          await dbc.query('DELETE FROM order_documents WHERE order_id = ANY($1)', [oids]);
          await dbc.query('DELETE FROM order_legs WHERE order_id = ANY($1)', [oids]);
        }
        await dbc.query('DELETE FROM orders WHERE company_id = $1', [id]);
        await dbc.query('DELETE FROM invites WHERE company_id = $1', [id]);
        await dbc.query('DELETE FROM users WHERE company_id = $1', [id]);
        await dbc.query('DELETE FROM companies WHERE id = $1', [id]);
        await dbc.query('COMMIT');
      } catch (txErr) {
        await dbc.query('ROLLBACK').catch(() => {});
        throw txErr;
      } finally {
        dbc.release();
      }
      return res.json({ result: { ok: true } });
    } catch (err) {
      console.error('devCompanyDelete hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  };

handlers.devUserList = async function (req, res, args) {
      const isDev = req.session.user && req.session.user.is_dev;
    if (!isDev) return res.json({ result: [] });
    try {
      const r = await pool.query(`
        SELECT u.id, u.nume, u.email, u.pozicio, u.company_id, u.blocked,
               (u.pozicio_dev IS TRUE) AS is_dev, c.nev AS ceg_nev
        FROM users u LEFT JOIN companies c ON c.id = u.company_id
        ORDER BY c.nev, u.pozicio
      `);
      return res.json({ result: r.rows });
    } catch (err) { return res.json({ result: [] }); }
  };

// ─── Funkció-kapcsolók (előfizetés) cégenként ───────────────
handlers.devGetCompanyFeatures = async function (req, res, args) {
  const isDev = req.session.user && req.session.user.is_dev;
  if (!isDev) return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
  try {
    const cid = parseInt(args[0], 10);
    if (!cid) return res.json({ result: { ok: false, err: 'Hiányzó cég ID.' } });
    const r = await pool.query('SELECT feature_key, enabled FROM company_features WHERE company_id = $1', [cid]);
    const features = {};
    r.rows.forEach((row) => { features[row.feature_key] = row.enabled; });
    return res.json({ result: { ok: true, features } });
  } catch (err) {
    console.error('devGetCompanyFeatures hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
  }
};

handlers.devSetCompanyFeature = async function (req, res, args) {
  const isDev = req.session.user && req.session.user.is_dev;
  if (!isDev) return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
  try {
    const cid = parseInt(args[0], 10);
    const key = String(args[1] || '').trim();
    const enabled = !!args[2];
    if (!cid || !key || key.length > 60) return res.json({ result: { ok: false, err: 'Hiányzó adat.' } });
    await pool.query(
      `INSERT INTO company_features (company_id, feature_key, enabled, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (company_id, feature_key) DO UPDATE SET enabled = $3, updated_at = now()`,
      [cid, key, enabled]
    );
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('devSetCompanyFeature hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
  }
};

// ─── Felhasználó tiltása / törlése (developer) ──────────────
handlers.devUserSetBlocked = async function (req, res, args) {
  const isDev = req.session.user && req.session.user.is_dev;
  if (!isDev) return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
  try {
    const id = parseInt(args[0], 10);
    const blocked = !!args[1];
    if (!id) return res.json({ result: { ok: false, err: 'Hiányzó user ID.' } });
    const u = await pool.query('SELECT pozicio_dev FROM users WHERE id = $1', [id]);
    if (!u.rows.length) return res.json({ result: { ok: false, err: 'Felhasználó nem található.' } });
    if (u.rows[0].pozicio_dev) return res.json({ result: { ok: false, err: 'Developer fiók nem tiltható.' } });
    await pool.query('UPDATE users SET blocked = $1 WHERE id = $2', [blocked, id]);
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('devUserSetBlocked hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
  }
};

handlers.devUserDelete = async function (req, res, args) {
  const isDev = req.session.user && req.session.user.is_dev;
  if (!isDev) return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
  try {
    const id = parseInt(args[0], 10);
    if (!id) return res.json({ result: { ok: false, err: 'Hiányzó user ID.' } });
    const u = await pool.query('SELECT email, pozicio_dev FROM users WHERE id = $1', [id]);
    if (!u.rows.length) return res.json({ result: { ok: false, err: 'Felhasználó nem található.' } });
    if (u.rows[0].pozicio_dev) return res.json({ result: { ok: false, err: 'Developer fiók nem törölhető.' } });
    if (id === req.session.user.id) return res.json({ result: { ok: false, err: 'Saját fiók nem törölhető.' } });
    const email = u.rows[0].email;
    // A felhasználó személyes adatainak takarítása (email alapján)
    await pool.query('DELETE FROM border_crossings WHERE LOWER(email_sofer) = LOWER($1)', [email]);
    await pool.query('DELETE FROM documents WHERE LOWER(email_sofer) = LOWER($1)', [email]);
    await pool.query('DELETE FROM fuvarlevelek WHERE LOWER(email_sofer) = LOWER($1)', [email]);
    await pool.query('DELETE FROM stamps WHERE LOWER(email) = LOWER($1)', [email]);
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('devUserDelete hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
  }
};

handlers.sendBugReport = async function (req, res, args) {
    try {
      if (!req.session.user) return res.json({ result: { ok: false, err: 'Nincs bejelentkezve.' } });
      const szoveg = String(args[0] || '').trim();
      const oldal  = String(args[1] || '').trim();
      if (!szoveg || szoveg.length < 5) return res.json({ result: { ok: false, err: 'Írj le legalább 5 karaktert!' } });
      if (szoveg.length > 2000) return res.json({ result: { ok: false, err: 'Túl hosszú szöveg (max 2000 karakter).' } });
      await pool.query(
        `INSERT INTO bug_reports (company_id, user_email, user_name, user_role, szoveg, oldal)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [req.session.user.company_id||null, req.session.user.email, req.session.user.nume, req.session.user.pozicio, szoveg, oldal||null]
      );
      return res.json({ result: { ok: true } });
    } catch (err) {
      console.error('sendBugReport hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba.' } });
    }
  };

handlers.getBugReports = async function (req, res, args) {
      const isDev = req.session.user && req.session.user.is_dev;
    if (!isDev) return res.json({ result: [] });
    try {
      const companyId = args[0] ? parseInt(args[0]) : null;
      const r = companyId
        ? await pool.query(
            `SELECT b.*, c.nev AS ceg_nev FROM bug_reports b
             LEFT JOIN companies c ON c.id = b.company_id
             WHERE b.company_id = $1 ORDER BY b.created_at DESC LIMIT 100`,
            [companyId])
        : await pool.query(
            `SELECT b.*, c.nev AS ceg_nev FROM bug_reports b
             LEFT JOIN companies c ON c.id = b.company_id
             ORDER BY b.created_at DESC LIMIT 200`);
      return res.json({ result: r.rows });
    } catch (err) {
      console.error('getBugReports hiba:', err);
      return res.json({ result: [] });
    }
  };

handlers.markBugRead = async function (req, res, args) {
      const isDev = req.session.user && req.session.user.is_dev;
    if (!isDev) return res.json({ result: { ok: false } });
    try {
      const id = parseInt(args[0]);
      await pool.query('UPDATE bug_reports SET is_read = TRUE WHERE id = $1', [id]);
      return res.json({ result: { ok: true } });
    } catch (err) {
      return res.json({ result: { ok: false } });
    }
  };

handlers.devCompanyDetail = async function (req, res, args) {
      const isDev = req.session.user && req.session.user.is_dev;
    if (!isDev) return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
    try {
      const cid = parseInt(args[0]);
      if (!cid) return res.json({ result: { ok: false, err: 'Hiányzó cég ID.' } });

      const users = await pool.query(`
        SELECT
          u.id, u.nume, u.email, u.pozicio, u.tel,
          (SELECT COUNT(*)::int FROM orders o
           WHERE o.company_id = $1 AND LOWER(o.email_sofer) = LOWER(u.email)) AS fuvarok_kezelt,
          (SELECT COUNT(*)::int FROM fuvarlevelek fl
           WHERE LOWER(fl.email_sofer) = LOWER(u.email)) AS menetlevelek,
          (SELECT COUNT(*)::int FROM documents d
           WHERE LOWER(d.email_sofer) = LOWER(u.email)) AS dokumentumok,
          (SELECT COUNT(*)::int FROM border_crossings b
           WHERE LOWER(b.email_sofer) = LOWER(u.email)) AS hataratlepesek,
          (SELECT MAX(bc.created_at) FROM border_crossings bc
           WHERE LOWER(bc.email_sofer) = LOWER(u.email)) AS utolso_aktiv
        FROM users u
        WHERE u.company_id = $1 AND (u.pozicio_dev IS NOT TRUE)
        ORDER BY u.pozicio, u.nume
      `, [cid]);

      const osszesito = await pool.query(`
        SELECT
          (SELECT COUNT(*)::int FROM orders WHERE company_id = $1) AS osszes_fuvar,
          (SELECT COUNT(*)::int FROM orders WHERE company_id = $1 AND status IN ('In Curs','Alocat')) AS aktiv_fuvar,
          (SELECT COUNT(*)::int FROM fuvarlevelek fl JOIN users u ON LOWER(u.email)=LOWER(fl.email_sofer) WHERE u.company_id=$1) AS osszes_menetlevel,
          (SELECT COUNT(*)::int FROM documents d JOIN users u ON LOWER(u.email)=LOWER(d.email_sofer) WHERE u.company_id=$1) AS osszes_dok,
          (SELECT COUNT(*)::int FROM bug_reports WHERE company_id=$1) AS osszes_hiba,
          (SELECT COUNT(*)::int FROM bug_reports WHERE company_id=$1 AND is_read=FALSE) AS olvasatlan_hiba
      `, [cid]);

      return res.json({ result: { ok: true, users: users.rows, osszesito: osszesito.rows[0] }});
    } catch (err) {
      console.error('devCompanyDetail hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  };

handlers.devStats = async function (req, res, args) {
      const isDev = req.session.user && req.session.user.is_dev;
    if (!isDev) return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
    try {
      const cegek = await pool.query('SELECT COUNT(*)::int AS db FROM companies');
      const userek = await pool.query('SELECT COUNT(*)::int AS db FROM users WHERE pozicio_dev IS NOT TRUE');
      const fuvarok = await pool.query('SELECT COUNT(*)::int AS db FROM orders');
      const aktiv = await pool.query("SELECT COUNT(*)::int AS db FROM companies WHERE subscription_status='active'");
      return res.json({ result: { ok: true,
        cegek: cegek.rows[0].db,
        userek: userek.rows[0].db,
        fuvarok: fuvarok.rows[0].db,
        aktiv_cegek: aktiv.rows[0].db
      }});
    } catch (err) { return res.json({ result: { ok: false } }); }
  };

module.exports = handlers;
