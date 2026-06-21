-- Blog bejegyzések táblája (slug-alapú, Markdown tartalom, kétnyelvű RO+HU)
CREATE TABLE IF NOT EXISTS blog_posts (
  id              SERIAL PRIMARY KEY,
  slug            VARCHAR(200) UNIQUE NOT NULL,
  title_ro        TEXT NOT NULL DEFAULT '',
  title_hu        TEXT NOT NULL DEFAULT '',
  content_ro      TEXT NOT NULL DEFAULT '',
  content_hu      TEXT NOT NULL DEFAULT '',
  excerpt_ro      TEXT NOT NULL DEFAULT '',
  excerpt_hu      TEXT NOT NULL DEFAULT '',
  meta_desc_ro    TEXT NOT NULL DEFAULT '',
  meta_desc_hu    TEXT NOT NULL DEFAULT '',
  cover_image_url TEXT,
  is_published    BOOLEAN NOT NULL DEFAULT FALSE,
  published_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Migráció: 3 meglévő developer_settings poszt → blog_posts
DO $$
DECLARE
  v1 JSONB; v2 JSONB; v3 JSONB;
BEGIN
  SELECT value INTO v1 FROM developer_settings WHERE key='blog_post_1';
  SELECT value INTO v2 FROM developer_settings WHERE key='blog_post_2';
  SELECT value INTO v3 FROM developer_settings WHERE key='blog_post_3';

  INSERT INTO blog_posts(slug, title_ro, title_hu, content_ro, content_hu, is_published, published_at)
  VALUES(
    'digitalizarea-transportului-rutier-in-romania',
    COALESCE((v1->>'title'), 'Digitalizarea transportului rutier în România'),
    COALESCE((v1->>'titleHu'), 'A közúti fuvarozás digitalizálása Romániában'),
    COALESCE((v1->>'content'), ''),
    COALESCE((v1->>'contentHu'), ''),
    (v1 IS NOT NULL AND COALESCE(v1->>'title','') != ''),
    CASE WHEN (v1 IS NOT NULL AND COALESCE(v1->>'title','') != '') THEN NOW() ELSE NULL END
  ) ON CONFLICT (slug) DO NOTHING;

  INSERT INTO blog_posts(slug, title_ro, title_hu, content_ro, content_hu, is_published, published_at)
  VALUES(
    'e-factura-2026-ce-trebuie-sa-stie-transportatorii',
    COALESCE((v2->>'title'), 'e-Factura 2026 — ce trebuie să știe transportatorii'),
    COALESCE((v2->>'titleHu'), 'e-Számla 2026 — amit a fuvarozóknak tudni kell'),
    COALESCE((v2->>'content'), ''),
    COALESCE((v2->>'contentHu'), ''),
    (v2 IS NOT NULL AND COALESCE(v2->>'title','') != ''),
    CASE WHEN (v2 IS NOT NULL AND COALESCE(v2->>'title','') != '') THEN NOW() ELSE NULL END
  ) ON CONFLICT (slug) DO NOTHING;

  INSERT INTO blog_posts(slug, title_ro, title_hu, content_ro, content_hu, is_published, published_at)
  VALUES(
    'codul-uit-si-ro-e-transport-ghid-practic',
    COALESCE((v3->>'title'), 'Codul UIT și RO e-Transport — ghid practic'),
    COALESCE((v3->>'titleHu'), 'UIT-kód és RO e-Transport — gyakorlati útmutató'),
    COALESCE((v3->>'content'), ''),
    COALESCE((v3->>'contentHu'), ''),
    (v3 IS NOT NULL AND COALESCE(v3->>'title','') != ''),
    CASE WHEN (v3 IS NOT NULL AND COALESCE(v3->>'title','') != '') THEN NOW() ELSE NULL END
  ) ON CONFLICT (slug) DO NOTHING;
END $$;
