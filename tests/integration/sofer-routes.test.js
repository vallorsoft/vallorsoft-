// ============================================================
//  Sofőr-oldali REST route-ok végpont-lefedettsége (mock DB):
//    POST /api/border-cross            (routes/soferApi.js)
//    POST /api/doc-upload              (routes/soferApi.js)
//    GET  /api/doc-download/:id        (routes/soferApi.js)
//    POST /api/orders/:id/driver-status    (routes/ordersRest.js)
//    POST /api/orders/:id/driver-milestone (routes/ordersRest.js)
//  A quick-status route külön suite-ban van (orders-rest.test.js).
// ============================================================
jest.mock('../../db', () => require('../helpers/db-mock').pool);

// A push-modul valós fetch-et indít VAPID-kulcsokkal — a tesztek best-
// effort úton ne buktassák a route-ot. A modul már try/catch-es a
// route-ban, de a mocking így is előnyös (nincs hálózati flakiness).
jest.mock('../../services/push', () => ({
  sendPushToRole: jest.fn(async () => {}),
  sendPushToUser: jest.fn(async () => {})
}));

const request = require('supertest');
const express = require('express');
const { reset, rows, pool } = require('../helpers/db-mock');
const { setUser, sessionMiddleware, fixtures } = require('../helpers/session-mock');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(sessionMiddleware);
app.use(require('../../routes/soferApi'));
app.use(require('../../routes/ordersRest'));

beforeEach(() => { reset(); setUser(null); });

// ================================================================
//  POST /api/border-cross
// ================================================================
describe('POST /api/border-cross', () => {
  test('bejelentkezés nélkül → success:false', async () => {
    const res = await request(app).post('/api/border-cross').send({ tip: 'Iesire', tara: 'RO' });
    expect(res.body).toEqual({ success: false, err: 'Nu sunteti autentificat' });
    expect(pool.query).not.toHaveBeenCalled();
  });
  test('Sofer minden mezővel — INSERT + success:true', async () => {
    setUser(fixtures.sofer);
    pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const res = await request(app).post('/api/border-cross').send({
      tip: 'Iesire', tara: 'RO', locatie: 'Nadlac', gps_lat: '46.11', gps_lng: '20.75'
    });
    expect(res.body).toEqual({ success: true });
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO border_crossings/);
    // email/nume a session-ből — a kliens nem küldheti be
    expect(params[0]).toBe(fixtures.sofer.email);
    expect(params[1]).toBe(fixtures.sofer.nume);
    expect(params[2]).toBe('Iesire');
    expect(params[3]).toBe('RO');
    expect(params[4]).toBe('Nadlac');
    expect(params[5]).toBeCloseTo(46.11, 2);
    expect(params[6]).toBeCloseTo(20.75, 2);
  });
  test('hiányzó tip → default „Iesire" (visszafelé kompatibilis)', async () => {
    setUser(fixtures.sofer);
    pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    await request(app).post('/api/border-cross').send({});
    expect(pool.query.mock.calls[0][1][2]).toBe('Iesire');
  });
  test('DB hiba → success:false, nem 500 (a felület nem törik)', async () => {
    setUser(fixtures.sofer);
    pool.query.mockRejectedValueOnce(new Error('constraint failed'));
    const res = await request(app).post('/api/border-cross').send({ tip: 'Intrare', tara: 'RO' });
    expect(res.body.success).toBe(false);
  });
  test('érvénytelen `tip` (script-injection kísérlet) → az „Iesire" defaultra vág', async () => {
    setUser(fixtures.sofer);
    pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    await request(app).post('/api/border-cross').send({ tip: '<script>alert(1)</script>', tara: 'RO' });
    // A DB-be csak 'Iesire' kerül — nem a beküldött rosszindulatú string
    expect(pool.query.mock.calls[0][1][2]).toBe('Iesire');
  });
  test('érvénytelen gps_lat/lng (NaN, tartományon kívüli) → null', async () => {
    setUser(fixtures.sofer);
    pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    await request(app).post('/api/border-cross').send({
      tip: 'Iesire', tara: 'RO', gps_lat: 'nem-szám', gps_lng: 999
    });
    expect(pool.query.mock.calls[0][1][5]).toBe(null);   // lat
    expect(pool.query.mock.calls[0][1][6]).toBe(null);   // lng (|999| > 180)
  });
  test('túl hosszú tara/locatie → 50/255 karakterre vág', async () => {
    setUser(fixtures.sofer);
    pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const longStr = 'a'.repeat(400);
    await request(app).post('/api/border-cross').send({ tip: 'Iesire', tara: longStr, locatie: longStr });
    expect(pool.query.mock.calls[0][1][3].length).toBe(50);
    expect(pool.query.mock.calls[0][1][4].length).toBe(255);
  });
});

// ================================================================
//  POST /api/doc-upload
// ================================================================
describe('POST /api/doc-upload', () => {
  test('bejelentkezés nélkül → success:false', async () => {
    const res = await request(app).post('/api/doc-upload').send({ base64: 'x', numeFisier: 'a.jpg' });
    expect(res.body.success).toBe(false);
  });
  test('orderId nélkül: safeOrderId=null, insert lefut', async () => {
    setUser(fixtures.sofer);
    pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [] });  // csak az INSERT
    await request(app).post('/api/doc-upload').send({ base64: 'data:image/jpeg;base64,AAAA', numeFisier: 'cmr.jpg', tip: 'CMR' });
    // Csak 1 hívás: az orderId üres → nincs ownership-check
    expect(pool.query).toHaveBeenCalledTimes(1);
    const params = pool.query.mock.calls[0][1];
    expect(params[5]).toBe(null);            // order_id
    expect(params[6]).toBe(1);               // company_id (fixtures.sofer)
  });
  test('IDEGEN cég fuvar-ID → order_id NULL-ra vág (nincs cross-tenant csatolás)', async () => {
    setUser(fixtures.sofer);
    // Ownership check: az orderId nem tartozik a céghez → üres
    pool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    await request(app).post('/api/doc-upload').send({
      base64: 'data:image/jpeg;base64,AAAA', numeFisier: 'cmr.jpg', tip: 'CMR', orderId: 'CMD-FOREIGN'
    });
    // A második hívás az INSERT — az order_id NULL, NEM a beküldött id
    const insertParams = pool.query.mock.calls[1][1];
    expect(insertParams[5]).toBe(null);
    // Az ownership-check WHERE-je cég-szűrt
    expect(pool.query.mock.calls[0][1]).toEqual(['CMD-FOREIGN', 1]);
  });
  test('SAJÁT cég fuvar-ID → order_id megőrizve', async () => {
    setUser(fixtures.sofer);
    pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'CMD-MINE' }] });
    pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    await request(app).post('/api/doc-upload').send({
      base64: 'x', numeFisier: 'a.jpg', tip: 'POD', orderId: 'CMD-MINE'
    });
    const insertParams = pool.query.mock.calls[1][1];
    expect(insertParams[5]).toBe('CMD-MINE');
  });
  test('DB-hiba → success:false, nem 500', async () => {
    setUser(fixtures.sofer);
    pool.query.mockRejectedValueOnce(new Error('storage_url too large'));
    const res = await request(app).post('/api/doc-upload').send({ base64: 'x', numeFisier: 'a.jpg' });
    expect(res.body.success).toBe(false);
  });
});

// ================================================================
//  GET /api/doc-download/:id
// ================================================================
describe('GET /api/doc-download/:id', () => {
  test('bejelentkezés nélkül → 401', async () => {
    const res = await request(app).get('/api/doc-download/999');
    expect(res.status).toBe(401);
  });
  test('Sofer csak SAJÁT dokumentumot lát: a WHERE tartalmazza az e-mail-szűrőt', async () => {
    setUser(fixtures.sofer);
    pool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const res = await request(app).get('/api/doc-download/999');
    expect(res.status).toBe(404);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/LOWER\(d\.email_sofer\) = \$3/);
    expect(params[2]).toBe(fixtures.sofer.email);
  });
  test('Admin/Manager NEM kap sofer-szűrőt (cégen belül minden dok)', async () => {
    setUser(fixtures.admin);
    pool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    await request(app).get('/api/doc-download/999');
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).not.toMatch(/email_sofer\) = \$3/);
    expect(params.length).toBe(2);      // csak id + company_id
  });
  test('sikeres letöltés — data-URL PDF → inline content-type', async () => {
    setUser(fixtures.admin);
    const b64 = Buffer.from('PDF payload', 'utf8').toString('base64');
    pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [{
      id: 5, file_name: 'cmr.pdf', tip: 'CMR', storage_url: 'data:application/pdf;base64,' + b64
    }]});
    const res = await request(app).get('/api/doc-download/5').buffer(true);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['content-disposition']).toMatch(/inline/);
    expect(res.body.toString('utf8')).toBe('PDF payload');
  });
  test('nyers base64 (data-URL nélkül) → attachment', async () => {
    setUser(fixtures.admin);
    pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [{
      id: 5, file_name: 'raw.bin', tip: 'CMR', storage_url: 'AAAA'
    }]});
    const res = await request(app).get('/api/doc-download/5').buffer(true);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
  });
  test('üres storage_url → 404 Fara continut', async () => {
    setUser(fixtures.admin);
    pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 5, file_name: 'x.jpg', storage_url: null }] });
    const res = await request(app).get('/api/doc-download/5');
    expect(res.status).toBe(404);
  });
});

// ================================================================
//  POST /api/orders/:id/driver-status  (Sofer only, In Curs/Finalizat)
// ================================================================
describe('POST /api/orders/:id/driver-status', () => {
  test('nem-Sofer szerep → 403 (requireRole)', async () => {
    setUser(fixtures.admin);
    const res = await request(app).post('/api/orders/CMD-1/driver-status').send({ status: 'In Curs' });
    expect(res.status).toBe(403);
  });
  test('érvénytelen státusz → ok:false, nem hívja a DB-t', async () => {
    setUser(fixtures.sofer);
    const res = await request(app).post('/api/orders/CMD-1/driver-status').send({ status: 'Bla' });
    expect(res.body).toEqual({ ok: false, err: 'Status invalid' });
    expect(pool.query).not.toHaveBeenCalled();
  });
  test('idegen cég/idegen sofőr fuvar-ID → 404-szerű hibaüzenet', async () => {
    setUser(fixtures.sofer);
    pool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const res = await request(app).post('/api/orders/CMD-1/driver-status').send({ status: 'In Curs' });
    expect(res.body.ok).toBe(false);
    expect(res.body.err).toMatch(/nu aveti permisiune|Nu a fost gasit/);
    // A tulajdon-ellenőrzés WHERE-je: id + company_id + LOWER(email)
    const [sql] = pool.query.mock.calls[0];
    expect(sql).toMatch(/company_id = \$2/);
    expect(sql).toMatch(/LOWER\(email_sofer\) = LOWER\(\$3\)/);
  });
  test('happy path: In Curs → UPDATE + push (mockolva)', async () => {
    setUser(fixtures.sofer);
    pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'CMD-1', client: 'ACME' }] });
    pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [] });   // UPDATE
    const res = await request(app).post('/api/orders/CMD-1/driver-status').send({ status: 'In Curs' });
    expect(res.body.ok).toBe(true);
    expect(pool.query.mock.calls[1][0]).toMatch(/UPDATE orders SET status/);
    expect(pool.query.mock.calls[1][1]).toEqual(['In Curs', 'CMD-1']);
  });
});

// ================================================================
//  POST /api/orders/:id/driver-milestone (4 állomás, sorrendben)
// ================================================================
describe('POST /api/orders/:id/driver-milestone', () => {
  test('nem-Sofer szerep → 403', async () => {
    setUser(fixtures.admin);
    const res = await request(app).post('/api/orders/CMD-1/driver-milestone').send({});
    expect(res.status).toBe(403);
  });
  test('idegen fuvar → hibás, DB tulajdon-ellenőrzés cégre + email-re szűr', async () => {
    setUser(fixtures.sofer);
    pool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const res = await request(app).post('/api/orders/CMD-1/driver-milestone').send({});
    expect(res.body.ok).toBe(false);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/LOWER\(email_sofer\) = LOWER\(\$3\)/);
    expect(params).toEqual(['CMD-1', 1, fixtures.sofer.email]);
  });
  test('lezárt/parkolt/anulált státusz → nem léptet', async () => {
    for (const status of ['Finalizat', 'Anulat', 'Parkolt', 'Raktarban']) {
      pool.query.mockReset();
      setUser(fixtures.sofer);
      pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [{
        id: 'CMD-1', client: 'A', status,
        sosit_incarcare_at: null, incarcat_at: null, sosit_descarcare_at: null, descarcat_at: null
      }]});
      const res = await request(app).post('/api/orders/CMD-1/driver-milestone').send({});
      expect(res.body).toEqual({ ok: false, err: 'Status invalid' });
    }
  });
  test('minden állomás már rögzítve → hibaüzenet, nincs újabb UPDATE', async () => {
    setUser(fixtures.sofer);
    pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [{
      id: 'CMD-1', client: 'A', status: 'In Curs',
      sosit_incarcare_at: '2026-07-01T08:00Z',
      incarcat_at: '2026-07-01T10:00Z',
      sosit_descarcare_at: '2026-07-01T15:00Z',
      descarcat_at: '2026-07-01T17:00Z'
    }]});
    const res = await request(app).post('/api/orders/CMD-1/driver-milestone').send({});
    expect(res.body.ok).toBe(false);
    expect(pool.query).toHaveBeenCalledTimes(1);   // csak a SELECT
  });
  test('1. állomás: Alocat → In Curs, sosit_incarcare_at kap időt', async () => {
    setUser(fixtures.sofer);
    pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [{
      id: 'CMD-1', client: 'ACME', status: 'Alocat',
      sosit_incarcare_at: null, incarcat_at: null, sosit_descarcare_at: null, descarcat_at: null
    }]});
    pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const res = await request(app).post('/api/orders/CMD-1/driver-milestone').send({});
    expect(res.body).toEqual({ ok: true, step: 'arriveLoad', finalized: false });
    const upd = pool.query.mock.calls[1][0];
    expect(upd).toMatch(/sosit_incarcare_at = NOW\(\)/);
    expect(upd).toMatch(/status = 'In Curs'/);
  });
  test('4. állomás (utolsó): descarcat_at + status = Finalizat', async () => {
    setUser(fixtures.sofer);
    pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [{
      id: 'CMD-1', client: 'ACME', status: 'In Curs',
      sosit_incarcare_at: '2026-07-01T08:00Z',
      incarcat_at: '2026-07-01T10:00Z',
      sosit_descarcare_at: '2026-07-01T15:00Z',
      descarcat_at: null
    }]});
    pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const res = await request(app).post('/api/orders/CMD-1/driver-milestone').send({});
    expect(res.body).toEqual({ ok: true, step: 'unloaded', finalized: true });
    const upd = pool.query.mock.calls[1][0];
    expect(upd).toMatch(/descarcat_at = NOW\(\)/);
    expect(upd).toMatch(/status = 'Finalizat'/);
  });
  test('köztes állomás (pl. 2.) → csak az adott oszlop, NINCS státusz-váltás', async () => {
    setUser(fixtures.sofer);
    pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [{
      id: 'CMD-1', client: 'ACME', status: 'In Curs',
      sosit_incarcare_at: '2026-07-01T08:00Z',
      incarcat_at: null, sosit_descarcare_at: null, descarcat_at: null
    }]});
    pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const res = await request(app).post('/api/orders/CMD-1/driver-milestone').send({});
    expect(res.body).toEqual({ ok: true, step: 'loaded', finalized: false });
    const upd = pool.query.mock.calls[1][0];
    expect(upd).toMatch(/incarcat_at = NOW\(\)/);
    expect(upd).not.toMatch(/status =/);   // NINCS státuszváltás közben
  });
  test('idegen státuszból (pl. Extern) nem lép In Curs-ra a MÁSODIK állomásnál', async () => {
    // A státusz-váltás CSAK az 1. állomásnál (Disponibil/Alocat/Extern → In Curs).
    // Ha a fuvar Extern és a 2. állomás következik, státusz marad Extern.
    setUser(fixtures.sofer);
    pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [{
      id: 'CMD-1', client: 'X', status: 'Extern',
      sosit_incarcare_at: '2026-07-01T08:00Z',   // idx=0 kész → idx=1 következik
      incarcat_at: null, sosit_descarcare_at: null, descarcat_at: null
    }]});
    pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const res = await request(app).post('/api/orders/CMD-1/driver-milestone').send({});
    expect(res.body.step).toBe('loaded');
    const upd = pool.query.mock.calls[1][0];
    expect(upd).not.toMatch(/status = 'In Curs'/);
  });
});
