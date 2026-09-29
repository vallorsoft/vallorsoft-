// ============================================================
//  /api/execute registry-őr
//   1) Két handler-modul NE exportáljon azonos nevet (az Object.assign
//      csendben felülírná az egyiket — így maradt holt kód a régi
//      statisztikás getBnrRate).
//   2) A prototípus-lánc nevei (constructor, toString, __proto__…) NEM
//      hívhatók: korábban a "constructor" hívás sosem válaszolt (lógó kérés).
// ============================================================
jest.mock('../../db', () => require('../helpers/db-mock').pool);
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const express = require('express');
const { setUser, sessionMiddleware, fixtures } = require('../helpers/session-mock');

describe('execute registry', () => {
  test('nincs duplikált handler-név a modulok között', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../routes/execute.js'), 'utf8');
    const seen = {};
    for (const m of src.matchAll(/require\('\.\.\/handlers\/([A-Za-z0-9_]+)'\)/g)) {
      const mod = require('../../handlers/' + m[1]);
      for (const k of Object.keys(mod)) (seen[k] = seen[k] || []).push(m[1]);
    }
    const dups = Object.entries(seen).filter(([, v]) => v.length > 1).map(([k, v]) => k + ' ← ' + v.join(','));
    expect(dups).toEqual([]);
  });
});

describe('POST /api/execute — prototípus-nevek', () => {
  const app = express();
  app.use(express.json());
  app.use(sessionMiddleware);
  app.use(require('../../routes/execute'));

  beforeAll(() => setUser(fixtures.admin));
  afterAll(() => setUser(null));

  for (const fn of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
    test(`"${fn}" → ismeretlen funkció, azonnali válasz`, async () => {
      const r = await request(app).post('/api/execute')
        .send({ functionName: fn, arguments: [] }).timeout(3000);
      expect(r.status).toBe(200);
      expect(r.body.result.ok).toBe(false);
      expect(r.body.result.err).toMatch(/Functie necunoscuta/);
    });
  }

  test('nem-string functionName → ismeretlen funkció', async () => {
    const r = await request(app).post('/api/execute').send({ functionName: { a: 1 } }).timeout(3000);
    expect(r.body.result.ok).toBe(false);
  });
});
