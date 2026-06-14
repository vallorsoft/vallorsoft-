// routes/uit.js — RO e-Transport UIT-kódok fuvaronként.
// Mount: app.use(require('./routes/uit'));
const express = require('express');
const pool = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');
const { decrypt } = require('../lib/crypto');

const router = express.Router();

// A cég AKTÍV GPS-szolgáltatója (category='gps') — provider + kulcs + e-Transport beállítás.
// Ha több is van, a cargotrack-et preferáljuk, de bármelyik GPS-provider ugyanígy működik.
async function getGpsCfg(companyId) {
  const { rows } = await pool.query(
    `SELECT provider, credentials_enc, meta FROM company_integrations
       WHERE company_id=$1 AND category='gps' AND enabled=true AND credentials_enc IS NOT NULL
       ORDER BY (provider='cargotrack') DESC, updated_at DESC LIMIT 1`, [companyId]);
  if (!rows.length) return null;
  const meta = rows[0].meta || {};
  return { provider: rows[0].provider, apiKey: decrypt(rows[0].credentials_enc), etransport: meta.etransport || { enabled: false } };
}
async function objectIdForRendszam(companyId, provider, rendszam) {
  if (!rendszam || !provider) return null;
  const { rows } = await pool.query(
    `SELECT object_id FROM vehicle_gps_map WHERE company_id=$1 AND provider=$2 AND rendszam=$3`,
    [companyId, provider, rendszam]);
  return rows.length ? rows[0].object_id : null;
}
const own = (req) => req.session.user.company_id;

// ---- LISTA egy fuvarhoz ----
router.get('/api/orders/:id/uit', requireLogin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, uit_code, rendszam, object_id, status, valid_until, last_message, sent_at, stopped_at, created_at
         FROM order_uit_codes WHERE company_id=$1 AND order_id=$2 ORDER BY created_at`,
      [own(req), req.params.id]);
    res.json({ items: rows });
  } catch (e) { console.error('GET /api/orders/:id/uit hiba:', e); res.status(500).json({ error: 'Eroare de server' }); }
});

// ---- ÖSSZESÍTŐ a fuvarlista gombjaihoz (1 kérés több fuvarra) ----
router.get('/api/uit/summary', requireLogin, async (req, res) => {
  const ids = String(req.query.order_ids || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!ids.length) return res.json({ summary: {} });
  try {
    const { rows } = await pool.query(
      `SELECT order_id, status, COUNT(*)::int AS n FROM order_uit_codes
         WHERE company_id=$1 AND order_id = ANY($2) GROUP BY order_id, status`,
      [own(req), ids]);
    const summary = {};
    rows.forEach(r => {
      const s = summary[r.order_id] || (summary[r.order_id] = { total: 0, active: 0, error: 0, new: 0, stopped: 0 });
      s.total += r.n; if (s[r.status] != null) s[r.status] += r.n;
    });
    res.json({ summary });
  } catch (e) { console.error('GET /api/uit/summary hiba:', e); res.status(500).json({ error: 'Eroare de server' }); }
});

// ---- HOZZÁADÁS ----
router.post('/api/orders/:id/uit', requireLogin, requireRole('Admin', 'Manager'), async (req, res) => {
  const uit = (req.body.uit_code || '').trim();
  if (!uit) return res.status(400).json({ error: 'Codul UIT este obligatoriu.' });
  try {
    // rendszám: a kérésből, vagy a fuvar vontatójából
    let rendszam = (req.body.rendszam || '').trim();
    if (!rendszam) {
      const o = await pool.query(`SELECT rendszam_camion FROM orders WHERE id=$1 AND company_id=$2`, [req.params.id, own(req)]);
      rendszam = o.rows.length ? (o.rows[0].rendszam_camion || '') : '';
    }
    const gpsCfg = await getGpsCfg(own(req));
    const objectId = await objectIdForRendszam(own(req), gpsCfg ? gpsCfg.provider : null, rendszam);
    const provider = gpsCfg ? gpsCfg.provider : 'cargotrack';
    const validUntil = req.body.valid_until || null;
    const { rows } = await pool.query(
      `INSERT INTO order_uit_codes (company_id, order_id, uit_code, rendszam, object_id, provider, valid_until, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (company_id, order_id, uit_code) DO NOTHING
       RETURNING id, uit_code, rendszam, object_id, status, valid_until, last_message, sent_at, stopped_at, created_at`,
      [own(req), req.params.id, uit, rendszam || null, objectId, provider, validUntil, req.session.user.id]);
    if (!rows.length) return res.status(409).json({ error: 'Acest UIT este deja inregistrat la aceasta cursa.' });
    res.json({ item: rows[0] });
  } catch (e) { console.error('POST /api/orders/:id/uit hiba:', e); res.status(500).json({ error: 'Eroare de server' }); }
});

// ---- TÖRLÉS ----
router.delete('/api/uit/:uid', requireLogin, requireRole('Admin', 'Manager'), async (req, res) => {
  try {
    const r = await pool.query(`DELETE FROM order_uit_codes WHERE id=$1 AND company_id=$2`, [req.params.uid, own(req)]);
    if (!r.rowCount) return res.status(404).json({ error: 'Nu a fost gasit.' });
    res.json({ ok: true });
  } catch (e) { console.error('DELETE /api/uit/:uid hiba:', e); res.status(500).json({ error: 'Eroare de server' }); }
});

// ============================================================
// SOFŐR-HATÓKÖR — a sofőr CSAK a neki kiosztott fuvar UIT-jait látja/kezeli.
// Kötés: orders.email_sofer = a belépett sofőr e-mailje (+ company_id).
// ============================================================
async function soferOwnsOrder(req) {
  const { rows } = await pool.query(
    `SELECT rendszam_camion FROM orders
       WHERE id=$1 AND company_id=$2 AND LOWER(email_sofer)=LOWER($3)`,
    [req.params.id, own(req), req.session.user.email]);
  return rows.length ? rows[0] : null;
}

// LISTA — a sofőr a saját fuvarja UIT-jait látja (állapot + ANAF-visszaigazolás).
router.get('/api/sofer/orders/:id/uit', requireLogin, requireRole('Sofer'), async (req, res) => {
  try {
    if (!(await soferOwnsOrder(req))) return res.status(403).json({ error: 'Nu aveti permisiune pentru aceasta cursa.' });
    const { rows } = await pool.query(
      `SELECT id, uit_code, status, anaf_confirmed, anaf_confirmed_at, last_message, sent_at, created_at
         FROM order_uit_codes WHERE company_id=$1 AND order_id=$2 ORDER BY created_at`,
      [own(req), req.params.id]);
    res.json({ items: rows, canAdd: rows.length === 0 });
  } catch (e) { console.error('GET /api/sofer/orders/:id/uit hiba:', e); res.status(500).json({ error: 'Eroare de server' }); }
});

// HOZZÁADÁS — a sofőr CSAK akkor adhat UIT-ot, ha még EGY SINCS a fuvarnál.
router.post('/api/sofer/orders/:id/uit', requireLogin, requireRole('Sofer'), async (req, res) => {
  const uit = (req.body.uit_code || '').trim();
  if (!uit) return res.status(400).json({ error: 'Codul UIT este obligatoriu.' });
  try {
    const order = await soferOwnsOrder(req);
    if (!order) return res.status(403).json({ error: 'Nu aveti permisiune pentru aceasta cursa.' });
    const cnt = await pool.query(`SELECT COUNT(*)::int AS n FROM order_uit_codes WHERE company_id=$1 AND order_id=$2`, [own(req), req.params.id]);
    if (cnt.rows[0].n > 0) return res.status(409).json({ error: 'Aceasta cursa are deja cod UIT — ca sofer nu puteti adauga unul nou.' });
    const rendszam = order.rendszam_camion || '';
    const gpsCfg = await getGpsCfg(own(req));
    const objectId = await objectIdForRendszam(own(req), gpsCfg ? gpsCfg.provider : null, rendszam);
    const provider = gpsCfg ? gpsCfg.provider : 'cargotrack';
    const { rows } = await pool.query(
      `INSERT INTO order_uit_codes (company_id, order_id, uit_code, rendszam, object_id, provider, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (company_id, order_id, uit_code) DO NOTHING
       RETURNING id, uit_code, status, anaf_confirmed, anaf_confirmed_at, last_message, sent_at, created_at`,
      [own(req), req.params.id, uit, rendszam || null, objectId, provider, req.session.user.id]);
    if (!rows.length) return res.status(409).json({ error: 'Acest UIT este deja inregistrat.' });
    res.json({ item: rows[0] });
  } catch (e) { console.error('POST /api/sofer/orders/:id/uit hiba:', e); res.status(500).json({ error: 'Eroare de server' }); }
});

module.exports = router;
