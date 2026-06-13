// ============================================================
//  VallorSoft — routes/health.js
//  Üzemeltetési health-check végpontok (auth NÉLKÜL, könnyűek):
//   - GET /healthz : liveness — a folyamat fut-e (mindig 200).
//   - GET /readyz  : readiness — a DB elérhető-e (200 / 503).
//  Load balancer / uptime-monitor / konténer-orchestrátor ezeket
//  pingeli. A választ NEM cache-eljük (mindig friss állapot).
// ============================================================
const express = require('express');
const router = express.Router();
const pool = require('../db');

const startedAt = Date.now();

router.get('/healthz', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, status: 'up', uptime_s: Math.round((Date.now() - startedAt) / 1000) });
});

router.get('/readyz', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, status: 'ready', db: 'up', uptime_s: Math.round((Date.now() - startedAt) / 1000) });
  } catch (e) {
    res.status(503).json({ ok: false, status: 'not-ready', db: 'down' });
  }
});

module.exports = router;
