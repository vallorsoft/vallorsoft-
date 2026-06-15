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
    if (!isDev) return res.json({ result: { ok: false, err: 'Acces interzis' } });
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
    if (!isDev) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    try {
      const id = parseInt(args[0], 10);
      const f = args[1] || {};
      const updates = []; const values = []; let i = 1;
      if (f.nev !== undefined) { updates.push(`nev=$${i++}`); values.push(f.nev); }
      if (f.subscription_status !== undefined) { updates.push(`subscription_status=$${i++}`); values.push(f.subscription_status); }
      if (f.paid_until !== undefined) { updates.push(`paid_until=$${i++}`); values.push(f.paid_until || null); }
      if (f.email_contact !== undefined) { updates.push(`email_contact=$${i++}`); values.push(f.email_contact); }
      if (f.telefon !== undefined) { updates.push(`telefon=$${i++}`); values.push(f.telefon); }
      // NaN-védelem: nem szám bemenetnél NULL kerül a DB-be (22P02 hiba helyett)
      const intOrNull = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
      if (f.max_users !== undefined) { updates.push(`max_users=$${i++}`); values.push(intOrNull(f.max_users)); }
      if (f.max_trucks !== undefined) { updates.push(`max_trucks=$${i++}`); values.push(intOrNull(f.max_trucks)); }
      if (f.igazgato_nev !== undefined) { updates.push(`igazgato_nev=$${i++}`); values.push(f.igazgato_nev); }
      if (!updates.length) return res.json({ result: { ok: false, err: 'Nimic de modificat' } });
      values.push(id);
      await pool.query(`UPDATE companies SET ${updates.join(',')} WHERE id=$${i}`, values);
      return res.json({ result: { ok: true } });
    } catch (err) { return res.json({ result: { ok: false, err: 'Eroare de server' } }); }
  };

handlers.devCompanyCreate = async function (req, res, args) {
      const isDev = req.session.user && req.session.user.is_dev;
    if (!isDev) return res.json({ result: { ok: false, err: 'Acces interzis' } });
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
    } catch (err) { return res.json({ result: { ok: false, err: 'Eroare de server' } }); }
  };

handlers.devCompanyDelete = async function (req, res, args) {
      const isDev = req.session.user && req.session.user.is_dev;
    if (!isDev) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    try {
      const id = parseInt(args[0], 10);
      const kod = String(args[1] || '');
      if (kod !== 'vallorsoftcegtorlo1') {
        return res.json({ result: { ok: false, err: 'Cod de confirmare incorect.' } });
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
      return res.json({ result: { ok: false, err: 'Eroare de server' } });
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
  if (!isDev) return res.json({ result: { ok: false, err: 'Acces interzis' } });
  try {
    const cid = parseInt(args[0], 10);
    if (!cid) return res.json({ result: { ok: false, err: 'ID-ul firmei lipseste.' } });
    const r = await pool.query('SELECT feature_key, enabled FROM company_features WHERE company_id = $1', [cid]);
    const features = {};
    r.rows.forEach((row) => { features[row.feature_key] = row.enabled; });
    return res.json({ result: { ok: true, features } });
  } catch (err) {
    console.error('devGetCompanyFeatures hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

handlers.devSetCompanyFeature = async function (req, res, args) {
  const isDev = req.session.user && req.session.user.is_dev;
  if (!isDev) return res.json({ result: { ok: false, err: 'Acces interzis' } });
  try {
    const cid = parseInt(args[0], 10);
    const key = String(args[1] || '').trim();
    const enabled = !!args[2];
    if (!cid || !key || key.length > 60) return res.json({ result: { ok: false, err: 'Date lipsa.' } });
    await pool.query(
      `INSERT INTO company_features (company_id, feature_key, enabled, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (company_id, feature_key) DO UPDATE SET enabled = $3, updated_at = now()`,
      [cid, key, enabled]
    );
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('devSetCompanyFeature hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// ─── Felhasználó tiltása / törlése (developer) ──────────────
handlers.devUserSetBlocked = async function (req, res, args) {
  const isDev = req.session.user && req.session.user.is_dev;
  if (!isDev) return res.json({ result: { ok: false, err: 'Acces interzis' } });
  try {
    const id = parseInt(args[0], 10);
    const blocked = !!args[1];
    if (!id) return res.json({ result: { ok: false, err: 'ID-ul utilizatorului lipseste.' } });
    const u = await pool.query('SELECT pozicio_dev FROM users WHERE id = $1', [id]);
    if (!u.rows.length) return res.json({ result: { ok: false, err: 'Utilizatorul nu a fost gasit.' } });
    if (u.rows[0].pozicio_dev) return res.json({ result: { ok: false, err: 'Contul de developer nu poate fi blocat.' } });
    await pool.query('UPDATE users SET blocked = $1 WHERE id = $2', [blocked, id]);
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('devUserSetBlocked hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

handlers.devUserDelete = async function (req, res, args) {
  const isDev = req.session.user && req.session.user.is_dev;
  if (!isDev) return res.json({ result: { ok: false, err: 'Acces interzis' } });
  try {
    const id = parseInt(args[0], 10);
    if (!id) return res.json({ result: { ok: false, err: 'ID-ul utilizatorului lipseste.' } });
    const u = await pool.query('SELECT email, pozicio_dev FROM users WHERE id = $1', [id]);
    if (!u.rows.length) return res.json({ result: { ok: false, err: 'Utilizatorul nu a fost gasit.' } });
    if (u.rows[0].pozicio_dev) return res.json({ result: { ok: false, err: 'Contul de developer nu poate fi sters.' } });
    if (id === req.session.user.id) return res.json({ result: { ok: false, err: 'Contul propriu nu poate fi sters.' } });
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
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

handlers.sendBugReport = async function (req, res, args) {
    try {
      if (!req.session.user) return res.json({ result: { ok: false, err: 'Nu sunteti autentificat.' } });
      const szoveg = String(args[0] || '').trim();
      const oldal  = String(args[1] || '').trim();
      if (!szoveg || szoveg.length < 5) return res.json({ result: { ok: false, err: 'Scrie cel putin 5 caractere!' } });
      if (szoveg.length > 2000) return res.json({ result: { ok: false, err: 'Text prea lung (max 2000 caractere).' } });
      await pool.query(
        `INSERT INTO bug_reports (company_id, user_email, user_name, user_role, szoveg, oldal)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [req.session.user.company_id||null, req.session.user.email, req.session.user.nume, req.session.user.pozicio, szoveg, oldal||null]
      );
      return res.json({ result: { ok: true } });
    } catch (err) {
      console.error('sendBugReport hiba:', err);
      return res.json({ result: { ok: false, err: 'Eroare de server.' } });
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
    if (!isDev) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    try {
      const cid = parseInt(args[0]);
      if (!cid) return res.json({ result: { ok: false, err: 'ID-ul firmei lipseste.' } });

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
      return res.json({ result: { ok: false, err: 'Eroare de server' } });
    }
  };

// devCompanyAccess: cégenkénti HOZZÁFÉRÉS-statisztika (developer) —
// felhasználók + alvállalkozók + ügyfelek: meghívott / aktív / inaktív
// számok + ki mikor lépett be utoljára. A portál-userek (client_users/
// carrier_users) pass_hash NULL = még nem aktiválta a meghívót (meghívott).
handlers.devCompanyAccess = async function (req, res, args) {
  const isDev = req.session.user && req.session.user.is_dev;
  if (!isDev) return res.json({ result: { ok: false, err: 'Acces interzis' } });
  try {
    const cid = parseInt(Array.isArray(args) ? args[0] : args, 10);
    if (!cid) return res.json({ result: { ok: false, err: 'ID-ul firmei lipseste.' } });

    // ── Fő felhasználók (Admin/Manager/Sofer/Konyvelo) ──
    const usersR = await pool.query(
      `SELECT id, nume, email, pozicio, COALESCE(blocked,false) AS blocked, last_login
         FROM users WHERE company_id = $1 AND pozicio_dev IS NOT TRUE
         ORDER BY last_login DESC NULLS LAST, pozicio, nume`, [cid]);
    // Meghívott, még nem regisztrált fő-userek (aktív meghívók)
    const invR = await pool.query(
      `SELECT COUNT(*)::int AS db FROM invites WHERE company_id = $1 AND status = 'Aktiv'`, [cid]);

    // ── Alvállalkozó-portál userek (carrier_users) ──
    const carrierUsersR = await pool.query(
      `SELECT cu.nev AS nume, cu.email, c.nev AS carrier_nev, COALESCE(cu.activ,true) AS activ,
              (cu.pass_hash IS NOT NULL) AS activated, cu.last_login
         FROM carrier_users cu
         LEFT JOIN carriers c ON c.id = cu.carrier_id AND c.company_id = cu.company_id
        WHERE cu.company_id = $1
        ORDER BY cu.last_login DESC NULLS LAST, cu.nev`, [cid]).catch(() => ({ rows: [] }));
    const carriersCntR = await pool.query(
      `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE COALESCE(aktiv,true)) ::int AS active
         FROM carriers WHERE company_id = $1`, [cid]).catch(() => ({ rows: [{ total: 0, active: 0 }] }));

    // ── Ügyfél-portál userek (client_users) ──
    const clientUsersR = await pool.query(
      `SELECT cu.nev AS nume, cu.email, c.denumire AS client_nev, COALESCE(cu.activ,true) AS activ,
              (cu.pass_hash IS NOT NULL) AS activated, cu.last_login
         FROM client_users cu
         LEFT JOIN clients c ON c.id = cu.client_id AND c.company_id = cu.company_id
        WHERE cu.company_id = $1
        ORDER BY cu.last_login DESC NULLS LAST, cu.nev`, [cid]).catch(() => ({ rows: [] }));
    const clientsCntR = await pool.query(
      `SELECT COUNT(*)::int AS total FROM clients WHERE company_id = $1`, [cid]).catch(() => ({ rows: [{ total: 0 }] }));

    // Aggregátumok kiszámítása (aktív = bekapcsolt + aktiválta a belépést;
    // meghívott = portál-usernél pass_hash NULL; inaktív = activ=false).
    const portalAgg = (rows) => {
      let active = 0, invited = 0, inactive = 0;
      rows.forEach((r) => {
        if (!r.activ) inactive++;
        else if (!r.activated) invited++;
        else active++;
      });
      return { total: rows.length, active, invited, inactive };
    };
    const users = usersR.rows;
    const usersAgg = {
      total: users.length,
      active: users.filter((u) => !u.blocked).length,
      inactive: users.filter((u) => u.blocked).length,
      invited: invR.rows[0].db,   // aktív (még fel nem használt) meghívók
    };

    return res.json({ result: { ok: true,
      users: { list: users, agg: usersAgg },
      carriers: { total: carriersCntR.rows[0].total, active: carriersCntR.rows[0].active,
                  users: { list: carrierUsersR.rows, agg: portalAgg(carrierUsersR.rows) } },
      clients: { total: clientsCntR.rows[0].total,
                 users: { list: clientUsersR.rows, agg: portalAgg(clientUsersR.rows) } },
    } });
  } catch (err) {
    console.error('devCompanyAccess hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

handlers.devStats = async function (req, res, args) {
      const isDev = req.session.user && req.session.user.is_dev;
    if (!isDev) return res.json({ result: { ok: false, err: 'Acces interzis' } });
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

// ─── Beérkező regisztrációk ───────────────────────────────────
handlers.devGetTrialCompanies = async function (req, res, args) {
  if (!req.session.user || !req.session.user.is_dev) return res.json({ result: { ok: false, err: 'Acces interzis' } });
  try {
    const r = await pool.query(`
      SELECT c.id, c.nev, c.created_at, c.subscription_status, c.paid_until,
             sp.name AS plan_name,
             u.email AS admin_email, u.nume AS admin_name
      FROM companies c
      LEFT JOIN subscription_plans sp ON sp.id = c.subscription_plan_id
      LEFT JOIN users u ON u.company_id = c.id AND u.pozicio = 'Admin'
      ORDER BY c.created_at DESC
    `);
    return res.json({ result: { ok: true, companies: r.rows } });
  } catch (err) {
    console.error('devGetTrialCompanies hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

handlers.devGetEmailTemplate = async function (req, res, args) {
  if (!req.session.user || !req.session.user.is_dev) return res.json({ result: { ok: false, err: 'Acces interzis' } });
  try {
    const r = await pool.query("SELECT value FROM developer_settings WHERE key='email_template'");
    const tpl = r.rows.length ? r.rows[0].value : { subject: '', body: '' };
    return res.json({ result: { ok: true, template: tpl } });
  } catch (err) {
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

handlers.devSaveEmailTemplate = async function (req, res, args) {
  if (!req.session.user || !req.session.user.is_dev) return res.json({ result: { ok: false, err: 'Acces interzis' } });
  const a = Array.isArray(args) ? (args[0] || {}) : (args || {});
  const subject = String(a.subject || '').trim();
  const body    = String(a.body    || '').trim();
  if (!subject || !body) return res.json({ result: { ok: false, err: 'Subiectul și corpul sunt obligatorii.' } });
  try {
    await pool.query(
      `INSERT INTO developer_settings (key, value, updated_at)
       VALUES ('email_template', $1::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET value = $1::jsonb, updated_at = now()`,
      [JSON.stringify({ subject, body })]
    );
    return res.json({ result: { ok: true } });
  } catch (err) {
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

handlers.devSendCompanyEmail = async function (req, res, args) {
  if (!req.session.user || !req.session.user.is_dev) return res.json({ result: { ok: false, err: 'Acces interzis' } });
  const a = Array.isArray(args) ? (args[0] || {}) : (args || {});
  const companyId = parseInt(a.company_id, 10);
  if (!companyId) return res.json({ result: { ok: false, err: 'ID-ul firmei lipseste' } });
  try {
    const tplR = await pool.query("SELECT value FROM developer_settings WHERE key='email_template'");
    if (!tplR.rows.length || !tplR.rows[0].value.subject) {
      return res.json({ result: { ok: false, err: 'Nu exista sablon configurat. Salvati mai intai un sablon.' } });
    }
    const tpl = tplR.rows[0].value;
    const cR = await pool.query(
      `SELECT c.nev, c.paid_until, u.email, u.nume
       FROM companies c LEFT JOIN users u ON u.company_id = c.id AND u.pozicio = 'Admin'
       WHERE c.id = $1 LIMIT 1`, [companyId]);
    if (!cR.rows.length || !cR.rows[0].email) {
      return res.json({ result: { ok: false, err: 'Nu s-a gasit e-mail admin pentru aceasta firma.' } });
    }
    const row = cR.rows[0];
    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const paidUntil = row.paid_until ? new Date(row.paid_until).toLocaleDateString('ro-RO') : '—';
    const daysLeft = row.paid_until
      ? Math.max(0, Math.ceil((new Date(row.paid_until) - new Date()) / 86400000))
      : 0;
    function fillVars(s) {
      return s
        .replace(/\{\{ceg_nev\}\}/g, row.nev || '')
        .replace(/\{\{email\}\}/g, row.email || '')
        .replace(/\{\{paid_until\}\}/g, paidUntil)
        .replace(/\{\{nap_maradt\}\}/g, String(daysLeft))
        .replace(/\{\{subscription_url\}\}/g, appUrl + '/subscription');
    }
    const { sendDeveloperEmail } = require('../services/email');
    const sent = await sendDeveloperEmail(row.email, row.nev, fillVars(tpl.subject), fillVars(tpl.body));
    if (!sent.ok) return res.json({ result: { ok: false, err: sent.error || 'Trimitere esuata.' } });
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('devSendCompanyEmail hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

module.exports = handlers;
