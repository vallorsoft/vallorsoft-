// ============================================================
//  Sofőr AI-scan pending nyilvántartás (driver_receipt_scans)
//  Ellenőrzések:
//   - scanReceipt sikeres AI után INSERT-eli a pending sort;
//     ha a DB dob (migráció nem futott), a scan-válasz akkor is ok=true.
//   - attachPendingReceipt: pending → attached, waybill_id + attached_at.
//     Cross-tenant: Sofer csak SAJÁT email-jét, Admin/Manager a cégen belül
//     bármelyik pending sort.
//   - deletePendingReceipt: pending → deleted; már-attached sort NEM töröl.
//   - listPendingReceipts: Sofer csak sajátot; Admin/Manager email-param
//     szerint (cégre szűrve).
// ============================================================
jest.mock('../../db', () => require('../helpers/db-mock').pool);
jest.mock('../../lib/audit', () => ({ record: jest.fn(), fromReq: jest.fn() }));
jest.mock('../../lib/featureEnabled', () => ({ featureEnabled: jest.fn().mockResolvedValue(true) }));
jest.mock('../../lib/geminiJson', () => ({
  extractJson: jest.fn(),
}));

const request = require('supertest');
const express = require('express');
const { reset, rows } = require('../helpers/db-mock');
const { setUser, sessionMiddleware, fixtures } = require('../helpers/session-mock');
const { extractJson } = require('../../lib/geminiJson');

const app = express();
app.use(express.json());
app.use(sessionMiddleware);
app.use(require('../../routes/execute'));

const OLD_ENV = process.env.GEMINI_API_KEY;
beforeAll(() => { process.env.GEMINI_API_KEY = 'test-key'; });
afterAll(() => {
  if (OLD_ENV === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = OLD_ENV;
});
beforeEach(() => { reset(); extractJson.mockReset(); });

// ═════════════════════════════════════════════
//  scanReceipt — pending sor INSERT
// ═════════════════════════════════════════════
describe('scanReceipt persistence', () => {
  test('sikeres AI kiolvasás → INSERT pending sor, pending_id visszaadva', async () => {
    setUser(fixtures.sofer);
    extractJson.mockResolvedValueOnce({
      json: { kind: 'fuel', loc: 'OMV Cluj', litru: 300, suma: 1500, valuta: 'RON', plata: 'Card' },
      model: 'gemini-2.0-flash',
    });
    const pool = require('../../db');
    // loadCompanySamples SELECT (few-shot) → üres; utána INSERT
    pool.query
      .mockResolvedValueOnce(rows([]))                       // receipt_scan_samples
      .mockResolvedValueOnce(rows([{ id: 42 }]));            // INSERT driver_receipt_scans
    const res = await request(app).post('/api/execute').send({
      functionName: 'scanReceipt',
      arguments: [{
        mimeType: 'image/jpeg',
        data: 'AAAA', // dummy base64
        thumb_b64: 'data:image/jpeg;base64,QUFB',
      }],
    });
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.pending_id).toBe(42);
    // Az INSERT paraméterei
    const insertSql = pool.query.mock.calls[1][0];
    const insertParams = pool.query.mock.calls[1][1];
    expect(insertSql).toMatch(/INSERT INTO driver_receipt_scans/i);
    expect(insertParams[0]).toBe(fixtures.sofer.company_id);
    expect(insertParams[1]).toBe(fixtures.sofer.email);
    expect(insertParams[2]).toBe('fuel');
    expect(insertParams[4]).toMatch(/QUFB/); // thumbnail benne
  });

  test('pending INSERT hiba (migráció nem futott) → a scan-válasz akkor is ok=true, pending_id null', async () => {
    setUser(fixtures.sofer);
    extractJson.mockResolvedValueOnce({
      json: { kind: 'purchase', loc: 'Kaufland', suma: 20, valuta: 'RON', plata: 'Cash' },
      model: 'gemini-2.0-flash',
    });
    const pool = require('../../db');
    pool.query
      .mockResolvedValueOnce(rows([]))                                 // samples
      .mockRejectedValueOnce(new Error('relation "driver_receipt_scans" does not exist')); // INSERT dob
    const res = await request(app).post('/api/execute').send({
      functionName: 'scanReceipt',
      arguments: [{ mimeType: 'image/jpeg', data: 'AA' }],
    });
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.pending_id).toBe(null);
  });
});

// ═════════════════════════════════════════════
//  attachPendingReceipt
// ═════════════════════════════════════════════
describe('attachPendingReceipt', () => {
  test('Sofer csak SAJÁT pending sort attach-elhet (email-gate a WHERE-ben)', async () => {
    setUser(fixtures.sofer);
    const pool = require('../../db');
    pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 42 }] });
    const res = await request(app).post('/api/execute').send({
      functionName: 'attachPendingReceipt',
      arguments: [{ id: 42, waybill_id: 'MT-2026-0001' }],
    });
    expect(res.body.result.ok).toBe(true);
    const sql = pool.query.mock.calls[0][0];
    const params = pool.query.mock.calls[0][1];
    expect(sql).toMatch(/UPDATE driver_receipt_scans/i);
    expect(sql).toMatch(/status='attached'/i);
    expect(sql).toMatch(/LOWER\(email_sofer\) = LOWER\(\$3\)/i);
    expect(sql).toMatch(/status = 'pending'/i); // csak pending → attached
    expect(params[0]).toBe(42);
    expect(params[1]).toBe(fixtures.sofer.company_id);
    expect(params[2]).toBe(fixtures.sofer.email);
    expect(params[3]).toBe('MT-2026-0001');
  });

  test('Admin/Manager email-gate NÉLKÜL is attach-elhet (cégen belül bármelyiket)', async () => {
    setUser(fixtures.admin);
    const pool = require('../../db');
    pool.query.mockResolvedValueOnce({ rowCount: 1 });
    await request(app).post('/api/execute').send({
      functionName: 'attachPendingReceipt',
      arguments: [{ id: 99 }],
    });
    const sql = pool.query.mock.calls[0][0];
    const params = pool.query.mock.calls[0][1];
    expect(sql).not.toMatch(/LOWER\(email_sofer\)/i);
    expect(params.length).toBe(3); // id, cid, waybill_id
  });

  test('0 sor → "Nu s-a găsit sau nu mai este pending"', async () => {
    setUser(fixtures.sofer);
    const pool = require('../../db');
    pool.query.mockResolvedValueOnce({ rowCount: 0 });
    const res = await request(app).post('/api/execute').send({
      functionName: 'attachPendingReceipt',
      arguments: [{ id: 100 }],
    });
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/pending/i);
  });
});

// ═════════════════════════════════════════════
//  deletePendingReceipt
// ═════════════════════════════════════════════
describe('deletePendingReceipt', () => {
  test('Sofer soft-delete-eli SAJÁT pending sorát; már attached-et NEM tud törölni', async () => {
    setUser(fixtures.sofer);
    const pool = require('../../db');
    pool.query.mockResolvedValueOnce({ rowCount: 1 });
    const res = await request(app).post('/api/execute').send({
      functionName: 'deletePendingReceipt',
      arguments: [{ id: 42 }],
    });
    expect(res.body.result.ok).toBe(true);
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toMatch(/status='deleted'/i);
    expect(sql).toMatch(/status <> 'attached'/i); // már-attached védve
    expect(sql).toMatch(/LOWER\(email_sofer\) = LOWER\(\$3\)/i);
  });

  test('érvénytelen id → hiba, nincs DB-hívás', async () => {
    setUser(fixtures.sofer);
    const pool = require('../../db');
    const res = await request(app).post('/api/execute').send({
      functionName: 'deletePendingReceipt',
      arguments: [{ id: 'abc' }],
    });
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/ID invalid/i);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════
//  listPendingReceipts
// ═════════════════════════════════════════════
describe('listPendingReceipts', () => {
  test('Sofer csak sajátot lát (a saját email-jét kényszerítjük)', async () => {
    setUser(fixtures.sofer);
    const pool = require('../../db');
    pool.query.mockResolvedValueOnce(rows([
      { id: 1, kind: 'fuel', fields: {}, status: 'pending', waybill_id: null,
        scanned_at: '2026-01-01T10:00:00Z', attached_at: null, deleted_at: null, has_thumb: true },
    ]));
    const res = await request(app).post('/api/execute').send({
      functionName: 'listPendingReceipts',
      arguments: [{ email: 'valaki_mas@masikceg.hu' }], // idegen — de a Sofer a sajátjára írja át
    });
    expect(res.body.result.ok).toBe(true);
    const params = pool.query.mock.calls[0][1];
    expect(params[1]).toBe(fixtures.sofer.email); // NEM a payloadból, hanem a sessionből
  });

  test('Admin/Manager email-param → a cég adott sofőre; nincs email → hiba', async () => {
    setUser(fixtures.admin);
    const res = await request(app).post('/api/execute').send({
      functionName: 'listPendingReceipts',
      arguments: [{}],
    });
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/Email/i);
  });

  test('status fehérlista — csak pending|attached|deleted engedélyezett', async () => {
    setUser(fixtures.admin);
    const pool = require('../../db');
    pool.query.mockResolvedValueOnce(rows([]));
    await request(app).post('/api/execute').send({
      functionName: 'listPendingReceipts',
      arguments: [{ email: 'x@ceg.hu', status: ['pending', 'HACKED'] }],
    });
    const params = pool.query.mock.calls[0][1];
    expect(params[2]).toEqual(['pending']); // csak a fehérlistán maradt
  });
});
