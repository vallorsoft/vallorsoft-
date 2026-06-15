// ============================================================
//  VallorSoft — routes/landing-texts.js
//  Publikus GET /api/landing-texts endpoint
//  A developer_settings 'landing_content' kulcsát adja vissza.
//  Auth nem kell — ez nyilvánosan elérhető.
// ============================================================
const express = require('express');
const pool    = require('../db');
const router  = express.Router();

// GET /api/landing-texts — landing marketing szövegek visszaadása (DB override)
router.get('/api/landing-texts', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT value FROM developer_settings WHERE key='landing_content'`
    );
    if (!r.rows.length) {
      return res.json({ ro: {}, hu: {} });
    }
    const val = r.rows[0].value;
    return res.json({
      ro: (val && val.ro) || {},
      hu: (val && val.hu) || {},
    });
  } catch (err) {
    // Best-effort: hiba esetén üres objektum (a landing az alapértelmezett szövegekkel tölt be)
    return res.json({ ro: {}, hu: {} });
  }
});

module.exports = router;
