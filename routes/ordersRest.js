// ============================================================
//  VallorSoft — Fuvar gyors-státusz REST route-ok
//  Kivágva a régi server.js-ből, a kód-törzs változatlan.
// ============================================================
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');
const { sendPushToRole } = require('../services/push');

router.post('/api/orders/:id/quick-status', requireLogin, requireRole('Admin','Manager'), async (req, res) => {
  const { status } = req.body;
  const valid = ['Disponibil','Alocat','Extern','In Curs','Finalizat','Anulat'];
  if (!valid.includes(status)) return res.json({ ok: false, err: 'Status invalid' });
  try {
    const r = await pool.query(
      'UPDATE orders SET status=$1, updated_at=NOW() WHERE id=$2 AND company_id=$3',
      [status, req.params.id, req.session.user.company_id]
    );
    if (r.rowCount === 0) return res.json({ ok: false, err: 'Cursa nu a fost gasita' });
    return res.json({ ok: true });
  } catch(err) {
    console.error('quick-status hiba:', err);
    return res.json({ ok: false, err: 'Eroare de server' });
  }
});

// ── Sofőr státusz frissítés + push visszajelzés ───────────
//  POST /api/orders/:id/driver-status
//  Csak Sofőr role — csak 'In Curs' vagy 'Finalizat'
// ============================================================
router.post('/api/orders/:id/driver-status', requireLogin, requireRole('Sofer'), async (req, res) => {
  const { status } = req.body;
  const driver = req.session.user;
  if (!['In Curs', 'Finalizat'].includes(status)) {
    return res.json({ ok: false, err: 'Status invalid' });
  }
  try {
    const check = await pool.query(
      `SELECT id, client FROM orders
       WHERE id = $1 AND company_id = $2 AND LOWER(email_sofer) = LOWER($3)`,
      [req.params.id, driver.company_id, driver.email]
    );
    if (!check.rows.length) {
      return res.json({ ok: false, err: 'Nu a fost gasit sau nu aveti permisiune' });
    }
    await pool.query(
      'UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2',
      [status, req.params.id]
    );
    // Push értesítés a Manager / Admin szerepkörűeknek
    const label = status === 'In Curs' ? 'a acceptat / elfogadta' : 'a finalizat / teljesítette';
    const clientName = check.rows[0].client || ('#' + req.params.id);
    await sendPushToRole(driver.company_id, ['Manager', 'Admin'], {
      title: '🚛 Status cursă actualizat / Fuvar státusz frissítve',
      body: (driver.nume || driver.email) + ' ' + label + ': ' + clientName,
      icon: '/icon192.png',
      badge: '/icon192.png',
      tag: 'order-status-' + req.params.id,
      url: '/manager',
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error('driver-status hiba:', err);
    return res.json({ ok: false, err: 'Eroare de server' });
  }
});

module.exports = router;
