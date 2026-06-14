// ============================================================
//  VallorSoft — Statikus HTML oldal route-ok
//  Kivágva a régi server.js-ből, a kód-törzs változatlan.
// ============================================================
const express = require('express');
const path = require('path');
const router = express.Router();
const pool = require('../db');
const { requirePageLogin, requirePageRole } = require('../middleware/pageGuard');

// A funkció be van-e kapcsolva a cégnél (hiányzó sor = engedélyezett).
async function featureEnabled(companyId, key) {
  if (!companyId) return true;
  try {
    const r = await pool.query(
      'SELECT enabled FROM company_features WHERE company_id = $1 AND feature_key = $2', [companyId, key]);
    return r.rows.length ? r.rows[0].enabled !== false : true;
  } catch (e) { return true; }
}

router.get('/', (req, res) => {
  if (req.session && req.session.user) {
    const p = req.session.user.pozicio;
    if (req.session.user.is_dev) return res.redirect('/developer');
    if (p === 'Admin') return res.redirect('/admin');
    if (p === 'Manager') return res.redirect('/manager');
    return res.redirect('/sofer');
  }
  res.sendFile(path.join(__dirname, '..', 'public', 'login.html'));
});
router.get('/login', (req, res) => {
  if (req.session && req.session.user) {
    const p = req.session.user.pozicio;
    if (req.session.user.is_dev) return res.redirect('/developer');
    if (p === 'Admin') return res.redirect('/admin');
    if (p === 'Manager') return res.redirect('/manager');
    return res.redirect('/sofer');
  }
  res.sendFile(path.join(__dirname, '..', 'public', 'login.html'));
});
router.get('/register', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'register.html')));
router.get('/reset-password', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'reset-password.html')));
router.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'privacy.html')));
router.get('/terms', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'terms.html')));

router.get('/developer', requirePageLogin, function(req, res) {
  if (!req.session.user.is_dev) return res.redirect('/login');
  res.sendFile(path.join(__dirname, '..', 'public', 'developer.html'));
});
router.get('/admin', requirePageLogin, requirePageRole('Admin'), function(req, res) {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});
router.get('/manager', requirePageLogin, requirePageRole('Manager', 'Admin'), function(req, res) {
  res.sendFile(path.join(__dirname, '..', 'public', 'manager.html'));
});
router.get('/sofer', requirePageLogin, requirePageRole('Sofer', 'Admin', 'Manager'), function(req, res) {
  res.sendFile(path.join(__dirname, '..', 'public', 'sofer.html'));
});
router.get('/konyvelo', requirePageLogin, requirePageRole('Konyvelo', 'Admin'), function(req, res) {
  res.sendFile(path.join(__dirname, '..', 'public', 'konyvelo.html'));
});
router.get('/utvonaltervezes', requirePageLogin, requirePageRole('Admin', 'Manager'), async function(req, res) {
  // Előfizetés: ha a cégnél ki van kapcsolva, vissza a vezérlőpultra.
  const ok = await featureEnabled(req.session.user.company_id, 'utvonaltervezes');
  if (!ok) return res.redirect(req.session.user.pozicio === 'Manager' ? '/manager' : '/admin');
  res.sendFile(path.join(__dirname, '..', 'public', 'utvonaltervezes.html'));
});

module.exports = router;
