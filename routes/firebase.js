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
    return res.status(403).json({ error: 'Nu aveti permisiune' });
  }
  res.json({
    apiKey:        process.env.FIREBASE_API_KEY        || null,
    authDomain:    process.env.FIREBASE_AUTH_DOMAIN    || null,
    databaseURL:   process.env.FIREBASE_DB_URL         || null,
    projectId:     process.env.FIREBASE_PROJECT_ID     || null,
    appId:         process.env.FIREBASE_APP_ID         || null,
  });
});

// Térkép-konfiguráció — a HERE le lett cserélve INGYENES szolgáltatásokra
// (CartoDB/OSM csempék + Photon geokódolás + OSRM routing), ezért API-kulcs
// nincs. A végpont kompatibilitásból megmaradt: a kliens kulcs hiányában
// automatikusan az ingyenes csempékre vált.
router.get('/api/here-config', requireLogin, (req, res) => {
  res.json({ apiKey: null });
});

// Cím-autocomplete (proxy) — Photon (photon.komoot.io), OpenStreetMap alapú,
// INGYENES, kulcs nélkül. A régi /api/here-autocomplete útvonal megmaradt,
// hogy a kliens-hívások ne törjenek.
const mapsProvider = require('../lib/mapsProvider');
async function geoAutocomplete(req, res) {
  const q = (req.query.q || '').trim();
  if (q.length < 3) return res.json({ items: [] });
  try {
    // Cégenkénti szolgáltató (HERE/Google), ha be van állítva — különben ingyenes (Photon).
    const cid = req.session && req.session.user ? req.session.user.company_id : null;
    const items = await mapsProvider.autocomplete(cid, q);
    res.json({ items });
  } catch (e) {
    res.json({ items: [] });
  }
}
router.get('/api/here-autocomplete', requireLogin, geoAutocomplete);
router.get('/api/geo-autocomplete', requireLogin, geoAutocomplete);

// Firebase Custom Token - a chat hitelesiteshez (company_id custom claim)
router.get('/api/firebase-token', requireLogin, async (req, res) => {
  try {
    if (!fbAdmin) return res.json({ ok: false, err: 'Firebase Admin nu este configurat' });
    const uid = 'user_' + req.session.user.id;
    const customToken = await fbAdmin.auth().createCustomToken(uid, {
      company_id: String(req.session.user.company_id || 'global'),
      email:      req.session.user.email,
      pozicio:    req.session.user.pozicio
    });
    res.json({ ok: true, token: customToken });
  } catch (err) {
    console.error('firebase-token hiba:', err);
    res.json({ ok: false, err: 'Eroare de server' });
  }
});

module.exports = router;
