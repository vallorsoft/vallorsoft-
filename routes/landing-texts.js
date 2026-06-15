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
      `SELECT key, value FROM developer_settings WHERE key IN ('landing_content','landing_section_order','landing_section_visibility')`
    );
    const byKey = {};
    r.rows.forEach(row => { byKey[row.key] = row.value; });
    const content = byKey['landing_content'] || {};
    const DEFAULT_ORDER = ['hero','strip','how','features','stats','testimonials','pricing','blog','contact','cta'];
    const sectionOrder = byKey['landing_section_order'] || DEFAULT_ORDER;
    const sectionVisibility = byKey['landing_section_visibility'] || {};
    return res.json({ ro: content.ro || {}, hu: content.hu || {}, sectionOrder, sectionVisibility });
  } catch (err) {
    // Best-effort: hiba esetén üres objektum (a landing az alapértelmezett szövegekkel tölt be)
    return res.json({ ro: {}, hu: {} });
  }
});

module.exports = router;
