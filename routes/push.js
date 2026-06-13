// ============================================================
//  VallorSoft — Web Push route-ok + chat értesítés
//  Kivágva a régi server.js-ből, a kód-törzs változatlan.
// ============================================================
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const pool = require('../db');
const webpush = require('../services/webpush');
const { requireLogin } = require('../middleware/auth');
const { sendPushToEmail, sendPushToRole } = require('../services/push');

router.get('/api/push-vapid-key', requireLogin, (req, res) => {
  if (!webpush || !process.env.VAPID_PUBLIC_KEY) {
    return res.json({ ok: false, key: null });
  }
  res.json({ ok: true, key: process.env.VAPID_PUBLIC_KEY });
});

// Subscription mentese / frissitese
router.post('/api/push-subscribe', requireLogin, async (req, res) => {
  try {
    const subscription = req.body.subscription;
    if (!subscription || !subscription.endpoint) {
      return res.json({ ok: false, err: 'Ervenytelen subscription' });
    }
    const email     = req.session.user.email;
    const companyId = req.session.user.company_id;
    const ua        = req.headers['user-agent'] ? req.headers['user-agent'].substring(0, 500) : null;
    
    // endpoint hash az egyedi azonositashoz
    const endpointHash = crypto.createHash('sha256').update(subscription.endpoint).digest('hex');

    // Upsert: ha mar letezik ez az endpoint, frissitjuk
    await pool.query(
      `INSERT INTO push_subscriptions (email, company_id, subscription, user_agent, endpoint_hash, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (endpoint_hash) DO UPDATE
         SET subscription = $3, updated_at = NOW()`,
      [email, companyId, JSON.stringify(subscription), ua, endpointHash]
    );
    return res.json({ ok: true });
  } catch (err) {
    // Ha az UNIQUE constraint nincs endpoint_hash-on, fallback
    try {
      const subscription = req.body.subscription;
      const email     = req.session.user.email;
      const companyId = req.session.user.company_id;
      const ua        = req.headers['user-agent'] ? req.headers['user-agent'].substring(0, 500) : null;
      const endpointHash = crypto.createHash('sha256').update(subscription.endpoint).digest('hex');
      
      // Delete + insert fallback
      await pool.query('DELETE FROM push_subscriptions WHERE endpoint_hash = $1', [endpointHash]);
      await pool.query(
        `INSERT INTO push_subscriptions (email, company_id, subscription, user_agent, endpoint_hash)
         VALUES ($1, $2, $3, $4, $5)`,
        [email, companyId, JSON.stringify(subscription), ua, endpointHash]
      );
      return res.json({ ok: true });
    } catch(err2) {
      console.error('push-subscribe hiba:', err2);
      return res.json({ ok: false, err: 'Szerver hiba' });
    }
  }
});

// Subscription torlese (leiratkozas)
router.post('/api/push-unsubscribe', requireLogin, async (req, res) => {
  try {
    const endpoint = req.body.endpoint;
    if (!endpoint) return res.json({ ok: false });
    const hash = crypto.createHash('sha256').update(endpoint).digest('hex');
    await pool.query('DELETE FROM push_subscriptions WHERE endpoint_hash = $1 AND email = $2',
      [hash, req.session.user.email]);
    return res.json({ ok: true });
  } catch(err) {
    return res.json({ ok: false });
  }
});

router.post('/api/chat-notify', requireLogin, async (req, res) => {
  try {
    if (!webpush) return res.json({ ok: false, reason: 'push not configured' });
    
    const { toEmails, toRoles, fromName, text, room, companyId } = req.body;
    const senderEmail = req.session.user.email;
    const senderRole  = req.session.user.pozicio;
    
    // Csak sajat ceg felhasznaloinak kuldjuk
    if (companyId && companyId !== req.session.user.company_id) {
      return res.json({ ok: false, err: 'Nincs jogosultsag' });
    }
    const cid = req.session.user.company_id;
    
    const shortText = text ? text.substring(0, 100) : 'Mesaj nou / Új üzenet';
    const senderDisplay = fromName || req.session.user.nume || senderEmail;
    
    const payload = {
      title: '💬 VallorSoft — ' + senderDisplay,
      body:  shortText,
      icon:  '/icon192.png',
      badge: '/icon192.png',
      tag:   'vs-chat-' + (room || 'general'),
      room:  room || null,
      role:  senderRole,
      url:   senderRole === 'Sofer' ? '/sofer' : (senderRole === 'Manager' ? '/manager' : '/admin'),
    };

    // Kuldes email lista alapjan (ha meg van adva)
    if (toEmails && Array.isArray(toEmails) && toEmails.length) {
      const filtered = toEmails.filter(e => e !== senderEmail);
      if (filtered.length) await sendPushToEmail(filtered, payload);
    }
    
    // Kuldes szerepkor alapjan (ha meg van adva)
    if (toRoles && Array.isArray(toRoles) && toRoles.length) {
      // Ne kuldjunk a kuldőnek
      await sendPushToRole(cid, toRoles, payload);
    }

    return res.json({ ok: true });
  } catch(err) {
    console.error('chat-notify hiba:', err);
    return res.json({ ok: false });
  }
});

module.exports = router;
