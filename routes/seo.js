// ============================================================
//  VallorSoft — routes/seo.js
//  Keresőmotor-beállítások (a statikus kiszolgálás ELŐTT mountolva):
//   - GET /robots.txt — a landing/blog/jogi oldalak indexelhetők, a belső
//     felületek (konzolok, API, követő-linkek) tiltva; Sitemap-hivatkozás.
//   - GET / — a landing (index.html) a valódi domainre mutató canonical /
//     og:url címmel (APP_URL), és opcionális Google Search Console
//     ellenőrző meta-taggel (GOOGLE_SITE_VERIFICATION env).
// ============================================================
const express = require('express');
const fs = require('fs');
const path = require('path');
const { appBaseUrl } = require('../lib/appUrl');

const router = express.Router();
const INDEX = path.join(__dirname, '..', 'public', 'index.html');
const HARDCODED = 'https://app.vallorsoft.ro';

function base() { return appBaseUrl('https://vallorsoft.fly.dev'); }

const DISALLOW = [
  '/api/', '/admin', '/manager', '/sofer', '/developer', '/konyvelo', '/portal', '/carrier',
  '/t/', '/email-builder', '/utvonaltervezes', '/reset-password', '/subscription', '/abonament',
  '/landing-editor', '/blog-editor', '/pdf-template-mockups',
];

router.get('/robots.txt', (req, res) => {
  const lines = ['User-agent: *', 'Allow: /'].concat(DISALLOW.map(p => 'Disallow: ' + p));
  lines.push('', 'Sitemap: ' + base() + '/sitemap.xml', '');
  res.type('text/plain').set('Cache-Control', 'public, max-age=3600').send(lines.join('\n'));
});

let _tpl = null;
function landingHtml() {
  if (!_tpl || process.env.NODE_ENV !== 'production') _tpl = fs.readFileSync(INDEX, 'utf8');
  const b = base();
  let html = _tpl.split(HARDCODED + '/').join(b + '/');
  const ver = String(process.env.GOOGLE_SITE_VERIFICATION || '').trim();
  if (/^[A-Za-z0-9_-]{10,100}$/.test(ver)) {
    html = html.replace('<meta name="robots"', '<meta name="google-site-verification" content="' + ver + '">\n<meta name="robots"');
  }
  return html;
}

router.get('/', (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-cache').type('html').send(landingHtml());
  } catch (e) { next(); } // hiba esetén a statikus index.html megy ki
});

module.exports = router;
module.exports._landingHtml = landingHtml;
