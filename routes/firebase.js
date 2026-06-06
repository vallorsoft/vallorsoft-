// ============================================================
//  VallorSoft — Firebase route-ok
//  Kivágva a régi server.js-ből, a kód-törzs változatlan.
// ============================================================
const express = require('express');
const router = express.Router();
const { requireLogin } = require('../middleware/auth');
const fbAdmin = require('../services/firebase');

router.get('/api/firebase-config', requireLogin, (req, res) => {
  const pozicio = req.session.user.pozicio;
  const isDev = req.session.user.is_dev;
  // Minden bejelentkezett user kap config-ot (chat mindenkinek kell)
  // de csak HTTPS-rol, session utan
  if (!['Admin', 'Manager', 'Sofer'].includes(pozicio) && !isDev) {
    return res.status(403).json({ error: 'Nincs jogosultsag' });
  }
  res.json({
    apiKey:        process.env.FIREBASE_API_KEY        || null,
    authDomain:    process.env.FIREBASE_AUTH_DOMAIN    || null,
    databaseURL:   process.env.FIREBASE_DB_URL         || null,
    projectId:     process.env.FIREBASE_PROJECT_ID     || null,
    appId:         process.env.FIREBASE_APP_ID         || null,
  });
});

// Firebase Custom Token - a chat hitelesiteshez (company_id custom claim)
router.get('/api/firebase-token', requireLogin, async (req, res) => {
  try {
    if (!fbAdmin) return res.json({ ok: false, err: 'Firebase Admin nincs konfiguralva' });
    const uid = 'user_' + req.session.user.id;
    const customToken = await fbAdmin.auth().createCustomToken(uid, {
      company_id: String(req.session.user.company_id || 'global'),
      email:      req.session.user.email,
      pozicio:    req.session.user.pozicio
    });
    res.json({ ok: true, token: customToken });
  } catch (err) {
    console.error('firebase-token hiba:', err);
    res.json({ ok: false, err: 'Szerver hiba' });
  }
});

module.exports = router;
