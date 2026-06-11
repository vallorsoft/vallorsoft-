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
async function geoAutocomplete(req, res) {
  const q = (req.query.q || '').trim();
  if (q.length < 3) return res.json({ items: [] });
  try {
    const url = 'https://photon.komoot.io/api/?q=' + encodeURIComponent(q) + '&limit=6';
    const r = await fetch(url, { headers: { 'User-Agent': 'VallorSoft/1.0 (flottakezelo)' } });
    const d = await r.json().catch(() => ({}));
    const items = ((d && d.features) || []).map((f) => {
      const p = f.properties || {};
      const main = p.name || p.street || '';
      const sub = [p.street && p.name !== p.street ? p.street : null, p.postcode, p.city, p.state, p.country]
        .filter(Boolean).join(', ');
      const label = [main, sub].filter(Boolean).join(', ');
      return { label, title: main || label };
    }).filter((it) => it.label);
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
