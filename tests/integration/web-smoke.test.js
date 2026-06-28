// ============================================================
//  Web-smoke — a teljes web-réteg felmountolódik-e, és az oldal-
//  route-ok őr-viselkedése helyes-e (publikus oldalak 200; védett
//  oldalak login nélkül → /login; szerep-eltérés → saját oldalra).
//  DB mockolva (a guard-ágak nem érik el a DB-t). Ez fogja el azt a
//  hibaosztályt, amikor egy route-modul „eltöri" az appot.
// ============================================================
jest.mock('../../db', () => require('../helpers/db-mock').pool);

const request = require('supertest');
const express = require('express');
const { setUser, sessionMiddleware } = require('../helpers/session-mock');

// A server.js-szel azonos route-lista — ha bármelyik modul exportja
// elromlik, az app.use() vagy a require itt elhasal.
const ROUTE_MODULES = [
  'routes/health', 'routes/firebase', 'routes/legal', 'routes/landing-texts',
  'routes/pages', 'routes/auth', 'routes/public-register', 'routes/soferApi',
  'routes/execute', 'routes/push', 'routes/ordersRest', 'routes/clients',
  'routes/cargotrack', 'routes/invoices', 'routes/track', 'routes/portal',
  'routes/carrier-portal', 'routes/accounting', 'routes/uit',
  'routes/inbound-orders', 'routes/client-mail', 'routes/developer-export',
  'routes/blog', 'routes/trial-select', 'routes/subscription-cancel',
];

function buildApp() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use(sessionMiddleware);
  for (const m of ROUTE_MODULES) app.use(require('../../' + m));
  return app;
}

describe('Web-smoke: a teljes route-réteg felmountolódik', () => {
  test('minden route-modul betölthető és app.use-olható hiba nélkül', () => {
    expect(() => buildApp()).not.toThrow();
  });
});

describe('Web-smoke: oldal-route-ok (routes/pages)', () => {
  let app;
  beforeAll(() => { app = buildApp(); });
  beforeEach(() => setUser(null));

  const PUBLIC = ['/', '/login', '/register', '/reset-password', '/subscription'];
  test.each(PUBLIC)('publikus oldal 200: %s', async (p) => {
    const res = await request(app).get(p);
    expect(res.status).toBe(200);
    expect(res.text).toContain('<!DOCTYPE');
  });

  const GUARDED = ['/admin', '/manager', '/sofer', '/developer', '/konyvelo', '/utvonaltervezes', '/email-builder'];
  test.each(GUARDED)('védett oldal login nélkül → /login: %s', async (p) => {
    const res = await request(app).get(p);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  test('Admin user → /admin 200 (HTML)', async () => {
    setUser({ id: 1, email: 'a@x.hu', pozicio: 'Admin', company_id: 1 });
    const res = await request(app).get('/admin');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<!DOCTYPE');
  });

  test('Sofer user → /admin szerep-eltérés → /sofer', async () => {
    setUser({ id: 2, email: 's@x.hu', pozicio: 'Sofer', company_id: 1 });
    const res = await request(app).get('/admin');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/sofer');
  });

  test('bejelentkezett user a /login-on → szerep-oldalára irányít', async () => {
    setUser({ id: 1, email: 'a@x.hu', pozicio: 'Admin', company_id: 1 });
    const res = await request(app).get('/login');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/admin');
  });
});

describe('Web-smoke: health + ismeretlen API', () => {
  let app;
  beforeAll(() => { app = buildApp(); });

  test('GET /healthz → 200', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
