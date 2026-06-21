// ============================================================
//  VallorSoft — Statikus HTML oldal route-ok
//  Kivágva a régi server.js-ből, a kód-törzs változatlan.
// ============================================================
const express = require('express');
const path = require('path');
const router = express.Router();
const pool = require('../db');
const { requirePageLogin, requirePageRole } = require('../middleware/pageGuard');
const { featureEnabled } = require('../lib/featureEnabled');

router.get('/index.html', (req, res) => res.redirect(301, '/'));

router.get('/', (req, res) => {
  if (req.session && req.session.user) {
    const p = req.session.user.pozicio;
    if (req.session.user.is_dev) return res.redirect('/developer');
    if (p === 'Admin') return res.redirect('/admin');
    if (p === 'Manager') return res.redirect('/manager');
    return res.redirect('/sofer');
  }
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
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
router.get('/konyvelo', requirePageLogin, requirePageRole('Konyvelo', 'Admin'), async function(req, res) {
  const ok = await featureEnabled(req.session.user.company_id, 'konyvelo-szerepkor');
  if (!ok) return res.redirect(req.session.user.pozicio === 'Admin' ? '/admin' : '/login');
  res.sendFile(path.join(__dirname, '..', 'public', 'konyvelo.html'));
});
router.get('/utvonaltervezes', requirePageLogin, requirePageRole('Admin', 'Manager'), async function(req, res) {
  // Előfizetés: ha a cégnél ki van kapcsolva, vissza a vezérlőpultra.
  const ok = await featureEnabled(req.session.user.company_id, 'utvonaltervezes');
  if (!ok) return res.redirect(req.session.user.pozicio === 'Manager' ? '/manager' : '/admin');
  res.sendFile(path.join(__dirname, '..', 'public', 'utvonaltervezes.html'));
});

// Vizuális e-mail sablon / kimenő levelező modul (Admin/Manager).
// Önálló statikus oldal (mint az /utvonaltervezes) — NEM res.render.
router.get('/email-builder', requirePageLogin, requirePageRole('Admin', 'Manager'), async function(req, res) {
  const ok = await featureEnabled(req.session.user.company_id, 'email-builder');
  if (!ok) return res.redirect(req.session.user.pozicio === 'Manager' ? '/manager' : '/admin');
  res.sendFile(path.join(__dirname, '..', 'public', 'email-builder.html'));
});

router.get('/subscription', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'subscription.html')));

// Developer landing szerkesztő (is_dev kötelező)
router.get('/developer/landing-editor', requirePageLogin, function(req, res) {
  if (!req.session.user || !req.session.user.is_dev) return res.redirect('/developer');
  res.sendFile(path.join(__dirname, '..', 'public', 'landing-editor.html'));
});

// Developer blog szerkesztő (is_dev kötelező)
router.get('/developer/blog', requirePageLogin, function(req, res) {
  if (!req.session.user || !req.session.user.is_dev) return res.redirect('/developer');
  res.sendFile(path.join(__dirname, '..', 'public', 'blog-editor.html'));
});

// Publikus blog lista
router.get('/blog', function(req, res) {
  res.sendFile(path.join(__dirname, '..', 'public', 'blog.html'));
});

// Publikus blog cikk oldal (slug-alapú, bármilyen slug elfogadott)
router.get('/blog/:slug', function(req, res) {
  res.sendFile(path.join(__dirname, '..', 'public', 'blog-post.html'));
});

// /terms, /privacy, /cookies, /dpa, /security → routes/legal.js kezeli (dinamikusan DB-ből)

module.exports = router;
