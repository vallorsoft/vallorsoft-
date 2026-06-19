// ============================================================
//  VallorSoft — routes/carrier-portal.js  (ALVÁLLALKOZÓI PORTÁL)
//  A külsős fuvarozó saját belépéssel látja a rá osztott fuvarokat,
//  a hozzá tartozó dokumentumokat (le-/feltöltés), és felviszi a SAJÁT
//  járművét. Külön session-szerep (req.session.carrierUser); minden
//  lekérdezés company_id ÉS carrier_id szerint szűr.
// ============================================================
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const router = express.Router();
const pool = require('../db');
const { validatePassword } = require('../lib/passwordPolicy');
const { encrypt } = require('../lib/crypto');
const { featureEnabled } = require('../lib/featureEnabled');

// Megosztott követő-link validálása (http/https). Üres → null (törlés).
function _trackUrl(v) {
  const s = String(v || '').trim().slice(0, 1000);
  if (!s) return null;
  return /^https?:\/\//i.test(s) ? s : null;   // érvénytelen séma → nem tároljuk
}

function requireCarrier(req, res, next) {
  if (!req.session || !req.session.carrierUser) return res.status(401).json({ ok: false, err: 'Nu sunteti autentificat.' });
  next();
}
async function featureOn(companyId) {
  try {
    const r = await pool.query("SELECT enabled FROM company_features WHERE company_id=$1 AND feature_key='carrier-portal'", [companyId]);
    return r.rows.length ? r.rows[0].enabled === true : false;
  } catch (_) { return false; }
}

router.get('/carrier', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'carrier.html')));

router.post('/api/carrier/login', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!email || !password) return res.json({ ok: false, err: 'E-mailul si parola sunt obligatorii.' });
    const r = await pool.query(
      `SELECT cu.id, cu.company_id, cu.carrier_id, cu.email, cu.nev, cu.pass_hash, cu.activ,
              c.nev AS carrier_nev, co.nev AS ceg_nev
       FROM carrier_users cu JOIN carriers c ON c.id=cu.carrier_id AND c.company_id=cu.company_id
       JOIN companies co ON co.id=cu.company_id WHERE LOWER(cu.email)=$1`, [email]);
    if (!r.rows.length || !r.rows[0].pass_hash) {
      await bcrypt.compare(password, '$2b$10$C6UzMDM.H6dfI/f/IKcEeO7ZdVdkPYqBkN1FW3sZBPq4P5l5l5l5l');
      return res.json({ ok: false, err: 'E-mail sau parola incorecta.' });
    }
    const cu = r.rows[0];
    if (!(await bcrypt.compare(password, cu.pass_hash))) return res.json({ ok: false, err: 'E-mail sau parola incorecta.' });
    if (!cu.activ) return res.json({ ok: false, err: 'Accesul dumneavoastra este blocat.' });
    if (!(await featureOn(cu.company_id))) return res.json({ ok: false, err: 'Portalul de subcontractor nu este momentan activ.' });
    req.session.carrierUser = { id: cu.id, company_id: cu.company_id, carrier_id: cu.carrier_id, email: cu.email, nev: cu.nev, carrier_nev: cu.carrier_nev, ceg_nev: cu.ceg_nev };
    await pool.query('UPDATE carrier_users SET last_login=NOW() WHERE id=$1', [cu.id]).catch(() => {});
    return res.json({ ok: true });
  } catch (err) { console.error('carrier login hiba:', err); return res.json({ ok: false, err: 'Eroare de server' }); }
});

router.post('/api/carrier/logout', (req, res) => { if (req.session) req.session.carrierUser = null; res.json({ ok: true }); });
router.get('/api/carrier/me', async (req, res) => {
  const cu = req.session && req.session.carrierUser;
  if (!cu) return res.json({ ok: false });
  let gpsEnabled = true;
  try { gpsEnabled = await featureEnabled(cu.company_id, 'carrier-gps'); } catch (_) {}
  res.json({ ok: true, nev: cu.nev, email: cu.email, carrier_nev: cu.carrier_nev, ceg_nev: cu.ceg_nev, gps_enabled: gpsEnabled });
});

router.post('/api/carrier/set-password', async (req, res) => {
  try {
    const token = String(req.body.token || '').trim();
    const password = String(req.body.password || '');
    if (!token) return res.json({ ok: false, err: 'Date lipsă.' });
    const pwCheck = validatePassword(password);
    if (!pwCheck.ok) return res.json({ ok: false, err: pwCheck.err });
    const r = await pool.query(
      `SELECT id, company_id, carrier_id, email, nev FROM carrier_users
       WHERE invite_token=$1 AND (invite_expires IS NULL OR invite_expires > NOW())`, [token]);
    if (!r.rows.length) return res.json({ ok: false, err: 'Linkul de invitatie este invalid sau a expirat.' });
    const cu = r.rows[0];
    if (!(await featureOn(cu.company_id))) return res.json({ ok: false, err: 'Portalul de subcontractor nu este momentan activ.' });
    const hash = await bcrypt.hash(password, 10);
    await pool.query('UPDATE carrier_users SET pass_hash=$1, invite_token=NULL, invite_expires=NULL, activ=TRUE WHERE id=$2', [hash, cu.id]);
    const cR = await pool.query(`SELECT c.nev AS carrier_nev, co.nev AS ceg_nev FROM carriers c JOIN companies co ON co.id=c.company_id WHERE c.id=$1 AND c.company_id=$2`, [cu.carrier_id, cu.company_id]);
    req.session.carrierUser = { id: cu.id, company_id: cu.company_id, carrier_id: cu.carrier_id, email: cu.email, nev: cu.nev, carrier_nev: (cR.rows[0] || {}).carrier_nev, ceg_nev: (cR.rows[0] || {}).ceg_nev };
    return res.json({ ok: true });
  } catch (err) { console.error('carrier set-password hiba:', err); return res.json({ ok: false, err: 'Eroare de server' }); }
});

// A rá osztott fuvarok (Extern, carrier_id szerint) — a díjjal, amit ő kap
router.get('/api/carrier/orders', requireCarrier, async (req, res) => {
  try {
    const cu = req.session.carrierUser;
    const r = await pool.query(
      `SELECT o.id, o.ref, o.loc_incarcare, o.loc_descarcare, o.data_incarcare, o.data_descarcare,
              o.status, o.rendszam_camion, o.rendszam_remorca, o.load_type, o.suly_kg,
              o.carrier_cost, o.created_at
       FROM orders o WHERE o.company_id=$1 AND o.carrier_id=$2 AND o.status<>'Anulat'
       ORDER BY (o.status IN ('Alocat','In Curs')) DESC, o.created_at DESC LIMIT 200`,
      [cu.company_id, cu.carrier_id]);
    const orders = r.rows;
    const ids = orders.map((o) => o.id);
    const docsByOrder = {};
    if (ids.length) {
      // a diszpécser által a fuvarhoz csatolt dokumentumok (megrendelés-visszaigazolás stb.)
      const od = await pool.query(`SELECT id, order_id, file_name FROM order_documents WHERE order_id = ANY($1::text[]) AND company_id=$2 ORDER BY id`, [ids, cu.company_id]);
      od.rows.forEach((d) => { (docsByOrder[d.order_id] = docsByOrder[d.order_id] || []).push({ id: d.id, name: d.file_name || 'document.pdf', src: 'order' }); });
      // az alvállalkozó által feltöltött dokumentumok
      const cd = await pool.query(`SELECT id, order_id, file_name FROM carrier_documents WHERE carrier_id=$1 AND company_id=$2 AND order_id = ANY($3::text[]) ORDER BY id`, [cu.carrier_id, cu.company_id, ids]);
      cd.rows.forEach((d) => { (docsByOrder[d.order_id] = docsByOrder[d.order_id] || []).push({ id: d.id, name: d.file_name || 'incarcare', src: 'carrier' }); });
    }
    orders.forEach((o) => { o.documents = docsByOrder[o.id] || []; });
    const stats = {
      active: orders.filter((o) => ['Alocat', 'In Curs'].includes(o.status)).length,
      onroad: orders.filter((o) => o.status === 'In Curs').length,
      payable: orders.reduce((s, o) => s + (Number(o.carrier_cost) || 0), 0),
    };
    return res.json({ ok: true, orders, stats });
  } catch (err) { console.error('carrier orders hiba:', err); return res.json({ ok: false, err: 'Eroare de server' }); }
});

// Saját jármű(vek) — lista + felvitel + törlés
router.get('/api/carrier/vehicles', requireCarrier, async (req, res) => {
  try {
    const cu = req.session.carrierUser;
    const r = await pool.query(
      'SELECT id, rendszam_camion, rendszam_remorca, marca, model, sofer_nev, sofer_tel, an_fabricatie, nota, trailer_kind, cargo_length_cm, cargo_width_cm, cargo_height_cm, track_url, gps_object_id, (gps_api_key_enc IS NOT NULL) AS has_gps_key FROM carrier_vehicles WHERE company_id=$1 AND carrier_id=$2 ORDER BY created_at DESC',
      [cu.company_id, cu.carrier_id]);
    return res.json({ ok: true, items: r.rows });
  } catch (err) { console.error('carrier vehicles hiba:', err); return res.json({ ok: false, err: 'Eroare de server' }); }
});
router.post('/api/carrier/vehicles', requireCarrier, async (req, res) => {
  try {
    const cu = req.session.carrierUser;
    const b = req.body || {};
    const cam = String(b.rendszam_camion || '').trim().toUpperCase().slice(0, 50);
    if (!cam) return res.json({ ok: false, err: 'Numarul de inmatriculare al capului tractor este obligatoriu.' });
    // GPS-mezők CSAK ha a 'carrier-gps' funkció engedélyezett a cégnél (különben null).
    const gpsOn = await featureEnabled(cu.company_id, 'carrier-gps');
    const objId = gpsOn ? (String(b.gps_object_id || '').trim().slice(0, 100) || null) : null;
    const keyRaw = gpsOn ? String(b.gps_api_key || '').trim() : '';
    const keyEnc = (objId && keyRaw) ? encrypt(keyRaw) : null;
    const trackUrl = gpsOn ? _trackUrl(b.track_url) : null;
    await pool.query(
      `INSERT INTO carrier_vehicles (company_id, carrier_id, rendszam_camion, rendszam_remorca, marca, model, sofer_nev, nota, sofer_tel, an_fabricatie, trailer_kind, cargo_length_cm, cargo_width_cm, cargo_height_cm, track_url, gps_object_id, gps_api_key_enc)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [cu.company_id, cu.carrier_id, cam,
       String(b.rendszam_remorca || '').trim().toUpperCase().slice(0, 50) || null,
       String(b.marca || '').trim().slice(0, 80) || null,
       String(b.model || '').trim().slice(0, 80) || null,
       String(b.sofer_nev || '').trim().slice(0, 120) || null,
       String(b.nota || '').trim().slice(0, 500) || null,
       String(b.sofer_tel || '').trim().slice(0, 30) || null,
       b.an_fabricatie ? (parseInt(b.an_fabricatie, 10) || null) : null,
       ['standard','mega'].includes(b.trailer_kind) ? b.trailer_kind : null,
       b.cargo_length_cm ? (parseInt(b.cargo_length_cm, 10) || null) : null,
       b.cargo_width_cm  ? (parseInt(b.cargo_width_cm, 10)  || null) : null,
       b.cargo_height_cm ? (parseInt(b.cargo_height_cm, 10) || null) : null,
       trackUrl, objId, keyEnc]);
    return res.json({ ok: true });
  } catch (err) { console.error('carrier vehicle add hiba:', err); return res.json({ ok: false, err: 'Eroare de server' }); }
});
router.put('/api/carrier/vehicles/:id', requireCarrier, async (req, res) => {
  try {
    const cu = req.session.carrierUser;
    const id = parseInt(req.params.id, 10);
    const b = req.body || {};
    const cam = String(b.rendszam_camion || '').trim().toUpperCase().slice(0, 50);
    if (!cam) return res.json({ ok: false, err: 'Numarul de inmatriculare al capului tractor este obligatoriu.' });
    // A GPS-oszlopok NEM részei az alap-frissítésnek — csak ha a 'carrier-gps'
    // funkció engedélyezett (különben a tárolt GPS-adat érintetlen marad).
    const r = await pool.query(
      `UPDATE carrier_vehicles SET rendszam_camion=$1, rendszam_remorca=$2, marca=$3, model=$4, sofer_nev=$5, sofer_tel=$6, an_fabricatie=$7, nota=$8, trailer_kind=$9, cargo_length_cm=$10, cargo_width_cm=$11, cargo_height_cm=$12
       WHERE id=$13 AND company_id=$14 AND carrier_id=$15`,
      [cam,
       String(b.rendszam_remorca || '').trim().toUpperCase().slice(0, 50) || null,
       String(b.marca || '').trim().slice(0, 80) || null,
       String(b.model || '').trim().slice(0, 80) || null,
       String(b.sofer_nev || '').trim().slice(0, 120) || null,
       String(b.sofer_tel || '').trim().slice(0, 30) || null,
       b.an_fabricatie ? (parseInt(b.an_fabricatie, 10) || null) : null,
       String(b.nota || '').trim().slice(0, 500) || null,
       ['standard','mega'].includes(b.trailer_kind) ? b.trailer_kind : null,
       b.cargo_length_cm ? (parseInt(b.cargo_length_cm, 10) || null) : null,
       b.cargo_width_cm  ? (parseInt(b.cargo_width_cm, 10)  || null) : null,
       b.cargo_height_cm ? (parseInt(b.cargo_height_cm, 10) || null) : null,
       id, cu.company_id, cu.carrier_id]);
    if (await featureEnabled(cu.company_id, 'carrier-gps')) {
      const objId = String(b.gps_object_id || '').trim().slice(0, 100) || null;
      await pool.query('UPDATE carrier_vehicles SET track_url=$1, gps_object_id=$2 WHERE id=$3 AND company_id=$4 AND carrier_id=$5',
        [_trackUrl(b.track_url), objId, id, cu.company_id, cu.carrier_id]);
      // GPS-kulcs: új kulcs → titkosítva; object_id törölve → kulcs is; üres kulcs object_id mellett → marad.
      const keyRaw = String(b.gps_api_key || '').trim();
      if (objId && keyRaw) {
        await pool.query('UPDATE carrier_vehicles SET gps_api_key_enc=$1 WHERE id=$2 AND company_id=$3 AND carrier_id=$4',
          [encrypt(keyRaw), id, cu.company_id, cu.carrier_id]);
      } else if (!objId) {
        await pool.query('UPDATE carrier_vehicles SET gps_api_key_enc=NULL WHERE id=$1 AND company_id=$2 AND carrier_id=$3',
          [id, cu.company_id, cu.carrier_id]);
      }
    }
    return res.json({ ok: !!r.rowCount });
  } catch (err) { console.error('carrier vehicle edit hiba:', err); return res.json({ ok: false, err: 'Eroare de server' }); }
});
router.delete('/api/carrier/vehicles/:id', requireCarrier, async (req, res) => {
  try {
    const cu = req.session.carrierUser;
    const r = await pool.query('DELETE FROM carrier_vehicles WHERE id=$1 AND company_id=$2 AND carrier_id=$3', [parseInt(req.params.id, 10), cu.company_id, cu.carrier_id]);
    return res.json({ ok: !!r.rowCount });
  } catch (err) { console.error('carrier vehicle del hiba:', err); return res.json({ ok: false, err: 'Eroare de server' }); }
});

// Dokumentum feltöltése (base64 JSON) — opcionálisan fuvarhoz kötve
router.post('/api/carrier/upload', requireCarrier, async (req, res) => {
  try {
    const cu = req.session.carrierUser;
    const b = req.body || {};
    const data = String(b.data_base64 || '');
    const fileName = String(b.file_name || 'incarcare').slice(0, 200);
    if (!data || data.length < 8) return res.json({ ok: false, err: 'Fisier lipsa.' });
    if (data.length > 14 * 1024 * 1024) return res.json({ ok: false, err: 'Fisierul este prea mare (max ~10 MB).' });
    let orderId = b.order_id ? String(b.order_id).slice(0, 20) : null;
    if (orderId) {
      const chk = await pool.query('SELECT 1 FROM orders WHERE id=$1 AND company_id=$2 AND carrier_id=$3', [orderId, cu.company_id, cu.carrier_id]);
      if (!chk.rows.length) orderId = null; // csak a saját fuvarához köthet
    }
    const kind = ['insurance', 'contract', 'cmr', 'invoice', 'other'].includes(b.kind) ? b.kind : 'other';
    await pool.query(
      `INSERT INTO carrier_documents (company_id, carrier_id, order_id, file_name, mime, data_base64, kind, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [cu.company_id, cu.carrier_id, orderId, fileName, String(b.mime || 'application/octet-stream').slice(0, 100), data, kind, cu.email]);
    return res.json({ ok: true });
  } catch (err) { console.error('carrier upload hiba:', err); return res.json({ ok: false, err: 'Eroare de server' }); }
});

// Saját feltöltött dokumentumok listája (cég-szintű + fuvar nélküli is)
router.get('/api/carrier/documents', requireCarrier, async (req, res) => {
  try {
    const cu = req.session.carrierUser;
    const r = await pool.query('SELECT id, order_id, file_name, kind, created_at FROM carrier_documents WHERE company_id=$1 AND carrier_id=$2 ORDER BY created_at DESC LIMIT 200', [cu.company_id, cu.carrier_id]);
    return res.json({ ok: true, items: r.rows });
  } catch (err) { console.error('carrier documents hiba:', err); return res.json({ ok: false, err: 'Eroare de server' }); }
});

// Saját feltöltött dokumentum letöltése
router.get('/api/carrier/document/:id', requireCarrier, async (req, res) => {
  try {
    const cu = req.session.carrierUser;
    const r = await pool.query('SELECT file_name, mime, data_base64 FROM carrier_documents WHERE id=$1 AND company_id=$2 AND carrier_id=$3', [parseInt(req.params.id, 10), cu.company_id, cu.carrier_id]);
    if (!r.rows.length) return res.status(404).send('Nu a fost gasit.');
    return _streamB64(res, r.rows[0].data_base64, r.rows[0].mime, r.rows[0].file_name);
  } catch (err) { console.error('carrier doc dl hiba:', err); return res.status(500).send('Eroare de server'); }
});

// A diszpécser által a fuvarhoz csatolt dokumentum letöltése (csak a saját fuvaré)
router.get('/api/carrier/order-doc/:id', requireCarrier, async (req, res) => {
  try {
    const cu = req.session.carrierUser;
    const r = await pool.query(
      `SELECT od.file_name, od.original_base64, od.signed_base64 FROM order_documents od
       JOIN orders o ON o.id=od.order_id AND o.company_id=od.company_id
       WHERE od.id=$1 AND od.company_id=$2 AND o.carrier_id=$3`,
      [parseInt(req.params.id, 10), cu.company_id, cu.carrier_id]);
    if (!r.rows.length) return res.status(404).send('Nu a fost gasit.');
    const b64 = r.rows[0].signed_base64 || r.rows[0].original_base64;
    return _streamB64(res, b64, 'application/pdf', r.rows[0].file_name || 'document.pdf');
  } catch (err) { console.error('carrier order-doc hiba:', err); return res.status(500).send('Eroare de server'); }
});

function _streamB64(res, b64, mime, fileName) {
  if (!b64) return res.status(404).send('Nu exista fisier.');
  let m = String(mime || 'application/octet-stream'), data = String(b64);
  const dm = data.match(/^data:([^;]+);base64,(.*)$/);
  if (dm) { m = dm[1]; data = dm[2]; }
  try {
    const buf = Buffer.from(data, 'base64');
    res.setHeader('Content-Type', m);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName || 'fajl')}"`);
    return res.send(buf);
  } catch (e) { return res.status(404).send('Fisier invalid.'); }
}

module.exports = router;
