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

// HERE Maps kliens-konfiguracio — csak az API kulcsot adja vissza a terkep-csempekhez.
// A kulcs SOHA nem kerul kozvetlenul HTML-be/kliens JS-be, csak innen toltodik.
router.get('/api/here-config', requireLogin, (req, res) => {
  res.json({ apiKey: process.env.HERE_API_KEY || null });
});

// HERE cim-autocomplete (proxy) — a kulcs szerver oldalon marad.
router.get('/api/here-autocomplete', requireLogin, async (req, res) => {
  const apiKey = process.env.HERE_API_KEY;
  const q = (req.query.q || '').trim();
  if (!apiKey || q.length < 3) return res.json({ items: [] });
  try {
    const url = 'https://autocomplete.search.hereapi.com/v1/autocomplete?q=' +
      encodeURIComponent(q) + '&limit=6&lang=ro,hu,en&apiKey=' + encodeURIComponent(apiKey);
    const r = await fetch(url);
    const d = await r.json().catch(() => ({}));
    const items = (d.items || []).map((it) => ({
      label: (it.address && it.address.label) || it.title || '',
      title: it.title || '',
    })).filter((it) => it.label);
    res.json({ items });
  } catch (e) {
    res.json({ items: [] });
  }
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
