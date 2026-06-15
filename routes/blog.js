// VallorSoft — publikus blog cikk API
const express = require('express');
const pool = require('../db');
const router = express.Router();

// GET /api/blog/:id — publikus blog cikk lekérése (auth nem kell)
router.get('/api/blog/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (![1,2,3].includes(id)) return res.status(404).json({ ok: false, err: 'Nem található' });
  try {
    const r = await pool.query(`SELECT value FROM developer_settings WHERE key=$1`, [`blog_post_${id}`]);
    const val = r.rows[0] ? r.rows[0].value : {};
    return res.json({ ok: true, id, title: val.title||'', content: val.content||'', titleHu: val.titleHu||'', contentHu: val.contentHu||'' });
  } catch (err) {
    return res.json({ ok: false, err: 'Eroare de server' });
  }
});

module.exports = router;
