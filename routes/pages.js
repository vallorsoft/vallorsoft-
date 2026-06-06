// ============================================================
//  VallorSoft — Statikus HTML oldal route-ok
//  Kivágva a régi server.js-ből, a kód-törzs változatlan.
// ============================================================
const express = require('express');
const path = require('path');
const router = express.Router();
const { requirePageLogin, requirePageRole } = require('../middleware/pageGuard');

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

module.exports = router;
