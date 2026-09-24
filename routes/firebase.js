// ============================================================
//  VallorSoft — Firebase route-ok
//  Kivágva a régi server.js-ből, a kód-törzs változatlan.
// ============================================================
const express = require('express');
const router = express.Router();
const { requireLogin } = require('../middleware/auth');
const fbAdmin = require('../services/firebase');
const mapsProvider = require('../lib/mapsProvider');

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

// Térkép-konfiguráció — a HERE-kulcs cégenként a `company_integrations`
// provider='maps' rekordban (AES-titkosítva). Ha be van állítva, a kliens
// HERE raszter-csempéket kap; különben az ingyenes CARTO/OSM fallback él.
// Csak bejelentkezett cég-user érheti el (a session-védelem gátolja a random
// scraper-t; a kulcs referrer-korlátozott is lehet a HERE-panelen).
// A kulcsot bármelyik bejelentkezett session-fajta (admin/manager, ügyfél-portál,
// alvállalkozó-portál) elérheti — mindegyik a saját cég-kontextusából (company_id).
// Így minden felület (fuvar-kiírás, kezelés, ügyfél-követés, alvállalkozó-portál,
// vezérlőpult, aktív flotta, GPS-track) UGYANAZT a developer-integrációs
// HERE-kulcsot kapja.
router.get('/api/here-config', async (req, res) => {
  try {
    const s = req.session || {};
    let cid = null;
    if (s.user && s.user.company_id) cid = s.user.company_id;
    else if (s.clientUser && s.clientUser.company_id) cid = s.clientUser.company_id;
    else if (s.carrierUser && s.carrierUser.company_id) cid = s.carrierUser.company_id;
    if (!cid) return res.status(401).json({ apiKey: null, reason: 'no-session' });
    // ?fresh=1 → 60s cache átugrása (a developer újramenti a kulcsot,
    // majd itt frissítést kér — ne kelljen 60s várni)
    if (req.query && req.query.fresh) mapsProvider.clearConfigCache(cid);
    const cfg = await mapsProvider.getConfig(cid);
    if (cfg.vendor === 'here' && cfg.key) return res.json({ apiKey: cfg.key, reason: 'ok' });
    return res.json({ apiKey: null, reason: cfg.reason || 'unknown' });
  } catch (e) {
    return res.json({ apiKey: null, reason: 'error:' + (e.message || 'unknown') });
  }
});

// Cím-autocomplete (proxy) — Photon (photon.komoot.io), OpenStreetMap alapú,
// INGYENES, kulcs nélkül. A régi /api/here-autocomplete útvonal megmaradt,
// hogy a kliens-hívások ne törjenek.
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
