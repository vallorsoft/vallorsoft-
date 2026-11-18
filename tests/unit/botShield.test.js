// Bot-/túlterhelés-védelem + keresőmotor-útvonalak
const express = require('express');
const request = require('supertest');

function loadShield(env) {
  let mod;
  const saved = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; process.env[k] = env[k]; }
  jest.isolateModules(() => { mod = require('../../lib/botShield'); });
  for (const k of Object.keys(env)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  return mod;
}

function appWith(shield, sessionUser) {
  const app = express();
  app.use((req, res, next) => { req.session = sessionUser ? { user: sessionUser } : {}; next(); });
  app.use(shield.apiRateLimit);
  app.use(shield.bodyParsers);
  app.post('/api/x', (req, res) => res.json({ ok: true, n: JSON.stringify(req.body).length }));
  app.get('/api/track/:t', (req, res) => res.json({ ok: true }));
  app.use((err, req, res, next) => res.status(err.status || 500).json({ type: err.type }));
  return app;
}

describe('botShield — kérés-törzs', () => {
  const big = { s: 'x'.repeat(300 * 1024) };
  test('névtelen kérés 200 KB fölött 413', async () => {
    const r = await request(appWith(loadShield({ NODE_ENV: 'test' }))).post('/api/x').send(big);
    expect(r.status).toBe(413);
  });
  test('bejelentkezve a nagy törzs átmegy', async () => {
    const r = await request(appWith(loadShield({ NODE_ENV: 'test' }), { id: 1 })).post('/api/x').send(big);
    expect(r.status).toBe(200);
  });
});

describe('botShield — kérés-korlát', () => {
  test('névtelen IP a küszöb fölött 429-et kap', async () => {
    const s = loadShield({ NODE_ENV: 'production', RATE_LIMIT_ANON_PER_MIN: '3' });
    const app = appWith(s);
    for (let i = 0; i < 3; i++) expect((await request(app).post('/api/x').send({})).status).toBe(200);
    const r = await request(app).post('/api/x').send({});
    expect(r.status).toBe(429);
    expect(r.body.message).toMatch(/Prea multe cereri/);
  });
  test('bejelentkezett felhasználó saját (magasabb) kerettel fut', async () => {
    const s = loadShield({ NODE_ENV: 'production', RATE_LIMIT_ANON_PER_MIN: '1', RATE_LIMIT_USER_PER_MIN: '5' });
    const app = appWith(s, { id: 7 });
    for (let i = 0; i < 5; i++) expect((await request(app).post('/api/x').send({})).status).toBe(200);
    expect((await request(app).post('/api/x').send({})).status).toBe(429);
  });
  test('a követő-oldal szigorúbb korlátot kap', async () => {
    const s = loadShield({ NODE_ENV: 'production', RATE_LIMIT_TRACK_PER_MIN: '2' });
    const app = appWith(s);
    expect((await request(app).get('/api/track/a')).status).toBe(200);
    expect((await request(app).get('/api/track/a')).status).toBe(200);
    expect((await request(app).get('/api/track/a')).status).toBe(429);
  });
  test('teszt-módban nincs korlát', async () => {
    const s = loadShield({ NODE_ENV: 'test', RATE_LIMIT_ANON_PER_MIN: '1' });
    const app = appWith(s);
    for (let i = 0; i < 4; i++) expect((await request(app).post('/api/x').send({})).status).toBe(200);
  });
});

describe('botShield — statikus gyorsítótár', () => {
  test('?v= verziózott JS 1 napig, más újraellenőrzéssel', async () => {
    const s = loadShield({ NODE_ENV: 'test' });
    const app = express();
    app.use(s.staticCache);
    app.get('/a.js', (req, res) => res.send('x'));
    app.get('/p', (req, res) => res.send('x'));
    expect((await request(app).get('/a.js?v=1')).headers['cache-control']).toBe('public, max-age=86400');
    expect((await request(app).get('/a.js')).headers['cache-control']).toBe('no-cache');
    expect((await request(app).get('/p')).headers['cache-control']).toBe('no-cache');
  });
});

describe('SEO útvonalak', () => {
  const OLD = { ...process.env };
  afterEach(() => { process.env = { ...OLD }; });
  function seoApp() {
    let r; jest.isolateModules(() => { r = require('../../routes/seo'); });
    const app = express(); app.use(r); return app;
  }
  test('robots.txt: belső felületek tiltva + sitemap az APP_URL-en', async () => {
    process.env.APP_URL = 'https://pelda.ro/';
    const r = await request(seoApp()).get('/robots.txt');
    expect(r.status).toBe(200);
    expect(r.text).toMatch(/Disallow: \/admin/);
    expect(r.text).toMatch(/Disallow: \/api\//);
    expect(r.text).toMatch(/Disallow: \/t\//);
    expect(r.text).toMatch(/Sitemap: https:\/\/pelda\.ro\/sitemap\.xml/);
  });
  test('a landing canonical címe az APP_URL + Google ellenőrző meta', async () => {
    process.env.APP_URL = 'https://pelda.ro';
    process.env.GOOGLE_SITE_VERIFICATION = 'abcDEF123_-xyz';
    const r = await request(seoApp()).get('/');
    expect(r.status).toBe(200);
    expect(r.text).toMatch(/<link rel="canonical" href="https:\/\/pelda\.ro\/">/);
    expect(r.text).toMatch(/og:url" content="https:\/\/pelda\.ro\/"/);
    expect(r.text).toMatch(/google-site-verification" content="abcDEF123_-xyz"/);
  });
  test('hibás ellenőrző kód nem kerül a lapra (nincs HTML-injekció)', async () => {
    process.env.GOOGLE_SITE_VERIFICATION = '"><script>x</script>';
    const r = await request(seoApp()).get('/');
    expect(r.text).not.toMatch(/google-site-verification/);
  });
});
