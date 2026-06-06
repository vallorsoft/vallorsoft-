// routes/cargotrack.js
// CargoTrack (GPS) önálló REST végpontok. Mount: app.use(require('./routes/cargotrack'));
const express = require('express');
const pool = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');
const svc = require('../services/cargotrack');
const { encrypt, decrypt, mask } = require('../lib/crypto');

const router = express.Router();
const PROVIDER = 'cargotrack';
const CATEGORY = 'gps';

async function getKey(companyId) {
  const { rows } = await pool.query(
    `SELECT credentials_enc, enabled FROM company_integrations
     WHERE company_id=$1 AND provider=$2`, [companyId, PROVIDER]);
  if (!rows.length || !rows[0].credentials_enc) return null;
  return { apiKey: decrypt(rows[0].credentials_enc), enabled: rows[0].enabled };
}
async function objectIdForRendszam(companyId, rendszam) {
  const { rows } = await pool.query(
    `SELECT object_id FROM vehicle_gps_map WHERE company_id=$1 AND provider=$2 AND rendszam=$3`,
    [companyId, PROVIDER, rendszam]);
  return rows.length ? rows[0].object_id : null;
}

// ---- KAPCSOLAT (Integrációk fül) ----
router.get('/api/integrations/cargotrack', requireLogin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT enabled, status, status_message, last_check, meta, credentials_enc
       FROM company_integrations WHERE company_id=$1 AND provider=$2`,
      [req.session.user.company_id, PROVIDER]);
    if (!rows.length) return res.json({ connected: false, enabled: false });
    const r = rows[0];
    res.json({
      connected: !!r.credentials_enc, enabled: r.enabled, status: r.status,
      status_message: r.status_message, last_check: r.last_check, meta: r.meta,
      masked_key: r.credentials_enc ? mask(decrypt(r.credentials_enc)) : null,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/integrations/cargotrack/test', requireLogin, requireRole('Admin'), async (req, res) => {
  const apiKey = (req.body.api_key || '').trim();
  if (!apiKey) return res.status(400).json({ ok: false, error: 'Hiányzik az API-kulcs.' });
  try { res.json({ ok: true, objectCount: (await svc.testConnection(apiKey)).objectCount }); }
  catch (e) { res.status(e.status === 401 ? 401 : 502).json({ ok: false, error: e.message }); }
});

router.post('/api/integrations/cargotrack', requireLogin, requireRole('Admin'), async (req, res) => {
  const apiKey = (req.body.api_key || '').trim();
  const enabled = req.body.enabled !== false;
  if (!apiKey) return res.status(400).json({ ok: false, error: 'Hiányzik az API-kulcs.' });
  try {
    const test = await svc.testConnection(apiKey);
    await pool.query(
      `INSERT INTO company_integrations
         (company_id, provider, category, enabled, credentials_enc, status, last_check, meta, updated_at)
       VALUES ($1,$2,$3,$4,$5,'connected',now(),$6,now())
       ON CONFLICT (company_id, provider) DO UPDATE SET
         enabled=$4, credentials_enc=$5, status='connected', status_message=NULL,
         last_check=now(), meta=$6, updated_at=now()`,
      [req.session.user.company_id, PROVIDER, CATEGORY, enabled, encrypt(apiKey),
       JSON.stringify({ objectCount: test.objectCount })]);
    res.json({ ok: true, objectCount: test.objectCount, masked_key: mask(apiKey) });
  } catch (e) { res.status(e.status === 401 ? 401 : 502).json({ ok: false, error: e.message }); }
});

// ---- RO e-Transport beállítás (a meta.etransport-ba, a kulcs érintetlen marad) ----
router.post('/api/integrations/cargotrack/etransport', requireLogin, requireRole('Admin'), async (req, res) => {
  const etransport = {
    enabled: req.body.enabled === true || req.body.enabled === 'true',
    environment: req.body.environment === 'prod' ? 'prod' : 'test',
  };
  try {
    const { rows } = await pool.query(
      `SELECT meta FROM company_integrations WHERE company_id=$1 AND provider=$2`,
      [req.session.user.company_id, PROVIDER]);
    if (!rows.length) return res.status(409).json({ error: 'Előbb mentsd el a CargoTrack API-kulcsot.' });
    const meta = Object.assign({}, rows[0].meta || {}, { etransport });
    await pool.query(
      `UPDATE company_integrations SET meta=$1, updated_at=now() WHERE company_id=$2 AND provider=$3`,
      [JSON.stringify(meta), req.session.user.company_id, PROVIDER]);
    res.json({ ok: true, etransport });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/api/integrations/cargotrack', requireLogin, requireRole('Admin'), async (req, res) => {
  try {
    await pool.query(`DELETE FROM company_integrations WHERE company_id=$1 AND provider=$2`,
      [req.session.user.company_id, PROVIDER]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- JÁRMŰ-PÁROSÍTÁS ----
router.get('/api/integrations/cargotrack/objects', requireLogin, async (req, res) => {
  try {
    const k = await getKey(req.session.user.company_id);
    if (!k) return res.status(409).json({ error: 'Nincs beállított CargoTrack kulcs.' });
    res.json({ objects: await svc.listObjects(k.apiKey) });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

router.get('/api/integrations/cargotrack/map', requireLogin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT rendszam, object_id, object_name FROM vehicle_gps_map
       WHERE company_id=$1 AND provider=$2 ORDER BY rendszam`,
      [req.session.user.company_id, PROVIDER]);
    res.json({ mappings: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/integrations/cargotrack/map', requireLogin, requireRole('Admin'), async (req, res) => {
  const rendszam = (req.body.rendszam || '').trim();
  const object_id = (req.body.object_id || '').trim();
  const object_name = (req.body.object_name || '').trim() || null;
  if (!rendszam || !object_id) return res.status(400).json({ error: 'rendszam és object_id kötelező.' });
  try {
    await pool.query(
      `INSERT INTO vehicle_gps_map (company_id, provider, rendszam, object_id, object_name, updated_at)
       VALUES ($1,$2,$3,$4,$5,now())
       ON CONFLICT (company_id, provider, rendszam) DO UPDATE SET object_id=$4, object_name=$5, updated_at=now()`,
      [req.session.user.company_id, PROVIDER, rendszam, object_id, object_name]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/api/integrations/cargotrack/map', requireLogin, requireRole('Admin'), async (req, res) => {
  const rendszam = (req.query.rendszam || '').trim();
  if (!rendszam) return res.status(400).json({ error: 'rendszam kötelező.' });
  try {
    await pool.query(`DELETE FROM vehicle_gps_map WHERE company_id=$1 AND provider=$2 AND rendszam=$3`,
      [req.session.user.company_id, PROVIDER, rendszam]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- POZÍCIÓ ("Hol a kocsi?") ----
router.get('/api/cargotrack/position', requireLogin, async (req, res) => {
  let objectId = (req.query.object_id || '').trim();
  const rendszam = (req.query.rendszam || '').trim();
  try {
    const k = await getKey(req.session.user.company_id);
    if (!k || !k.enabled) return res.status(409).json({ error: 'A CargoTrack nincs bekapcsolva.' });
    if (!objectId && rendszam) {
      objectId = await objectIdForRendszam(req.session.user.company_id, rendszam);
      if (!objectId) return res.status(404).json({ error: 'Ez a rendszám nincs összepárosítva GPS-szel.', code: 'NOT_MAPPED' });
    }
    if (!objectId) return res.status(400).json({ error: 'rendszam vagy object_id kötelező.' });
    const status = await svc.getLatestStatus(k.apiKey, objectId);
    if (!status) return res.json({ position: null, message: 'Nincs friss pozícióadat.' });
    res.json({ position: status });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

module.exports = router;
