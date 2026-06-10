// ============================================================
//  VallorSoft — handlers/orders.js
//  AUTO-KIVÁGOTT a régi server.js /api/execute ágaiból.
//  A handler-törzsek BÁJTRA AZONOSAK az eredetivel.
//  Hívás: handlers.<funkcioNev>(req, res, args)
// ============================================================
const pool = require('../db');
const { genDocId } = require('../lib/ids');

const handlers = {};

handlers.getOrderById = async function (req, res, args) {
    try {
      if (!req.session.user || !['Admin','Manager'].includes(req.session.user.pozicio))
        return res.json({ result: null, legs: [] });
      const id = String(args[0] || '').trim();
      const cid = req.session.user.company_id;
      const or = await pool.query(
        'SELECT * FROM orders WHERE id = $1 AND company_id = $2',
        [id, cid]
      );
      const order = or.rows[0] || null;
      let legs = [];
      if (order) {
        const lr = await pool.query(
          'SELECT * FROM order_legs WHERE order_id = $1 ORDER BY leg_number',
          [id]
        );
        legs = lr.rows;
      }
      return res.json({ result: order, legs });
    } catch (err) {
      console.error('getOrderById hiba:', err);
      return res.json({ result: null, legs: [] });
    }
  };

handlers.comList = async function (req, res, args) {
    try {
      if (!req.session.user) return res.json({ result: [] });
      const me = req.session.user;
      const cid = me.company_id;
      // Kozos subquery: order_legs aggregacio (szakaszok szama + reszletek)
      const legsSubquery = `
        LEFT JOIN (
          SELECT order_id,
                 COUNT(*)::int AS leg_count,
                 JSON_AGG(
                   JSON_BUILD_OBJECT(
                     'leg_number',    leg_number,
                     'sofer',         COALESCE(nume_sofer, email_sofer, firma_extern, '—'),
                     'rendszam',      COALESCE(rendszam_camion, ''),
                     'loc_preluare',  COALESCE(loc_preluare, '')
                   ) ORDER BY leg_number
                 ) AS legs_json
          FROM order_legs
          GROUP BY order_id
        ) legs ON legs.order_id = o.id`;
      let r;
      if (me.pozicio === 'Admin' || me.pozicio === 'Manager') {
        r = await pool.query(
          `SELECT o.id, o.client, o.ref, o.loc_incarcare, o.loc_descarcare,
                  o.pret, o.km, o.status, o.sofer_type, o.email_sofer, o.nume_sofer,
                  o.firma_extern, o.telefon_extern, o.rendszam_camion, o.rendszam_remorca,
                  COALESCE(legs.leg_count, 0) AS leg_count,
                  COALESCE(legs.legs_json, '[]'::json) AS legs_json
           FROM orders o ${legsSubquery}
           WHERE o.company_id = $1 ORDER BY o.created_at DESC`,
          [cid]
        );
      } else {
        // Sofernek csak a sajat nevere kiosztott fuvarok latszanak
        r = await pool.query(
          `SELECT o.id, o.client, o.ref, o.loc_incarcare, o.loc_descarcare,
                  o.pret, o.km, o.status, o.sofer_type, o.email_sofer, o.nume_sofer,
                  o.firma_extern, o.telefon_extern, o.rendszam_camion, o.rendszam_remorca,
                  COALESCE(legs.leg_count, 0) AS leg_count,
                  COALESCE(legs.legs_json, '[]'::json) AS legs_json
           FROM orders o ${legsSubquery}
           WHERE o.company_id = $1 AND LOWER(o.email_sofer) = LOWER($2)
           ORDER BY o.created_at DESC`,
          [cid, me.email]
        );
      }
      return res.json({ result: r.rows });
    } catch (err) {
      console.error('comList hiba:', err);
      return res.json({ result: [] });
    }
  };

handlers.getMySoferOrders = async function (req, res, args) {
    try {
      if (!req.session.user) return res.json({ result: [] });
      const me = req.session.user;
      // finalized_at: a Finalizat időbélyege (3-napos dashboard-kiöregítés).
      // waybill_at: a legkorábbi mentett menetlevél dátuma, amin szerepel a fuvar
      //   (a fuvarlevelek.order_ids JSONB tömb tartalmazza-e a fuvar id-jét).
      // dash_visible: aktív (Alocat/In Curs) VAGY Finalizat a teljesítéstől max 3 napig.
      // waybill_visible: minden kiosztott fuvar, DE a mentett menetlevél után csak 3 napig.
      const r = await pool.query(
        `SELECT o.id, o.client, o.ref, o.loc_incarcare, o.loc_descarcare, o.km,
                o.rendszam_camion, o.rendszam_remorca, o.status,
                o.finalized_at, wb.waybill_at,
                (
                  o.status IN ('Alocat', 'In Curs')
                  OR (o.status = 'Finalizat'
                      AND COALESCE(o.finalized_at, o.updated_at) >= NOW() - INTERVAL '3 days')
                ) AS dash_visible,
                (
                  wb.waybill_at IS NULL
                  OR wb.waybill_at >= NOW() - INTERVAL '3 days'
                ) AS waybill_visible
           FROM orders o
           LEFT JOIN LATERAL (
             SELECT MIN(f.data_completare) AS waybill_at
               FROM fuvarlevelek f
              WHERE f.order_ids ? o.id::text -- a ? operátor használja a GIN indexet (a jsonb_exists nem)
           ) wb ON true
          WHERE o.company_id = $1 AND LOWER(o.email_sofer) = LOWER($2)
          ORDER BY o.created_at DESC`,
        [me.company_id, me.email]
      );
      return res.json({ result: r.rows });
    } catch (err) {
      console.error('getMySoferOrders hiba:', err);
      return res.json({ result: [] });
    }
  };

handlers.comCreate = async function (req, res, args) {
    try {
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      }

      const o = args[0] || {};
      const id = genDocId('CMD');
      const client = String(o.client || '').trim();
      const ref = String(o.ref || '').trim();
      const pret = Number(o.pret || 0);
      const km = Number(o.km || 0);
      const loc_incarcare = String(o.loc_incarcare || '').trim();
      const loc_descarcare = String(o.loc_descarcare || '').trim();
      const data_incarcare = o.data_incarcare || null;
      const data_descarcare = o.data_descarcare || null;
      const sofer_type = o.sofer_type || null;
      const email_sofer = o.email_sofer ? String(o.email_sofer).trim().toLowerCase() : null;
      const nume_sofer = o.nume_sofer ? String(o.nume_sofer).trim() : null;
      const firma_extern = o.firma_extern ? String(o.firma_extern).trim() : null;
      const telefon_extern = o.telefon_extern ? String(o.telefon_extern).trim() : null;
      const external_driver_id = o.external_driver_id ? parseInt(o.external_driver_id, 10) : null;
      const rendszam_camion = o.rendszam_camion ? String(o.rendszam_camion).trim().toUpperCase() : null;
      const rendszam_remorca = o.rendszam_remorca ? String(o.rendszam_remorca).trim().toUpperCase() : null;
      const company_id = req.session.user.company_id;

      let status = 'Disponibil';
      if (sofer_type === 'Intern' && email_sofer) status = 'Alocat';
      else if (sofer_type === 'Extern') status = 'Extern';

      await pool.query(
        `INSERT INTO orders (
          id, client, ref, loc_incarcare, loc_descarcare,
          data_incarcare, data_descarcare, pret, km,
          sofer_type, email_sofer, nume_sofer,
          firma_extern, telefon_extern, external_driver_id,
          rendszam_camion, rendszam_remorca, status, company_id
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
        )`,
        [
          id, client, ref, loc_incarcare, loc_descarcare,
          data_incarcare, data_descarcare, pret, km,
          sofer_type, email_sofer, nume_sofer,
          firma_extern, telefon_extern, external_driver_id,
          rendszam_camion, rendszam_remorca, status, company_id
        ]
      );

      await pool.query(
        `INSERT INTO order_legs (
          order_id, leg_number, sofer_type, email_sofer, nume_sofer,
          firma_extern, telefon_extern, external_driver_id,
          rendszam_camion, rendszam_remorca,
          loc_preluare, data_preluare, company_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          id, 1, sofer_type, email_sofer, nume_sofer,
          firma_extern, telefon_extern, external_driver_id,
          rendszam_camion, rendszam_remorca,
          loc_incarcare, data_incarcare, company_id
        ]
      );

      return res.json({ result: { ok: true, id: id } });
    } catch (err) {
      console.error('comCreate hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  };

handlers.comUpdate = async function (req, res, args) {
    try {
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      }

      const id = String(args[0] || '').trim();
      const o = args[1] || {};

      if (!id) {
        return res.json({ result: { ok: false, err: 'ID kotelezo.' } });
      }

      const updates = [];
      const values = [];
      let i = 1;

      if (o.client !== undefined) { updates.push(`client = $${i++}`); values.push(o.client); }
      if (o.ref !== undefined) { updates.push(`ref = $${i++}`); values.push(o.ref); }
      if (o.loc_incarcare !== undefined) { updates.push(`loc_incarcare = $${i++}`); values.push(o.loc_incarcare); }
      if (o.loc_descarcare !== undefined) { updates.push(`loc_descarcare = $${i++}`); values.push(o.loc_descarcare); }
      if (o.data_incarcare !== undefined) { updates.push(`data_incarcare = $${i++}`); values.push(o.data_incarcare || null); }
      if (o.data_descarcare !== undefined) { updates.push(`data_descarcare = $${i++}`); values.push(o.data_descarcare || null); }
      if (o.pret !== undefined) { updates.push(`pret = $${i++}`); values.push(Number(o.pret || 0)); }
      if (o.km !== undefined) { updates.push(`km = $${i++}`); values.push(Number(o.km || 0)); }
      if (o.status !== undefined) {
        if (!['Disponibil','Alocat','Extern','In Curs','Finalizat','Anulat'].includes(o.status)) {
          return res.json({ result: { ok: false, err: 'Ervenytelen statusz.' } });
        }
        updates.push(`status = $${i++}`); values.push(o.status);
      }
      if (o.sofer_type !== undefined) { updates.push(`sofer_type = $${i++}`); values.push(o.sofer_type || null); }
      if (o.email_sofer !== undefined) { updates.push(`email_sofer = $${i++}`); values.push(o.email_sofer || null); }
      if (o.nume_sofer !== undefined) { updates.push(`nume_sofer = $${i++}`); values.push(o.nume_sofer || null); }
      if (o.firma_extern !== undefined) { updates.push(`firma_extern = $${i++}`); values.push(o.firma_extern || null); }
      if (o.telefon_extern !== undefined) { updates.push(`telefon_extern = $${i++}`); values.push(o.telefon_extern || null); }
      if (o.rendszam_camion !== undefined) { updates.push(`rendszam_camion = $${i++}`); values.push(o.rendszam_camion ? o.rendszam_camion.toUpperCase() : null); }
      if (o.rendszam_remorca !== undefined) { updates.push(`rendszam_remorca = $${i++}`); values.push(o.rendszam_remorca ? o.rendszam_remorca.toUpperCase() : null); }

      if (updates.length === 0) {
        return res.json({ result: { ok: false, err: 'Nincs mit modositani.' } });
      }

      updates.push(`updated_at = NOW()`);
      values.push(id);
      values.push(req.session.user.company_id);
      const sql = `UPDATE orders SET ${updates.join(', ')} WHERE id = $${i} AND company_id = $${i + 1}`;
      const r = await pool.query(sql, values);

      if (r.rowCount === 0) {
        return res.json({ result: { ok: false, err: 'Fuvar nem talalhato.' } });
      }
      return res.json({ result: { ok: true } });

    } catch (err) {
      console.error('comUpdate hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  };

handlers.comDelete = async function (req, res, args) {
    try {
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      }
      const id = String(args[0] || '').trim();
      if (!id) {
        return res.json({ result: { ok: false, err: 'ID kotelezo.' } });
      }
      const check = await pool.query(
        'SELECT id FROM orders WHERE id = $1 AND company_id = $2',
        [id, req.session.user.company_id]
      );
      if (!check.rows.length) {
        return res.json({ result: { ok: false, err: 'Fuvar nem talalhato vagy nincs jogosultsag.' } });
      }
      await pool.query('DELETE FROM order_legs WHERE order_id = $1', [id]);
      const r = await pool.query('DELETE FROM orders WHERE id = $1 AND company_id = $2', [id, req.session.user.company_id]);
      if (r.rowCount === 0) {
        return res.json({ result: { ok: false, err: 'Fuvar nem talalhato.' } });
      }
      return res.json({ result: { ok: true } });
    } catch (err) {
      console.error('comDelete hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  };

handlers.addOrderLeg = async function (req, res, args) {
    try {
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      }
      const orderId = String(args[0] || '').trim();
      const leg = args[1] || {};
      if (!orderId) return res.json({ result: { ok: false, err: 'Fuvar ID kotelezo.' } });
      const orderCheck = await pool.query(
        'SELECT id FROM orders WHERE id = $1 AND company_id = $2',
        [orderId, req.session.user.company_id]
      );
      if (!orderCheck.rows.length) return res.json({ result: { ok: false, err: 'Fuvar nem talalhato vagy nincs jogosultsag.' } });
      const legNumR = await pool.query(
        'SELECT COALESCE(MAX(leg_number), 0) + 1 AS next_num FROM order_legs WHERE order_id = $1',
        [orderId]
      );
      const legNum = legNumR.rows[0].next_num;
      await pool.query(
        `INSERT INTO order_legs
           (order_id, leg_number, sofer_type, email_sofer, nume_sofer, firma_extern,
            rendszam_camion, rendszam_remorca, loc_preluare, data_preluare, company_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          orderId, legNum,
          leg.sofer_type || null, leg.email_sofer || null, leg.nume_sofer || null, leg.firma_extern || null,
          leg.rendszam_camion ? leg.rendszam_camion.toUpperCase() : null,
          leg.rendszam_remorca ? leg.rendszam_remorca.toUpperCase() : null,
          leg.loc_preluare || null, leg.data_preluare || null,
          req.session.user.company_id
        ]
      );
      return res.json({ result: { ok: true, leg_number: legNum } });
    } catch (err) {
      console.error('addOrderLeg hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  };

handlers.deleteOrderLeg = async function (req, res, args) {
    try {
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      }
      const legId = parseInt(args[0], 10);
      if (!legId) return res.json({ result: { ok: false, err: 'Leg ID kotelezo.' } });
      const r = await pool.query(
        `DELETE FROM order_legs
         USING orders
         WHERE order_legs.id = $1
           AND order_legs.order_id = orders.id
           AND orders.company_id = $2`,
        [legId, req.session.user.company_id]
      );
      if (r.rowCount === 0) return res.json({ result: { ok: false, err: 'Nem talalhato vagy nincs jogosultsag.' } });
      return res.json({ result: { ok: true } });
    } catch (err) {
      console.error('deleteOrderLeg hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  };

module.exports = handlers;
