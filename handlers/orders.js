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
      // Kozos subquery: order_legs aggregacio (szakaszok szama + reszletek).
      // LATERAL: csak az adott fuvar labait aggregalja (hasznalja az
      // idx_order_legs_order indexet) — a korabbi valtozat a TELJES
      // order_legs tablat aggregalta minden hivasnal.
      const legsSubquery = `
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS leg_count,
                 JSON_AGG(
                   JSON_BUILD_OBJECT(
                     'leg_number',    l.leg_number,
                     'sofer',         COALESCE(l.nume_sofer, l.email_sofer, l.firma_extern, '—'),
                     'rendszam',      COALESCE(l.rendszam_camion, ''),
                     'loc_preluare',  COALESCE(l.loc_preluare, '')
                   ) ORDER BY l.leg_number
                 ) AS legs_json
          FROM order_legs l
          WHERE l.order_id = o.id
        ) legs ON true`;
      let r;
      if (me.pozicio === 'Admin' || me.pozicio === 'Manager') {
        r = await pool.query(
          `SELECT o.id, o.client, o.ref, o.loc_incarcare, o.loc_descarcare,
                  o.pret, o.km, o.status, o.sofer_type, o.email_sofer, o.nume_sofer,
                  o.firma_extern, o.telefon_extern, o.rendszam_camion, o.rendszam_remorca,
                  o.payment_status, o.paid_amount,
                  (SELECT COUNT(*)::int FROM documents d WHERE d.order_id = o.id) AS pod_count,
                  COALESCE(legs.leg_count, 0) AS leg_count,
                  COALESCE(legs.legs_json, '[]'::json) AS legs_json
           FROM orders o ${legsSubquery}
           WHERE o.company_id = $1 ORDER BY o.created_at DESC LIMIT 500`,
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
           ORDER BY o.created_at DESC LIMIT 500`,
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

      // Tranzakció: a fuvar és az első láb együtt jöjjön létre — láb nélküli
      // fuvar ne maradhasson, ha a második INSERT elszáll.
      const dbc = await pool.connect();
      try {
        await dbc.query('BEGIN');
        await dbc.query(
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

        await dbc.query(
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
        await dbc.query('COMMIT');
      } catch (txErr) {
        await dbc.query('ROLLBACK').catch(() => {});
        throw txErr;
      } finally {
        dbc.release();
      }

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

// ─── Ügyfél tracking-link (publikus követő-oldal tokenje) ───
// A token kérésre generálódik és újrafelhasználódik. Funkció-kapcsoló:
// company_features 'tracking' (hiányzó sor = engedélyezett).
const _trkCrypto = require('crypto');
handlers.getTrackingLink = async function (req, res, args) {
  try {
    if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
      return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
    }
    const cid = req.session.user.company_id;
    const orderId = String(args[0] || '').trim();

    // Előfizetés-kapcsoló (szerveroldali gate is, mint az útvonaltervezésnél)
    const fr = await pool.query(
      "SELECT enabled FROM company_features WHERE company_id = $1 AND feature_key = 'tracking'", [cid]);
    if (fr.rows.length && fr.rows[0].enabled === false) {
      return res.json({ result: { ok: false, err: 'Az ügyfél tracking-link nincs előfizetve ennél a cégnél.' } });
    }

    const or = await pool.query(
      'SELECT id, tracking_token FROM orders WHERE id = $1 AND company_id = $2', [orderId, cid]);
    if (!or.rows.length) return res.json({ result: { ok: false, err: 'Fuvar nem található' } });

    let token = or.rows[0].tracking_token;
    if (!token) {
      token = _trkCrypto.randomBytes(16).toString('hex');
      await pool.query('UPDATE orders SET tracking_token = $1 WHERE id = $2 AND company_id = $3',
        [token, orderId, cid]);
    }
    return res.json({ result: { ok: true, token } });
  } catch (err) {
    console.error('getTrackingLink hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
  }
};

// ─── Diszpécser-tervezőtábla (jármű×nap rács) ────────────────
// getPlannerData: vontatók + a látható időablakba eső fuvarok.
// plannerAssign: drag&drop kiosztás — jármű és/vagy felrakó-dátum állítása.
handlers.getPlannerData = async function (req, res, args) {
  try {
    if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
      return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
    }
    const cid = req.session.user.company_id;
    const a = Array.isArray(args) ? (args[0] || {}) : (args || {});
    const from = a.from || new Date().toISOString().slice(0, 10);
    const to = a.to || from;

    const vehR = await pool.query(
      `SELECT id, rendszam, marca, model FROM vehicles
       WHERE company_id = $1 AND tip = 'Vontato' AND activ = TRUE ORDER BY rendszam`,
      [cid]
    );
    // Az ablakot érintő fuvarok + a dátum nélküli aktívak (kiosztásra várnak)
    const ordR = await pool.query(
      `SELECT id, client, ref, loc_incarcare, loc_descarcare, data_incarcare, data_descarcare,
              status, rendszam_camion, nume_sofer, email_sofer
       FROM orders
       WHERE company_id = $1 AND status <> 'Anulat'
         AND (
           (data_incarcare IS NOT NULL AND data_incarcare <= $3::date
              AND COALESCE(data_descarcare, data_incarcare) >= $2::date)
           OR (data_incarcare IS NULL AND status IN ('Disponibil','Alocat','In Curs','Extern'))
         )
       ORDER BY data_incarcare NULLS LAST, created_at DESC
       LIMIT 400`,
      [cid, from, to]
    );
    return res.json({ result: { ok: true, vehicles: vehR.rows, orders: ordR.rows } });
  } catch (err) {
    console.error('getPlannerData hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
  }
};

// args: [orderId, fields] — csak a megadott mezők változnak:
//   rendszam_camion: string = kiosztás, null = kiosztás törlése, HIÁNYZIK = marad
//   data_incarcare / data_descarcare: sáv-mozgatás, -átméretezés (Gantt)
handlers.plannerAssign = async function (req, res, args) {
  try {
    if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
      return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
    }
    const cid = req.session.user.company_id;
    const orderId = String(args[0] || '').trim();
    const f = args[1] || {};

    const sets = ['updated_at = NOW()'];
    const params = [orderId, cid];
    if (Object.prototype.hasOwnProperty.call(f, 'rendszam_camion')) {
      const rendszam = f.rendszam_camion ? String(f.rendszam_camion).trim().toUpperCase() : null;
      if (rendszam) {
        // a jármű a saját cégé legyen
        const vr = await pool.query(
          `SELECT id FROM vehicles WHERE company_id = $1 AND UPPER(rendszam) = $2 AND tip = 'Vontato'`,
          [cid, rendszam]);
        if (!vr.rows.length) return res.json({ result: { ok: false, err: 'A jármű nem található.' } });
      }
      params.push(rendszam); sets.push('rendszam_camion = $' + params.length);
    }
    if (f.data_incarcare) { params.push(f.data_incarcare); sets.push('data_incarcare = $' + params.length); }
    if (f.data_descarcare) { params.push(f.data_descarcare); sets.push('data_descarcare = $' + params.length); }
    if (sets.length === 1) return res.json({ result: { ok: false, err: 'Nincs módosítandó mező.' } });

    const r = await pool.query(
      `UPDATE orders SET ${sets.join(', ')} WHERE id = $1 AND company_id = $2`,
      params
    );
    if (!r.rowCount) return res.json({ result: { ok: false, err: 'Fuvar nem található' } });
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('plannerAssign hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
  }
};

// ─── 💡 VISSZFUVAR-RADAR (a tervezőtábla adu-ász funkciója) ──
// A cég SAJÁT kiosztatlan fuvarjait párosítja a kamionok VÁRHATÓ
// pozíciójával: minden kiosztatlan fuvar felrakójához megkeresi, melyik
// kamion végez a legközelebb (az utolsó, a felrakó-dátum ELŐTT záruló
// fuvarjának lerakója alapján), és mikor szabadul. Távolság: légvonal
// (haversine) az ingyenes Photon-geokódolásból (geo_cache tábla).
function _haversineKm(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const x = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(x)));
}

// Geokódolás cache-eléssel; kérésenként legfeljebb `budget` ÚJ Photon-hívás
// (fair-use) — ami kimarad, a következő betöltéskor pótlódik.
async function _geocodeCached(label, budget) {
  const norm = String(label || '').trim().toLowerCase().slice(0, 200);
  if (!norm) return null;
  const c = await pool.query('SELECT lat, lng FROM geo_cache WHERE label = $1', [norm]);
  if (c.rows.length) return c.rows[0].lat != null ? { lat: c.rows[0].lat, lng: c.rows[0].lng } : null;
  if (budget.left <= 0) { budget.skipped++; return null; }
  budget.left--;
  let lat = null, lng = null;
  try {
    const r = await fetch('https://photon.komoot.io/api/?q=' + encodeURIComponent(norm) + '&limit=1',
      { headers: { 'User-Agent': 'VallorSoft/1.0 (flottakezelo)' } });
    const d = await r.json().catch(() => ({}));
    const fe = (d.features || [])[0];
    if (fe && fe.geometry && Array.isArray(fe.geometry.coordinates)) {
      lng = fe.geometry.coordinates[0]; lat = fe.geometry.coordinates[1];
    }
  } catch (_) { /* sikertelen geokódolás is cache-elődik (NULL) */ }
  await pool.query(
    'INSERT INTO geo_cache (label, lat, lng) VALUES ($1,$2,$3) ON CONFLICT (label) DO NOTHING',
    [norm, lat, lng]).catch(() => {});
  return lat != null ? { lat, lng } : null;
}

handlers.getPlannerMatches = async function (req, res, args) {
  try {
    if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
      return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
    }
    const cid = req.session.user.company_id;

    // Aktív fuvarok (kiosztott: pozíció-becsléshez és foglaltsághoz;
    // kiosztatlan: ezekhez keresünk kamiont)
    const or = await pool.query(
      `SELECT id, client, loc_incarcare, loc_descarcare, data_incarcare, data_descarcare,
              status, rendszam_camion
       FROM orders
       WHERE company_id = $1 AND status NOT IN ('Anulat','Finalizat')
       ORDER BY data_incarcare NULLS LAST LIMIT 300`, [cid]);
    const orders = or.rows;
    const unassigned = orders.filter((o) => !o.rendszam_camion && o.loc_incarcare);
    if (!unassigned.length) return res.json({ result: { ok: true, matches: [], pending: 0 } });

    // Kamiononként az ütemterv (kiosztott fuvarok idő szerint)
    const byVeh = new Map();
    orders.filter((o) => o.rendszam_camion).forEach((o) => {
      const k = o.rendszam_camion.toUpperCase();
      if (!byVeh.has(k)) byVeh.set(k, []);
      byVeh.get(k).push(o);
    });
    byVeh.forEach((list) => list.sort((a, b) =>
      String(a.data_incarcare || '9999') < String(b.data_incarcare || '9999') ? -1 : 1));

    const budget = { left: 12, skipped: 0 };   // max. 12 új geokódolás / kérés
    const day = (d) => (d ? String(d).slice(0, 10) : null);
    const overlaps = (o, from, to) => {
      const s = day(o.data_incarcare), e = day(o.data_descarcare) || s;
      if (!s || !from) return false;
      return s <= (to || from) && (e || s) >= from;
    };

    const matches = [];
    for (const u of unassigned.slice(0, 20)) {            // a 20 legkorábbi kiosztatlan
      const uGeo = await _geocodeCached(u.loc_incarcare, budget);
      if (!uGeo) continue;
      const uFrom = day(u.data_incarcare);
      const uTo = day(u.data_descarcare) || uFrom;
      const sugg = [];
      for (const [rendszam, list] of byVeh) {
        // foglaltság: ha a kamionnak átfedő fuvarja van, nem javasoljuk
        if (uFrom && list.some((o) => overlaps(o, uFrom, uTo))) continue;
        // az utolsó, a felrakás ELŐTT (vagy dátum nélkül: bármikor) záruló fuvar lerakója
        const before = uFrom ? list.filter((o) => (day(o.data_descarcare) || day(o.data_incarcare) || '') <= uFrom) : list;
        const last = before[before.length - 1];
        if (!last || !last.loc_descarcare) continue;
        const vGeo = await _geocodeCached(last.loc_descarcare, budget);
        if (!vGeo) continue;
        sugg.push({
          rendszam,
          km: _haversineKm(uGeo, vGeo),
          honnan: last.loc_descarcare,
          szabad_tol: day(last.data_descarcare) || day(last.data_incarcare),
          utolso_fuvar: last.id,
        });
      }
      sugg.sort((a, b) => a.km - b.km);
      if (sugg.length) matches.push({ order_id: u.id, loc_incarcare: u.loc_incarcare,
        data_incarcare: day(u.data_incarcare), client: u.client, suggestions: sugg.slice(0, 3) });
    }
    // legjobb találatok elöl (legkisebb üresjárat)
    matches.sort((a, b) => a.suggestions[0].km - b.suggestions[0].km);
    return res.json({ result: { ok: true, matches, pending: budget.skipped } });
  } catch (err) {
    console.error('getPlannerMatches hiba:', err);
    return res.json({ result: { ok: true, matches: [], pending: 0 } }); // radar-hiba ne törje a táblát
  }
};

module.exports = handlers;
