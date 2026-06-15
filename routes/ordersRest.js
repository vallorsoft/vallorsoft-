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
  // Ugyanaz a státusz-halmaz, mint a comUpdate-ben (a lista dropdownja
  // Parkolt/Raktarban-t is kínál — különben „Status invalid" hibát adna).
  const valid = ['Disponibil','Alocat','Extern','In Curs','Finalizat','Anulat','Parkolt','Raktarban'];
  if (!valid.includes(status)) return res.json({ ok: false, err: 'Status invalid' });
  try {
    const r = await pool.query(
      'UPDATE orders SET status=$1, updated_at=NOW() WHERE id=$2 AND company_id=$3',
      [status, req.params.id, req.session.user.company_id]
    );
    if (r.rowCount === 0) return res.json({ ok: false, err: 'Cursa nu a fost gasita' });
    // Ha a státusz elhagyja a Raktarban-t, az aktív raktári tétel kiadva —
    // ne ragadjon bent a Raktár fülön (mint a comUpdate-ben).
    if (status !== 'Raktarban') {
      await pool.query(
        `UPDATE warehouse_items SET status='Kiadva', released_at=NOW()
         WHERE company_id=$1 AND order_id=$2 AND status='Raktarban'`,
        [req.session.user.company_id, req.params.id]
      ).catch((e) => console.error('warehouse release hiba:', e));
    }
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
    try {
      const { getTemplate, applyVars } = require('../lib/pushTemplates');
      const stpl = await getTemplate('push_order_status');
      const vars = { sofor: driver.nume || driver.email, label, client: clientName };
      await sendPushToRole(driver.company_id, ['Manager', 'Admin'], {
        title: (stpl.title_ro || '🚛 Status cursă actualizat') + ' / ' + (stpl.title_hu || 'Fuvar státusz frissítve'),
        body: applyVars(stpl.body_ro || '{{sofor}} {{label}}: {{client}}', vars),
        icon: '/icon192.png', badge: '/icon192.png',
        tag: 'order-status-' + req.params.id, url: '/manager',
      });
    } catch (_) {
      await sendPushToRole(driver.company_id, ['Manager', 'Admin'], {
        title: '🚛 Status cursă actualizat / Fuvar státusz frissítve',
        body: (driver.nume || driver.email) + ' ' + label + ': ' + clientName,
        icon: '/icon192.png', badge: '/icon192.png',
        tag: 'order-status-' + req.params.id, url: '/manager',
      });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('driver-status hiba:', err);
    return res.json({ ok: false, err: 'Eroare de server' });
  }
});

module.exports = router;
