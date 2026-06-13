// routes/clients.js
// Ügyfelek önálló REST végpontok. Mount: app.use(require('./routes/clients'));
const express = require('express');
const pool = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');
const svc = require('../services/clients');

const router = express.Router();
const FIELDS = ['denumire','tip','cui_cif','reg_com','tara','judet','localitate','adresa',
                'email','telefon','iban','banca','default_tva','valuta','nota','payment_term_days'];

router.get('/api/clients', requireLogin, async (req, res) => {
  const q = (req.query.q || '').trim();
  try {
    const params = [req.session.user.company_id];
    let sql = `SELECT * FROM clients WHERE company_id=$1`;
    if (q) { params.push('%' + q + '%'); sql += ` AND (denumire ILIKE $2 OR cui_cif ILIKE $2)`; }
    sql += ` ORDER BY denumire LIMIT 200`;
    res.json({ clients: (await pool.query(sql, params)).rows });
  } catch (e) { console.error('GET /api/clients hiba:', e); res.status(500).json({ error: 'Eroare de server' }); }
});

router.get('/api/clients/anaf', requireLogin, async (req, res) => {
  const cui = (req.query.cui || '').trim();
  if (!cui) return res.status(400).json({ error: 'CUI este obligatoriu.' });
  const validChecksum = svc.validateCui(cui);
  try { res.json({ ...(await svc.anafLookup(cui)), validChecksum }); }
  catch (e) { res.status(502).json({ error: 'ANAF indisponibil: ' + e.message, validChecksum }); }
});

router.get('/api/clients/vies', requireLogin, async (req, res) => {
  try { res.json(await svc.viesCheck(req.query.country, req.query.number)); }
  catch (e) { res.status(502).json({ error: 'VIES indisponibil: ' + e.message }); }
});

router.get('/api/clients/:id', requireLogin, async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM clients WHERE id=$1 AND company_id=$2`,
      [req.params.id, req.session.user.company_id]);
    if (!rows.length) return res.status(404).json({ error: 'Nu a fost gasit.' });
    res.json({ client: rows[0] });
  } catch (e) { console.error('GET /api/clients/:id hiba:', e); res.status(500).json({ error: 'Eroare de server' }); }
});

router.post('/api/clients', requireLogin, requireRole('Admin','Manager'), async (req, res) => {
  const b = req.body || {};
  if (!b.denumire || !b.denumire.trim()) return res.status(400).json({ error: 'Denumirea este obligatorie.' });
  try {
    const vals = FIELDS.map(f => (b[f] === '' ? null : (b[f] ?? null)));
    const complet = !!(b.cui_cif && b.adresa);
    const cols = FIELDS.concat(['complet_facturare','company_id']);
    const ph = cols.map((_, i) => '$' + (i + 1)).join(',');
    const { rows } = await pool.query(
      `INSERT INTO clients (${cols.join(',')}) VALUES (${ph}) RETURNING *`,
      [...vals, complet, req.session.user.company_id]);
    res.json({ client: rows[0] });
  } catch (e) { console.error('POST /api/clients hiba:', e); res.status(500).json({ error: 'Eroare de server' }); }
});

router.put('/api/clients/:id', requireLogin, requireRole('Admin','Manager'), async (req, res) => {
  const b = req.body || {};
  try {
    const sets = FIELDS.map((f, i) => `${f}=$${i + 1}`).join(',');
    const vals = FIELDS.map(f => (b[f] === '' ? null : (b[f] ?? null)));
    const complet = !!(b.cui_cif && b.adresa);
    const { rows } = await pool.query(
      `UPDATE clients SET ${sets}, complet_facturare=$${FIELDS.length + 1}, updated_at=now()
       WHERE id=$${FIELDS.length + 2} AND company_id=$${FIELDS.length + 3} RETURNING *`,
      [...vals, complet, req.params.id, req.session.user.company_id]);
    if (!rows.length) return res.status(404).json({ error: 'Nu a fost gasit.' });
    res.json({ client: rows[0] });
  } catch (e) { console.error('PUT /api/clients/:id hiba:', e); res.status(500).json({ error: 'Eroare de server' }); }
});

router.delete('/api/clients/:id', requireLogin, requireRole('Admin'), async (req, res) => {
  try {
    await pool.query(`DELETE FROM clients WHERE id=$1 AND company_id=$2`,
      [req.params.id, req.session.user.company_id]);
    res.json({ ok: true });
  } catch (e) { console.error('DELETE /api/clients/:id hiba:', e); res.status(500).json({ error: 'Eroare de server' }); }
});

module.exports = router;
