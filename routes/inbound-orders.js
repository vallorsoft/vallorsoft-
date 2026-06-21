// routes/inbound-orders.js — Beérkező megrendelések (e-mail intake) kezelése.
// Mount: app.use(require('./routes/inbound-orders'));
const express = require('express');
const pool = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');
const pdfx = require('../services/pdf-extract');
const orderAi = require('../services/order-ai');
const intake = require('../services/email-intake');
const { decrypt } = require('../lib/crypto');
const { genDocId } = require('../lib/ids');
const { nextFuvarNo, resolveOrderSeries } = require('../lib/orderNo');
const { estimateRoute } = require('../lib/routeEstimate');
const { featureEnabled } = require('../lib/featureEnabled');

const router = express.Router();

// A cég mentett (titkosított) e-mail intake beállítása -> { creds, since } (vagy null).
async function loadIntakeCreds(companyId) {
  const { rows } = await pool.query(
    `SELECT credentials_enc, meta FROM company_integrations WHERE company_id=$1 AND provider='email_intake' AND enabled=true`, [companyId]);
  if (!rows.length || !rows[0].credentials_enc) return null;
  try {
    const creds = JSON.parse(decrypt(rows[0].credentials_enc));
    const since = rows[0].meta && rows[0].meta.since ? rows[0].meta.since : null;
    return { creds, since };
  } catch (_) { return null; }
}
const own = (req) => req.session.user.company_id;
const LIST_COLS = `id, source_email, subject, received_at, raw_text, pdf_name, extracted,
                   confidence, ai_used, status, created_order_id, created_at`;

// ---- AI ki/be beállítás (cégenként, a company_integrations meta-ban) ----
router.get('/api/inbound-orders/settings', requireLogin, requireRole('Admin', 'Manager'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT meta FROM company_integrations WHERE company_id=$1 AND provider='order_intake'`, [own(req)]);
    const cfg = await pool.query(
      `SELECT 1 FROM company_integrations WHERE company_id=$1 AND provider='email_intake' AND enabled=true AND credentials_enc IS NOT NULL`, [own(req)]);
    res.json({ ai_enabled: !!(rows[0] && rows[0].meta && rows[0].meta.ai_enabled), intake_configured: cfg.rows.length > 0 });
  } catch (e) { console.error('GET /api/inbound-orders/settings hiba:', e); res.status(500).json({ error: 'Eroare de server' }); }
});
router.post('/api/inbound-orders/settings', requireLogin, requireRole('Admin'), async (req, res) => {
  const ai = req.body.ai_enabled === true || req.body.ai_enabled === 'true';
  try {
    await pool.query(
      `INSERT INTO company_integrations (company_id, provider, category, enabled, meta, updated_at)
       VALUES ($1,'order_intake','intake',true,$2,now())
       ON CONFLICT (company_id, provider) DO UPDATE SET meta=$2, updated_at=now()`,
      [own(req), JSON.stringify({ ai_enabled: ai })]);
    res.json({ ok: true, ai_enabled: ai });
  } catch (e) { console.error('POST /api/inbound-orders/settings hiba:', e); res.status(500).json({ error: 'Eroare de server' }); }
});

// ---- Kézi lekérdezés (teszthez, fiók beállítása után) ----
router.post('/api/inbound-orders/poll', requireLogin, requireRole('Admin', 'Manager'), async (req, res) => {
  try {
    const cfg = await loadIntakeCreds(own(req));
    if (!cfg) return res.json({ skipped: true });
    const r = await intake.pollOnce(pool, cfg.creds, own(req), { since: cfg.since });
    // Kézi lekérdezés is frissítse az utolsó lekérdezés idejét.
    if (!r.skipped) {
      await pool.query(`UPDATE company_integrations SET last_check=now() WHERE company_id=$1 AND provider='email_intake'`, [own(req)]).catch(() => {});
    }
    res.json(r);
  } catch (e) { console.error('POST /api/inbound-orders/poll hiba:', e); res.status(500).json({ error: 'Eroare de server' }); }
});

// ---- Lista ----
// Szűrhető: ?status=, ?source= (csak ez a forrás), ?exclude_source= (ezt a forrást kihagyja).
// A portál-kérések a külön „Ügyfél kérések" fülre mennek (source=portal); az e-mail
// intake „Megrendelések" füle a portált kihagyja (exclude_source=portal).
router.get('/api/inbound-orders', requireLogin, requireRole('Admin', 'Manager'), async (req, res) => {
  const { status, source, exclude_source } = req.query;
  try {
    const params = [own(req)];
    let sql = `SELECT ${LIST_COLS}, source FROM inbound_orders WHERE company_id=$1`;
    if (status) { params.push(status); sql += ` AND status=$${params.length}`; }
    if (source) { params.push(source); sql += ` AND source=$${params.length}`; }
    if (exclude_source) { params.push(exclude_source); sql += ` AND (source IS NULL OR source<>$${params.length})`; }
    sql += ` ORDER BY received_at DESC NULLS LAST, created_at DESC LIMIT 300`;
    const { rows } = await pool.query(sql, params);
    res.json({ items: rows });
  } catch (e) { console.error('GET /api/inbound-orders hiba:', e); res.status(500).json({ error: 'Eroare de server' }); }
});

// ---- Feldolgozatlan beérkezők száma (lebegő értesítő-sávhoz, sidebar-badge) ----
// Feldolgozatlan = minden, ami még nincs jóváhagyva/elvetve (portál-kérés + e-mail intake).
router.get('/api/inbound-orders/count', requireLogin, requireRole('Admin', 'Manager'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS count,
              COUNT(*) FILTER (WHERE source='portal')::int AS portal,
              MAX(received_at) AS latest
       FROM inbound_orders
       WHERE company_id=$1 AND status NOT IN ('approved','rejected')`, [own(req)]);
    res.json({ count: rows[0].count || 0, portal: rows[0].portal || 0, latest: rows[0].latest });
  } catch (e) { console.error('GET /api/inbound-orders/count hiba:', e); res.status(500).json({ error: 'Eroare de server' }); }
});

// ---- Eredeti PDF megnyitása ----
router.get('/api/inbound-orders/:id/pdf', requireLogin, requireRole('Admin', 'Manager'), async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT pdf_name, pdf_data FROM inbound_orders WHERE id=$1 AND company_id=$2`, [req.params.id, own(req)]);
    if (!rows.length || !rows[0].pdf_data) return res.status(404).send('Nu exista PDF.');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${(rows[0].pdf_name || 'comanda.pdf').replace(/"/g, '')}"`);
    res.send(rows[0].pdf_data);
  } catch (e) { console.error('GET /api/inbound-orders/:id/pdf hiba:', e); res.status(500).send('Eroare de server'); }
});

// ---- Kiolvasott mezők mentése (diszpécser javítja) ----
router.put('/api/inbound-orders/:id', requireLogin, requireRole('Admin', 'Manager'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE inbound_orders SET extracted=$1, status='reviewed', updated_at=now()
         WHERE id=$2 AND company_id=$3 AND status NOT IN ('approved') RETURNING ${LIST_COLS}`,
      [JSON.stringify(req.body.extracted || {}), req.params.id, own(req)]);
    if (!rows.length) return res.status(404).json({ error: 'Nu a fost gasit sau este deja aprobat.' });
    res.json({ item: rows[0] });
  } catch (e) { console.error('PUT /api/inbound-orders/:id hiba:', e); res.status(500).json({ error: 'Eroare de server' }); }
});

// ---- Újrafeldolgozás (a tárolt PDF/szövegből) ----
router.post('/api/inbound-orders/:id/reparse', requireLogin, requireRole('Admin', 'Manager'), async (req, res) => {
  try {
    if (!(await featureEnabled(own(req), 'ai-kiolvasas')))
      return res.status(403).json({ error: 'Functie nedisponibila in pachetul curent.' });
    const r0 = await pool.query(`SELECT raw_text, pdf_data, pdf_name FROM inbound_orders WHERE id=$1 AND company_id=$2`, [req.params.id, own(req)]);
    if (!r0.rows.length) return res.status(404).json({ error: 'Nu a fost gasit.' });
    const set = await pool.query(`SELECT meta FROM company_integrations WHERE company_id=$1 AND provider='order_intake'`, [own(req)]);
    const aiEnabled = !!(set.rows[0] && set.rows[0].meta && set.rows[0].meta.ai_enabled);
    const row = r0.rows[0];
    let text = row.raw_text || '';
    if (row.pdf_data) { const ex = await pdfx.extractText(row.pdf_data); if (ex.text) text = ex.text; }
    const r = await orderAi.extractFields({ text, pdfBuffer: row.pdf_data, pdfName: row.pdf_name, aiEnabled });
    const { rows } = await pool.query(
      `UPDATE inbound_orders SET extracted=$1, confidence=$2, ai_used=$3, status='parsed', updated_at=now()
         WHERE id=$4 AND company_id=$5 RETURNING ${LIST_COLS}`,
      [JSON.stringify(r.fields), r.confidence, r.ai_used, req.params.id, own(req)]);
    res.json({ item: rows[0] });
  } catch (e) { console.error('POST /api/inbound-orders/:id/reparse hiba:', e); res.status(500).json({ error: 'Eroare de server' }); }
});

// ---- Elvetés ----
router.post('/api/inbound-orders/:id/reject', requireLogin, requireRole('Admin', 'Manager'), async (req, res) => {
  try {
    await pool.query(`UPDATE inbound_orders SET status='rejected', updated_at=now() WHERE id=$1 AND company_id=$2`, [req.params.id, own(req)]);
    res.json({ ok: true });
  } catch (e) { console.error('POST /api/inbound-orders/:id/reject hiba:', e); res.status(500).json({ error: 'Eroare de server' }); }
});

// ---- Jóváhagyás -> valódi orders rekord (Disponibil / Alocat) ----
router.post('/api/inbound-orders/:id/approve', requireLogin, requireRole('Admin', 'Manager'), async (req, res) => {
  try {
    const r0 = await pool.query(`SELECT * FROM inbound_orders WHERE id=$1 AND company_id=$2`, [req.params.id, own(req)]);
    if (!r0.rows.length) return res.status(404).json({ error: 'Nu a fost gasit.' });
    if (r0.rows[0].status === 'approved') return res.status(409).json({ error: 'Deja aprobat.' });

    const ex = r0.rows[0].extracted || {};
    const a = req.body.assign || {};   // opcionális sofőr/jármű kiosztás
    const company_id = own(req);
    const id = genDocId('CMD');

    const sofer_type = a.sofer_type || null;
    const email_sofer = a.email_sofer ? String(a.email_sofer).trim().toLowerCase() : null;
    const nume_sofer = a.nume_sofer ? String(a.nume_sofer).trim() : null;
    const firma_extern = a.firma_extern ? String(a.firma_extern).trim() : null;
    const telefon_extern = a.telefon_extern ? String(a.telefon_extern).trim() : null;
    const external_driver_id = a.external_driver_id ? parseInt(a.external_driver_id, 10) : null;
    const rendszam_camion = (a.rendszam_camion || ex.rendszam_camion) ? String(a.rendszam_camion || ex.rendszam_camion).trim().toUpperCase() : null;
    const rendszam_remorca = (a.rendszam_remorca || ex.rendszam_remorca) ? String(a.rendszam_remorca || ex.rendszam_remorca).trim().toUpperCase() : null;

    let status = 'Disponibil';
    if (sofer_type === 'Intern' && email_sofer) status = 'Alocat';
    else if (sofer_type === 'Extern') status = 'Extern';

    const client = String(ex.client || '').trim();
    const ref = String(ex.ref || '').trim();
    const pret = Number(ex.pret || 0) || 0;
    const km = Number(ex.km || 0) || 0;
    const loc_incarcare = String(ex.loc_incarcare || '').trim();
    const loc_descarcare = String(ex.loc_descarcare || '').trim();
    const data_incarcare = ex.data_incarcare || null;
    const data_descarcare = ex.data_descarcare || null;
    // Áru-adatok (a portál-kérés / kiolvasás teljes áru-bevitele → kész fuvar)
    const suly_kg = (ex.suly_kg != null && ex.suly_kg !== '') ? (Number(ex.suly_kg) || null)
                  : (ex.greutate != null && ex.greutate !== '' ? (Number(ex.greutate) || null) : null);
    const load_type = ['FTL', 'LTL'].includes(ex.load_type) ? ex.load_type : null;
    const hossz_cm = (ex.hossz_cm != null && ex.hossz_cm !== '') ? (parseInt(ex.hossz_cm, 10) || null) : null;
    const szel_cm = (ex.szel_cm != null && ex.szel_cm !== '') ? (parseInt(ex.szel_cm, 10) || null) : null;
    const mag_cm = (ex.mag_cm != null && ex.mag_cm !== '') ? (parseInt(ex.mag_cm, 10) || null) : null;

    // Megrendelő (ügyfél) automatikus kitöltése + linkelése: a portál-kérés
    // forrás-e-mailjéből (client_users → clients) — így a diszpécsernek nem kell
    // külön beírnia, és a fuvar a meglévő ügyfél-rekordhoz kötődik (orders.client_id).
    let clientName = client;
    let clientId = null;
    try {
      const srcEmail = r0.rows[0].source_email;
      if (srcEmail) {
        const cl = await pool.query(
          `SELECT c.id, c.denumire FROM client_users cu
             JOIN clients c ON c.id = cu.client_id AND c.company_id = cu.company_id
            WHERE cu.company_id = $1 AND LOWER(cu.email) = LOWER($2) LIMIT 1`,
          [company_id, srcEmail]);
        if (cl.rows.length) {
          clientId = cl.rows[0].id;
          if (!clientName) clientName = (cl.rows[0].denumire || '').trim();
        }
      }
    } catch (_) { /* a megrendelő-feloldás hibája ne buktassa a jóváhagyást */ }

    // Tranzakció: fuvar + láb + jóváhagyott státusz EGYÜTT — félbeszakadásnál
    // ne maradjon létrejött fuvar 'feldolgozatlan' inbounddal (újrapróbálásnál
    // az duplikált fuvart eredményezne).
    // Ember-olvasható fuvar-szám (PREFIX-YYYY-XXXX) — a választott (vagy
    // alapértelmezett) fuvar-széria szerint. Best-effort; ha elszáll, a
    // jóváhagyás akkor is fusson (fuvar_no=NULL).
    let fuvar_no = null;
    try {
      const series = await resolveOrderSeries(pool, company_id, a.series_id);
      fuvar_no = await nextFuvarNo(pool, company_id, null, series);
    } catch (e) { console.error('fuvar_no generálás hiba (approve, a mentés folytatódik):', e.message); }

    const dbc = await pool.connect();
    try {
      await dbc.query('BEGIN');
      await dbc.query(
        `INSERT INTO orders (id, client, ref, loc_incarcare, loc_descarcare, data_incarcare, data_descarcare,
           pret, km, sofer_type, email_sofer, nume_sofer, firma_extern, telefon_extern, external_driver_id,
           rendszam_camion, rendszam_remorca, status, company_id,
           suly_kg, load_type, hossz_cm, szel_cm, mag_cm, client_id, fuvar_no)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)`,
        [id, clientName, ref, loc_incarcare, loc_descarcare, data_incarcare, data_descarcare,
         pret, km, sofer_type, email_sofer, nume_sofer, firma_extern, telefon_extern, external_driver_id,
         rendszam_camion, rendszam_remorca, status, company_id,
         suly_kg, load_type, hossz_cm, szel_cm, mag_cm, clientId, fuvar_no]);
      await dbc.query(
        `INSERT INTO order_legs (order_id, leg_number, sofer_type, email_sofer, nume_sofer, firma_extern,
           telefon_extern, external_driver_id, rendszam_camion, rendszam_remorca, loc_preluare, data_preluare, company_id)
         VALUES ($1,1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [id, sofer_type, email_sofer, nume_sofer, firma_extern, telefon_extern, external_driver_id,
         rendszam_camion, rendszam_remorca, loc_incarcare, data_incarcare, company_id]);
      await dbc.query(`UPDATE inbound_orders SET status='approved', created_order_id=$1, updated_at=now() WHERE id=$2 AND company_id=$3`,
        [id, req.params.id, company_id]);
      await dbc.query('COMMIT');
    } catch (txErr) {
      await dbc.query('ROLLBACK').catch(() => {});
      throw txErr;
    } finally {
      dbc.release();
    }

    // Automata útvonal-km a fuvarlistára — ha az 'order-route-map' kapcsoló be van
    // (alapból BE; csak explicit enabled=false kapcsolja ki). A beolvasott km-et NEM
    // írja felül; az automata km a route_geo-ban tárolódik, a fuvarlista a beolvasott
    // mellett mutatja. Tranzakción KÍVÜL, best-effort: lassú/hibás geokódolás ne buktassa a jóváhagyást.
    try {
      if (loc_incarcare && loc_descarcare) {
        const fr = await pool.query(
          "SELECT enabled FROM company_features WHERE company_id=$1 AND feature_key='order-route-map'", [company_id]);
        if (!(fr.rows.length && fr.rows[0].enabled === false)) {
          const est = await estimateRoute([
            { type: 'loading', address: loc_incarcare },
            { type: 'unloading', address: loc_descarcare },
          ], company_id);
          if (est && est.km != null) {
            const rg = {
              waypoints: est.waypoints.map((w) => ({ type: w.type, address: w.label, lat: w.lat, lng: w.lng })),
              km: est.km, durationSeconds: est.durationSeconds,
            };
            await pool.query('UPDATE orders SET route_geo=$1 WHERE id=$2 AND company_id=$3',
              [JSON.stringify(rg), id, company_id]);
          }
        }
      }
    } catch (e) { /* az automata km hibája ne buktassa a jóváhagyást */ }

    // A beérkező megrendelő-PDF a fuvar dokumentumai közé (aláírható a meglévő flow-val)
    try {
      const ib = r0.rows[0];
      if (ib.pdf_data) {
        await pool.query(
          `INSERT INTO order_documents (order_id, file_name, original_base64, uploaded_by, company_id)
           VALUES ($1,$2,$3,$4,$5)`,
          [id, ib.pdf_name || ('megrendelo-' + id + '.pdf'), ib.pdf_data.toString('base64'),
           req.session.user.nume || req.session.user.email, company_id]);
      }
    } catch (e) { /* a dokumentum-csatolás hibája ne buktassa a jóváhagyást */ }

    res.json({ ok: true, order_id: id, status });
  } catch (e) { console.error('POST /api/inbound-orders/:id/approve hiba:', e); res.status(500).json({ error: 'Eroare de server' }); }
});

module.exports = router;
