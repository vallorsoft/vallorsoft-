// ============================================================
//  VallorSoft — handlers/documents.js
//  AUTO-KIVÁGOTT a régi server.js /api/execute ágaiból.
//  A handler-törzsek BÁJTRA AZONOSAK az eredetivel.
//  Hívás: handlers.<funkcioNev>(req, res, args)
// ============================================================
const pool = require('../db');

const handlers = {};

handlers.stampGet = async function (req, res, args) {
    try {
      if (!req.session.user) return res.json({ result: { ok: false, err: 'Nincs bejelentkezve' } });
      const email = req.session.user.email;
      const r = await pool.query('SELECT base64_png FROM stamps WHERE email = $1', [email]);
      if (r.rows.length && r.rows[0].base64_png) {
        return res.json({ result: { ok: true, base64: r.rows[0].base64_png } });
      }
      return res.json({ result: { ok: true, base64: null } });
    } catch (err) {
      console.error('stampGet hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  };

handlers.stampSave = async function (req, res, args) {
    try {
      if (!req.session.user) return res.json({ result: { ok: false, err: 'Nincs bejelentkezve' } });
      const email = req.session.user.email;
      const b64 = args[0];
      if (!b64) return res.json({ result: { ok: false, err: 'Hianyzo kep' } });
      await pool.query(
        `INSERT INTO stamps (email, base64_png, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (email)
         DO UPDATE SET base64_png = EXCLUDED.base64_png, updated_at = NOW()`,
        [email, b64]
      );
      return res.json({ result: { ok: true } });
    } catch (err) {
      console.error('stampSave hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  };

handlers.orderDocList = async function (req, res, args) {
    try {
      if (!req.session.user) return res.json({ result: [] });
      const orderId = String(args[0] || '').trim();
      if (!orderId) return res.json({ result: [] });
      const r = await pool.query(
        `SELECT od.id, od.file_name, od.uploaded_by, od.created_at,
                (od.signed_base64 IS NOT NULL) AS has_signed
         FROM order_documents od
         JOIN orders o ON o.id = od.order_id
         WHERE od.order_id = $1 AND o.company_id = $2
         ORDER BY od.created_at DESC`,
        [orderId, req.session.user.company_id]
      );
      return res.json({ result: r.rows });
    } catch (err) {
      console.error('orderDocList hiba:', err);
      return res.json({ result: [] });
    }
  };

handlers.orderDocUpload = async function (req, res, args) {
    try {
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      }
      const orderId = String(args[0] || '').trim();
      const fileName = String(args[1] || '').trim();
      const b64 = args[2];
      if (!orderId || !fileName || !b64) {
        return res.json({ result: { ok: false, err: 'Hianyzo adat' } });
      }
      const r = await pool.query(
        `INSERT INTO order_documents (order_id, file_name, original_base64, uploaded_by, company_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [orderId, fileName, b64, req.session.user.nume || req.session.user.email, req.session.user.company_id]
      );
      return res.json({ result: { ok: true, docId: r.rows[0].id } });
    } catch (err) {
      console.error('orderDocUpload hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  };

handlers.orderDocGet = async function (req, res, args) {
    try {
      if (!req.session.user) return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      const docId = parseInt(args[0], 10);
      const which = args[1] === 'signed' ? 'signed' : 'original';
      if (!docId) return res.json({ result: { ok: false, err: 'Hianyzo azonosito' } });
      const r = await pool.query(
        `SELECT file_name, original_base64, signed_base64 FROM order_documents WHERE id = $1`,
        [docId]
      );
      if (!r.rows.length) return res.json({ result: { ok: false, err: 'Nem talalhato' } });
      const row = r.rows[0];
      const base64 = which === 'signed' ? row.signed_base64 : row.original_base64;
      if (!base64) return res.json({ result: { ok: false, err: 'Nincs ilyen valtozat' } });
      return res.json({ result: { ok: true, base64, fileName: row.file_name } });
    } catch (err) {
      console.error('orderDocGet hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  };

handlers.orderDocSaveSigned = async function (req, res, args) {
    try {
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      }
      const docId = parseInt(args[0], 10);
      const b64 = args[1];
      if (!docId || !b64) return res.json({ result: { ok: false, err: 'Hianyzo adat' } });
      const r = await pool.query(
        `UPDATE order_documents SET signed_base64 = $1, updated_at = NOW()
         WHERE id = $2 RETURNING id`,
        [b64, docId]
      );
      if (!r.rows.length) return res.json({ result: { ok: false, err: 'Nem talalhato' } });
      return res.json({ result: { ok: true } });
    } catch (err) {
      console.error('orderDocSaveSigned hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  };

handlers.getFuvarlevelek = async function (req, res, args) {
    try {
      if (!req.session.user) return res.json({ result: [] });
      const me = req.session.user;
      const cid = me.company_id;
      const isAdmin = ['Admin', 'Manager'].includes(me.pozicio);
      let r;
      if (isAdmin && cid) {
        // Cég összes sofőrjének menetlevelei — email lista alapján (nem JOIN, megbízhatóbb online)
        const sofors = await pool.query(
          'SELECT email FROM users WHERE company_id = $1 AND pozicio = $2', [cid, 'Sofer']
        );
        const emails = sofors.rows.map(u => u.email);
        if (!emails.length) return res.json({ result: [] });
        r = await pool.query(
          `SELECT id, file_name, numar_fisa, email_sofer, nume_sofer, data_completare, total_km, consum_100, order_ids
           FROM fuvarlevelek WHERE email_sofer = ANY($1)
           ORDER BY data_completare DESC LIMIT 200`,
          [emails]
        );
      } else {
        r = await pool.query(
          `SELECT id, file_name, numar_fisa, email_sofer, nume_sofer, data_completare, total_km, consum_100, order_ids
           FROM fuvarlevelek WHERE email_sofer = $1
           ORDER BY data_completare DESC`,
          [me.email]
        );
      }
      return res.json({ result: r.rows });
    } catch (err) {
      console.error('getFuvarlevelek hiba:', err);
      return res.json({ result: [] });
    }
  };

// Egy menetlevél teljes adata — szerkesztéshez (Admin/Manager, cégre szűrve).
handlers.getFuvarlevelDetail = async function (req, res, args) {
    try {
      if (!req.session.user) return res.json({ result: { ok: false, err: 'Nincs bejelentkezve' } });
      const me = req.session.user;
      if (!['Admin', 'Manager'].includes(me.pozicio)) return res.json({ result: { ok: false, err: 'Nincs jogosultság' } });
      const id = Array.isArray(args) ? args[0] : args;
      if (!id) return res.json({ result: { ok: false, err: 'Hiányzó azonosító' } });
      // Csak a saját cég sofőrjeinek menetlevele érhető el.
      const r = await pool.query(
        `SELECT * FROM fuvarlevelek
         WHERE id = $1 AND email_sofer IN (SELECT email FROM users WHERE company_id = $2)`,
        [id, me.company_id]
      );
      if (!r.rows.length) return res.json({ result: { ok: false, err: 'Nem található' } });
      return res.json({ result: { ok: true, fuv: r.rows[0] } });
    } catch (err) {
      console.error('getFuvarlevelDetail hiba:', err);
      return res.json({ result: { ok: false, err: err.message } });
    }
  };

// Menetlevél szerkesztése (Admin/Manager, cégre szűrve). A derivált mezőket
// (total_km, total_alim, motorina_folosit, consum_100) szerveroldalon számoljuk.
handlers.fuvarlevelUpdate = async function (req, res, args) {
    try {
      if (!req.session.user) return res.json({ result: { ok: false, err: 'Nincs bejelentkezve' } });
      const me = req.session.user;
      if (!['Admin', 'Manager'].includes(me.pozicio)) return res.json({ result: { ok: false, err: 'Nincs jogosultság' } });
      const id = Array.isArray(args) ? args[0] : null;
      const d = (Array.isArray(args) ? args[1] : null) || {};
      if (!id) return res.json({ result: { ok: false, err: 'Hiányzó azonosító' } });

      // Jogosultság + létezés: csak saját cég menetlevele.
      const own = await pool.query(
        `SELECT id FROM fuvarlevelek WHERE id = $1 AND email_sofer IN (SELECT email FROM users WHERE company_id = $2)`,
        [id, me.company_id]
      );
      if (!own.rows.length) return res.json({ result: { ok: false, err: 'Nem található / nincs jogosultság' } });

      const alimentari = Array.isArray(d.alimentari) ? d.alimentari : [];
      const achizitii  = Array.isArray(d.achizitii)  ? d.achizitii  : [];
      const puncte     = Array.isArray(d.puncte)      ? d.puncte      : [];

      const kmInc = Number(d.km_inceput || 0);
      const kmSf  = Number(d.km_sfarsit || 0);
      const totalKm = Math.max(0, kmSf - kmInc);
      let totalAlim = 0;
      alimentari.forEach(a => { totalAlim += Number(a.litru || 0); });
      const cantInc = Number(d.cant_inceput || 0);
      const cantSf  = Number(d.cant_sfarsit || 0);
      const motorinaFolosit = Math.max(0, cantInc + totalAlim - cantSf);
      const consum100 = totalKm > 0 ? Math.round((motorinaFolosit / totalKm * 100) * 100) / 100 : 0;

      await pool.query(
        `UPDATE fuvarlevelek SET
           nume_sofer = $2, numar_camion = $3, numar_remorca = $4, numar_fisa = $5,
           km_inceput = $6, km_sfarsit = $7, total_km = $8,
           diurna_externa = $9, diurna_interna = $10,
           cant_inceput = $11, cant_sfarsit = $12, motorina_folosit = $13, total_alim = $14, consum_100 = $15,
           alte_mentiuni = $16, alimentari = $17, achizitii = $18, puncte = $19
         WHERE id = $1`,
        [
          id,
          d.nume_sofer || null, d.numar_camion || null, d.numar_remorca || null, d.numar_fisa || null,
          kmInc, kmSf, totalKm,
          parseInt(d.diurna_externa || 0), parseInt(d.diurna_interna || 0),
          cantInc, cantSf, motorinaFolosit, totalAlim, consum100,
          d.alte_mentiuni || null,
          JSON.stringify(alimentari), JSON.stringify(achizitii), JSON.stringify(puncte)
        ]
      );
      return res.json({ result: { ok: true, total_km: totalKm, consum_100: consum100 } });
    } catch (err) {
      console.error('fuvarlevelUpdate hiba:', err);
      return res.json({ result: { ok: false, err: err.message } });
    }
  };

handlers.getDriverDocs = async function (req, res, args) {
    try {
      if (!req.session.user) return res.json({ result: [] });
      const cid = req.session.user.company_id;
      const isAdmin = ['Admin', 'Manager'].includes(req.session.user.pozicio);
      const r = isAdmin
        ? await pool.query('SELECT d.id, d.email_sofer, d.nume_sofer, d.tip, d.file_name, d.created_at FROM documents d JOIN users u ON u.email = d.email_sofer WHERE u.company_id = $1 ORDER BY d.created_at DESC LIMIT 200', [cid])
        : await pool.query('SELECT id, email_sofer, nume_sofer, tip, file_name, created_at FROM documents WHERE email_sofer = $1 ORDER BY created_at DESC', [req.session.user.email]);
      return res.json({ result: r.rows });
    } catch (err) {
      console.error('getDriverDocs hiba:', err);
      return res.json({ result: [] });
    }
  };

handlers.getBorderLogs = async function (req, res, args) {
    try {
      if (!req.session.user) return res.json({ result: [] });
      const cid = req.session.user.company_id;
      const isAdmin = ['Admin', 'Manager'].includes(req.session.user.pozicio);
      const r = isAdmin
        ? await pool.query('SELECT bc.* FROM border_crossings bc JOIN users u ON u.email = bc.email_sofer WHERE u.company_id = $1 ORDER BY bc.created_at DESC LIMIT 200', [cid])
        : await pool.query('SELECT * FROM border_crossings WHERE email_sofer = $1 ORDER BY created_at DESC', [req.session.user.email]);
      return res.json({ result: r.rows });
    } catch (err) {
      console.error('getBorderLogs hiba:', err);
      return res.json({ result: [] });
    }
  };

module.exports = handlers;
