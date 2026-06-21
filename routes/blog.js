// VallorSoft — publikus blog API + sitemap
const express = require('express');
const pool = require('../db');
const router = express.Router();

// GET /api/blog/list — publikus: megjelent posztok (legújabb elöl)
router.get('/api/blog/list', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, slug, title_ro, title_hu, excerpt_ro, excerpt_hu,
              meta_desc_ro, meta_desc_hu, cover_image_url, published_at
       FROM blog_posts WHERE is_published=TRUE
       ORDER BY published_at DESC NULLS LAST, created_at DESC`
    );
    return res.json({ ok: true, posts: r.rows });
  } catch (err) {
    console.error('blog/list hiba:', err);
    return res.json({ ok: false, err: 'Eroare de server', posts: [] });
  }
});

// GET /api/blog/:slug — publikus: egyedi poszt slug VAGY legacy numerikus id alapján
router.get('/api/blog/:slug', async (req, res) => {
  const slug = req.params.slug;
  try {
    let row;
    // Backward compat: /api/blog/1, /api/blog/2, /api/blog/3
    const numId = parseInt(slug, 10);
    if (!isNaN(numId) && numId > 0) {
      const r = await pool.query(
        `SELECT * FROM blog_posts WHERE id=$1 AND is_published=TRUE`, [numId]
      );
      row = r.rows[0];
    }
    if (!row) {
      const r = await pool.query(
        `SELECT * FROM blog_posts WHERE slug=$1 AND is_published=TRUE`, [slug]
      );
      row = r.rows[0];
    }
    if (!row) return res.status(404).json({ ok: false, err: 'Nu a fost găsit' });
    return res.json({ ok: true, post: row });
  } catch (err) {
    console.error('blog/:slug hiba:', err);
    return res.status(500).json({ ok: false, err: 'Eroare de server' });
  }
});

// GET /sitemap.xml — SEO sitemap
router.get('/sitemap.xml', async (req, res) => {
  try {
    const base = (process.env.APP_URL || 'https://vallorsoft.ro').replace(/\/$/, '');
    const r = await pool.query(
      `SELECT slug, updated_at, published_at FROM blog_posts WHERE is_published=TRUE ORDER BY published_at DESC`
    );
    const blogUrls = r.rows.map(p => {
      const lastmod = (p.updated_at || p.published_at || new Date()).toISOString().split('T')[0];
      return `  <url><loc>${base}/blog/${p.slug}</loc><lastmod>${lastmod}</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>`;
    }).join('\n');

    const staticUrls = ['/', '/blog', '/register', '/login'].map(path => {
      return `  <url><loc>${base}${path}</loc><changefreq>weekly</changefreq><priority>${path==='/'?'1.0':'0.6'}</priority></url>`;
    }).join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${staticUrls}
${blogUrls}
</urlset>`;
    res.set('Content-Type', 'application/xml');
    res.send(xml);
  } catch (err) {
    console.error('sitemap hiba:', err);
    res.status(500).send('<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
  }
});

module.exports = router;
