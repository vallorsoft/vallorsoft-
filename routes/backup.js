// ============================================================
//  VallorSoft — routes/backup.js
//  Google Drive összekötés (OAuth2) a cégenkénti biztonsági mentéshez.
//   GET /api/backup/google/connect?target=company   — cég Admin: a cég SAJÁT Drive-ja
//   GET /api/backup/google/connect?target=vs        — developer: a VallorSoft Drive-ja
//   GET /api/backup/google/callback                 — Google visszahívás
//  A state egyszer használatos, a munkamenethez kötött (CSRF-védelem).
// ============================================================
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { requireLogin } = require('../middleware/auth');
const drive = require('../lib/googleDrive');
const backup = require('../services/companyBackup');
const audit = require('../lib/audit');
const { featureEnabled } = require('../lib/featureEnabled');

const STATE_TTL_MS = 10 * 60 * 1000;

function backTo(target, status) {
  return (target === 'vs' ? '/developer' : '/admin') + '?gdrive=' + encodeURIComponent(status);
}

router.get('/api/backup/google/connect', requireLogin, async (req, res) => {
  const u = req.session.user;
  const target = req.query.target === 'vs' ? 'vs' : 'company';
  if (target === 'vs' && !u.is_dev) return res.status(403).send('Acces interzis.');
  if (target === 'company') {
    if (u.pozicio !== 'Admin') return res.status(403).send('Acces interzis.');
    if (!(await featureEnabled(u.company_id, 'drive-backup'))) return res.status(403).send('Funcție indisponibilă.');
  }
  if (!drive.isConfigured()) return res.redirect(backTo(target, 'noconfig'));
  const state = crypto.randomBytes(24).toString('hex');
  req.session.gdriveOauth = { state, target, cid: u.company_id, uid: u.id, ts: Date.now() };
  req.session.save(() => res.redirect(drive.authUrl(state)));
});

router.get('/api/backup/google/callback', requireLogin, async (req, res) => {
  const pending = req.session.gdriveOauth;
  delete req.session.gdriveOauth;
  const target = pending && pending.target === 'vs' ? 'vs' : 'company';
  const u = req.session.user;
  const valid = pending && typeof req.query.state === 'string' && pending.state.length === req.query.state.length
    && crypto.timingSafeEqual(Buffer.from(pending.state), Buffer.from(req.query.state))
    && (Date.now() - pending.ts) < STATE_TTL_MS && pending.uid === u.id && pending.cid === u.company_id;
  if (!valid) return res.redirect(backTo(target, 'state'));
  if (req.query.error || !req.query.code) return res.redirect(backTo(target, 'denied'));
  try {
    const { refreshToken, email } = await drive.exchangeCode(String(req.query.code));
    if (target === 'vs') {
      if (!u.is_dev) return res.redirect(backTo(target, 'state'));
      await backup.saveVsDrive(refreshToken, email);
      audit.fromReq(req, 'backup.vs_drive_connect', 'developer_settings', 'backup_vs_drive', { email });
    } else {
      if (u.pozicio !== 'Admin') return res.redirect(backTo(target, 'state'));
      await backup.saveCompanyDrive(u.company_id, refreshToken, email);
      audit.fromReq(req, 'backup.drive_connect', 'company_integration', 'gdrive_backup', { email });
    }
    return res.redirect(backTo(target, 'ok'));
  } catch (e) {
    console.error('Google Drive összekötés hiba:', e.message);
    return res.redirect(backTo(target, 'error'));
  }
});

module.exports = router;
