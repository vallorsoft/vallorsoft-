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
          `SELECT id, file_name, email_sofer, nume_sofer, data_completare, total_km, consum_100, order_ids
           FROM fuvarlevelek WHERE email_sofer = ANY($1)
           ORDER BY data_completare DESC LIMIT 200`,
          [emails]
        );
      } else {
        r = await pool.query(
          `SELECT id, file_name, email_sofer, nume_sofer, data_completare, total_km, consum_100, order_ids
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
