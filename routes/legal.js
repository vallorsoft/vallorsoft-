// ============================================================
//  VallorSoft — routes/legal.js
//  Jogi oldalak dinamikus kiszolgálása (DB-ből, fallback: statikus fájl)
//  + pending-ack / ack REST endpointok (minden session-típusra)
// ============================================================
const express = require('express');
const path    = require('path');
const fs      = require('fs').promises;
const pool    = require('../db');
const router  = express.Router();

const LEGAL_META = {
  terms:    { file: 'terms.html',    title: 'Termeni și Condiții' },
  privacy:  { file: 'privacy.html',  title: 'Politica de Confidențialitate' },
  cookies:  { file: 'cookies.html',  title: 'Politica de Cookies' },
  dpa:      { file: 'dpa.html',      title: 'Acord de Prelucrare Date' },
  security: { file: 'security.html', title: 'Politica de Securitate' },
};

// Helper: aktív user bármely session-típusból
function sessionUser(req) {
  if (req.session && req.session.user)         return { type: 'user',         id: req.session.user.id };
  if (req.session && req.session.clientUser)   return { type: 'client_user',  id: req.session.clientUser.id };
  if (req.session && req.session.carrierUser)  return { type: 'carrier_user', id: req.session.carrierUser.id };
  return null;
}

// GET /api/legal/pending-ack — visszaadja a bejelentkezett user még el nem fogadott módosításait
router.get('/api/legal/pending-ack', async (req, res) => {
  const u = sessionUser(req);
  if (!u) return res.json({ ok: true, pending: [] });
  try {
    const pagesR = await pool.query(
      `SELECT key, value FROM developer_settings
        WHERE key LIKE 'legal_%' AND value->>'notify_version' IS NOT NULL`
    );
    const pending = [];
    for (const row of pagesR.rows) {
      const val   = row.value;
      const ver   = val.notify_version;
      if (!ver) continue;
      const ackR  = await pool.query(
        `SELECT id FROM legal_consents
          WHERE user_type=$1 AND user_id=$2 AND page_key=$3 AND version=$4`,
        [u.type, u.id, row.key, ver]
      );
      if (!ackR.rows.length) {
        const pageKey = row.key.replace('legal_', '');
        pending.push({
          page_key:   row.key,
          page_name:  val.title || pageKey,
          updated_at: val.updated_at || '',
          version:    ver,
          diff_html:  val.diff_html || null,
          link:       '/' + pageKey,
        });
      }
    }
    res.json({ ok: true, pending });
  } catch (err) {
    console.error('legal pending-ack hiba:', err);
    res.json({ ok: true, pending: [] });
  }
});

// POST /api/legal/ack — visszaigazolás naplózása
router.post('/api/legal/ack', async (req, res) => {
  const u = sessionUser(req);
  if (!u) return res.status(401).json({ ok: false, err: 'Nu sunteti autentificat.' });
  const { page_key, version } = req.body || {};
  if (!page_key || !version) return res.status(400).json({ ok: false, err: 'Date lipsă.' });
  try {
    await pool.query(
      `INSERT INTO legal_consents(user_type, user_id, page_key, version, ip)
       VALUES($1,$2,$3,$4,$5)
       ON CONFLICT (user_type, user_id, page_key, version) DO NOTHING`,
      [u.type, u.id, page_key, version, req.ip]
    );
    // Audit-napló (csak normál user)
    if (u.type === 'user') {
      try {
        require('../lib/audit').fromReq(req, 'legal.ack', 'legal_page', page_key, { version });
      } catch (_) {}
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('legal ack hiba:', err);
    res.status(500).json({ ok: false, err: 'Eroare de server.' });
  }
});

// Dinamikus jogi oldal kiszolgálása
async function serveLegalPage(req, res, pageKey) {
  const meta = LEGAL_META[pageKey];
  if (!meta) return res.status(404).send('Not found');
  const staticPath = path.join(__dirname, '..', 'public', meta.file);
  try {
    let html = await fs.readFile(staticPath, 'utf8');
    const dbR = await pool.query(
      'SELECT value FROM developer_settings WHERE key=$1', ['legal_' + pageKey]
    ).catch(() => ({ rows: [] }));
    if (dbR.rows.length && dbR.rows[0].value && dbR.rows[0].value.html) {
      const val = dbR.rows[0].value;
      // Tartalom + dátum behelyettesítése
      html = html.replace(
        /<main class="policy-content">([\s\S]*?)<\/main>/,
        `<main class="policy-content">\n${val.html}\n  </main>`
      );
    }
    res.send(html);
  } catch (err) {
    console.error('legal page serve hiba:', err);
    res.status(500).send('Eroare de server.');
  }
}

router.get('/terms',    (req, res) => serveLegalPage(req, res, 'terms'));
router.get('/privacy',  (req, res) => serveLegalPage(req, res, 'privacy'));
router.get('/cookies',  (req, res) => serveLegalPage(req, res, 'cookies'));
router.get('/dpa',      (req, res) => serveLegalPage(req, res, 'dpa'));
router.get('/security', (req, res) => serveLegalPage(req, res, 'security'));

module.exports = router;
