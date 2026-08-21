// ============================================================
//  servicePostpone + serviceComplete — szerviz-esedékesség kezelése
//  A vezérlőpult riasztási sávjából (dashboard) VAGY a szerviz-napló
//  soraiból két új művelet nyílik:
//    1) 🕐 servicePostpone(id, {next_due_date?, next_due_km?, note?})
//       → arrébb tolja az esedékességet, postpone_count++, a régi sor
//         megmarad, a scheduler `last_alert_at=NULL` után újra jelezhet.
//    2) ✅ serviceComplete(id, {service_date, km, items[], cost_ron,
//                              description, category, next_due_*}
//       → tranzakcióban: régit lezárja (closed_at, next_due_* NULL),
//         és új szerviz-sort ír a most elvégzett munkával + saját köv.
//         esedékességgel — a scheduler ettől figyeli tovább.
//  Mind Admin/Manager, cégre szűrt, audit-elt. A Sofer NEM éri el.
// ============================================================
jest.mock('../../db', () => require('../helpers/db-mock').pool);
jest.mock('../../lib/audit', () => ({
  record: jest.fn(),
  fromReq: jest.fn(),
}));

const request = require('supertest');
const express = require('express');
const { reset, rows } = require('../helpers/db-mock');
const { setUser, sessionMiddleware, fixtures } = require('../helpers/session-mock');

const app = express();
app.use(express.json());
app.use(sessionMiddleware);
app.use(require('../../routes/execute'));

beforeEach(() => reset());

// ───────────────────────────────────────────────
//  servicePostpone
// ───────────────────────────────────────────────
describe('servicePostpone', () => {
  test('Sofer → Acces interzis (szerep-kapu)', async () => {
    setUser(fixtures.sofer);
    const res = await request(app).post('/api/execute').send({
      functionName: 'servicePostpone',
      arguments: [42, { next_due_km: 555000 }],
    });
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/interzis/i);
  });

  test('nincs dátum és nincs km → hiba', async () => {
    setUser(fixtures.admin);
    const res = await request(app).post('/api/execute').send({
      functionName: 'servicePostpone',
      arguments: [42, {}],
    });
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/km sau/i);
  });

  test('sikeres halasztás → next_due_km + postpone_count++', async () => {
    setUser(fixtures.admin);
    const pool = require('../../db');
    // Az UPDATE visszaadja az új értékeket (RETURNING)
    pool.query.mockResolvedValueOnce(rows([{
      id: 42, vehicle_id: 7, next_due_date: null, next_due_km: 555000, postpone_count: 2,
    }]));

    const res = await request(app).post('/api/execute').send({
      functionName: 'servicePostpone',
      arguments: [42, { next_due_km: '555000', note: 'alkatresz keses' }],
    });
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.item.postpone_count).toBe(2);

    // Ellenőrzés: a query cégre szűr + a WHERE closed_at IS NULL
    const sql = pool.query.mock.calls[0][0];
    const params = pool.query.mock.calls[0][1];
    expect(sql).toMatch(/UPDATE vehicle_service_log/i);
    expect(sql).toMatch(/WHERE id = \$1 AND company_id = \$2 AND closed_at IS NULL/i);
    expect(sql).toMatch(/last_alert_at = NULL/i);        // scheduler-nek megnyílik
    expect(sql).toMatch(/postpone_count = COALESCE\(postpone_count, 0\) \+ 1/i);
    expect(params[0]).toBe(42);
    expect(params[1]).toBe(fixtures.admin.company_id);
    expect(params[3]).toBe(555000);                       // next_due_km számmá
  });

  test('lezárt/idegen sor → nem talált', async () => {
    setUser(fixtures.admin);
    const pool = require('../../db');
    // UPDATE 0 sort érint (WHERE closed_at IS NULL vagy más cég)
    pool.query.mockResolvedValueOnce(rows([]));

    const res = await request(app).post('/api/execute').send({
      functionName: 'servicePostpone',
      arguments: [42, { next_due_date: '2027-01-01' }],
    });
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/gasit|găsit|închis/i);
  });
});

// ───────────────────────────────────────────────
//  serviceComplete
// ───────────────────────────────────────────────
describe('serviceComplete', () => {
  test('Sofer → Acces interzis', async () => {
    setUser(fixtures.sofer);
    const res = await request(app).post('/api/execute').send({
      functionName: 'serviceComplete',
      arguments: [42, { items: [{ key: 'oil' }] }],
    });
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/interzis/i);
  });

  test('tranzakció: BEGIN → SELECT FOR UPDATE (nem talált) → ROLLBACK', async () => {
    setUser(fixtures.admin);
    const pool = require('../../db');
    // pool.connect visszaad egy client-et, ami query/release-t támogat.
    const client = { query: jest.fn(), release: jest.fn() };
    pool.connect = jest.fn().mockResolvedValue(client);
    client.query
      .mockResolvedValueOnce(rows([]))              // BEGIN
      .mockResolvedValueOnce(rows([]))              // SELECT FOR UPDATE — 0 sor
      .mockResolvedValueOnce(rows([]));             // ROLLBACK

    const res = await request(app).post('/api/execute').send({
      functionName: 'serviceComplete',
      arguments: [42, { items: [] }],
    });
    expect(res.body.result.ok).toBe(false);
    // BEGIN + SELECT + ROLLBACK — az INSERT/UPDATE nem futott le
    expect(client.query.mock.calls[0][0]).toBe('BEGIN');
    expect(client.query.mock.calls[2][0]).toBe('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });

  test('sikeres lezárás → új sor + régi closed_at, tétel-fehérlista alkalmazva', async () => {
    setUser(fixtures.admin);
    const pool = require('../../db');
    const client = { query: jest.fn(), release: jest.fn() };
    pool.connect = jest.fn().mockResolvedValue(client);
    client.query
      .mockResolvedValueOnce(rows([]))                                        // BEGIN
      .mockResolvedValueOnce(rows([{ id: 42, vehicle_id: 7 }]))               // SELECT — létező, nyitott
      .mockResolvedValueOnce(rows([{ id: 99 }]))                              // INSERT új
      .mockResolvedValueOnce(rows([{}]))                                      // UPDATE régi (closed_at)
      .mockResolvedValueOnce(rows([]));                                       // COMMIT

    const res = await request(app).post('/api/execute').send({
      functionName: 'serviceComplete',
      arguments: [42, {
        service_date: '2026-08-21',
        km: '450000',
        cost_ron: '1250.5',
        description: 'olajcsere + szűrők',
        category: 'olajcsere',
        items: [
          { key: 'oil' },
          { key: 'oil_filter' },
          { key: 'invalid_key_ignored' },              // fehérlista dobja
          { key: 'other', note: 'kismunka a fékrendszeren' },
        ],
        next_due_date: '2027-08-21',
        next_due_km: '490000',
      }],
    });
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.closed_id).toBe(42);
    expect(res.body.result.new_id).toBe(99);

    // INSERT-be a fehérlistán levő 3 tétel kerül (oil, oil_filter, other)
    const insertCall = client.query.mock.calls[2];
    expect(insertCall[0]).toMatch(/INSERT INTO vehicle_service_log/i);
    const itemsJson = JSON.parse(insertCall[1][9]);
    expect(itemsJson.map(x => x.key).sort()).toEqual(['oil', 'oil_filter', 'other']);
    const otherEntry = itemsJson.find(x => x.key === 'other');
    expect(otherEntry.note).toBe('kismunka a fékrendszeren');

    // UPDATE régi: next_due_* NULL, closed_at NOW(), closed_by_service_id = új id
    const updateCall = client.query.mock.calls[3];
    expect(updateCall[0]).toMatch(/closed_at = NOW\(\)/i);
    expect(updateCall[0]).toMatch(/next_due_km = NULL/i);
    expect(updateCall[0]).toMatch(/next_due_date = NULL/i);
    expect(updateCall[1][2]).toBe(99);      // closed_by_service_id

    // Végül COMMIT
    expect(client.query.mock.calls[4][0]).toBe('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });

  test('multi-tenant: SELECT WHERE company_id=$2 (idegen cég sora nem érhető el)', async () => {
    setUser(fixtures.admin);   // company_id = 1
    const pool = require('../../db');
    const client = { query: jest.fn(), release: jest.fn() };
    pool.connect = jest.fn().mockResolvedValue(client);
    client.query
      .mockResolvedValueOnce(rows([]))
      .mockResolvedValueOnce(rows([]))      // idegen cégben van a 42 — a WHERE company_id=1 miatt 0
      .mockResolvedValueOnce(rows([]));     // ROLLBACK

    await request(app).post('/api/execute').send({
      functionName: 'serviceComplete',
      arguments: [42, { items: [{ key: 'oil' }] }],
    });
    const selectCall = client.query.mock.calls[1];
    expect(selectCall[0]).toMatch(/WHERE id = \$1 AND company_id = \$2/i);
    expect(selectCall[1]).toEqual([42, 1]);
  });
});

// ───────────────────────────────────────────────
//  serviceList — új mezők visszaadása (items, closed_at, postpone_count)
// ───────────────────────────────────────────────
describe('serviceList — új mezők', () => {
  test('visszaad items + item_keys fehérlistát', async () => {
    setUser(fixtures.admin);
    const pool = require('../../db');
    pool.query.mockResolvedValueOnce(rows([
      { id: 1, vehicle_id: 7, rendszam: 'MT12ABC', items: [{ key: 'oil' }], postpone_count: 0, closed_at: null },
    ]));
    const res = await request(app).post('/api/execute').send({
      functionName: 'serviceList', arguments: [{}],
    });
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.items[0].items[0].key).toBe('oil');
    expect(Array.isArray(res.body.result.item_keys)).toBe(true);
    expect(res.body.result.item_keys).toContain('oil');
    expect(res.body.result.item_keys).toContain('other');
  });
});
