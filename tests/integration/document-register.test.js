// ============================================================
//  Dokumentum-nyilvántartás (Registru documente) — RPC tesztek
//
//  Handlerek: docRegGroupList/Save/Delete, docRegEntryList/Create/
//  Update/Delete, docRegEntryAddFiles/Files, docRegFileGet/Delete,
//  docRegSearch. Szerep-kapu (Admin/Manager), multi-tenant szűrés,
//  sorszám-kiadás (tranzakció), foglalt vs. dokumentumos státusz.
// ============================================================
jest.mock('../../db', () => require('../helpers/db-mock').pool);

const request = require('supertest');
const express = require('express');
const { pool, rows, reset } = require('../helpers/db-mock');
const { setUser, sessionMiddleware, fixtures } = require('../helpers/session-mock');

const app = express();
app.use(express.json({ limit: '4mb' }));
app.use(sessionMiddleware);
app.use(require('../../routes/execute'));

function call(fn, args) {
  return request(app).post('/api/execute').send({ functionName: fn, arguments: args });
}

const CID = 1;
const ADMIN = { ...fixtures.admin, company_id: CID };
const MANAGER = { ...fixtures.manager, company_id: CID };
const SOFER = { ...fixtures.sofer, company_id: CID };

beforeEach(() => reset());

// ─── Szerep-kapu ─────────────────────────────────────────────
describe('szerep-kapu', () => {
  test('Sofer nem éri el a csoport-listát', async () => {
    setUser(SOFER);
    const res = await call('docRegGroupList', []);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/interzis/i);
  });
  test('session nélkül 401', async () => {
    setUser(null);
    const res = await call('docRegGroupList', []);
    expect(res.status).toBe(401);
  });
  test('Manager elérheti', async () => {
    setUser(MANAGER);
    pool.query.mockResolvedValueOnce(rows([]));
    const res = await call('docRegGroupList', []);
    expect(res.body.result.ok).toBe(true);
  });
});

// ─── docRegGroupList — tenant ────────────────────────────────
describe('docRegGroupList', () => {
  test('company_id az első SQL-paraméter', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([{ id: 1, name: 'Facturi' }]));
    const res = await call('docRegGroupList', []);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.groups).toHaveLength(1);
    expect(pool.query.mock.calls[0][1][0]).toBe(CID);
  });
});

// ─── docRegGroupSave — validáció ─────────────────────────────
describe('docRegGroupSave', () => {
  test('üres név elutasít', async () => {
    setUser(ADMIN);
    const res = await call('docRegGroupSave', [{ name: '   ' }]);
    expect(res.body.result.ok).toBe(false);
  });
  test('duplikált név elutasít (nincs INSERT)', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([{ '?column?': 1 }])); // dup SELECT → van
    const res = await call('docRegGroupSave', [{ name: 'Facturi' }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/deja/i);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
  test('új csoport: prefix nagybetűsít + INSERT, company_id kötve', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce(rows([]))            // dup SELECT — nincs
      .mockResolvedValueOnce(rows([{ id: 7 }]));  // INSERT RETURNING id
    const res = await call('docRegGroupSave', [{ name: 'Contracte', prefix: 'ctr', pad: 3, year_reset: false }]);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.id).toBe(7);
    const insCall = pool.query.mock.calls[1];
    expect(insCall[0]).toMatch(/INSERT INTO doc_register_groups/i);
    expect(insCall[1][0]).toBe(CID);       // company_id
    expect(insCall[1][2]).toBe('CTR');     // prefix uppercase
    expect(insCall[1][3]).toBe(false);     // year_reset
  });
});

// ─── docRegEntryList — szűrők ────────────────────────────────
describe('docRegEntryList', () => {
  test('hiányzó group_id elutasít', async () => {
    setUser(ADMIN);
    const res = await call('docRegEntryList', [{}]);
    expect(res.body.result.ok).toBe(false);
  });
  test('érvénytelen státusz nem kerül a WHERE-be', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([]));
    await call('docRegEntryList', [{ group_id: 3, status: 'NOPE' }]);
    const [sql, params] = pool.query.mock.calls[0];
    expect(params).toEqual([CID, 3]);
    expect(String(sql)).not.toMatch(/AND e\.status =/i);
  });
  test('érvényes szűrők bekerülnek (status + dátum + keresés)', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([]));
    await call('docRegEntryList', [{ group_id: 3, status: 'with_doc', from: '2026-01-01', to: '2026-12-31', q: 'abc' }]);
    const [sql, params] = pool.query.mock.calls[0];
    expect(params[0]).toBe(CID);
    expect(params).toContain('with_doc');
    expect(params).toContain('2026-01-01');
    expect(params).toContain('%abc%');
    expect(String(sql)).toMatch(/ILIKE/i);
  });
});

// ─── docRegEntryCreate — sorszám-kiadás (tranzakció) ─────────
describe('docRegEntryCreate', () => {
  test('automatikus szám, dokumentum nélkül → foglalt (reserved)', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([{ id: 3, prefix: 'FCT', year_reset: true, pad: 4 }])); // group ownership
    const client = { query: jest.fn(), release: jest.fn() };
    pool.connect = jest.fn().mockResolvedValue(client);
    client.query
      .mockResolvedValueOnce(rows([]))                                  // BEGIN
      .mockResolvedValueOnce(rows([{ current_seq: 1 }]))               // counter INSERT..RETURNING
      .mockResolvedValueOnce(rows([{ id: 55, reg_no: 'FCT-' + new Date().getFullYear() + '-0001', entry_date: '2026-09-17' }])) // INSERT entry
      .mockResolvedValueOnce(rows([]));                                 // COMMIT
    const res = await call('docRegEntryCreate', [{ group_id: 3, title: 'Test' }]);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.id).toBe(55);
    expect(res.body.result.file_count).toBe(0);
    // Az entry INSERT status paramétere 'reserved'
    const entryIns = client.query.mock.calls[2];
    expect(entryIns[0]).toMatch(/INSERT INTO doc_register_entries/i);
    expect(entryIns[1]).toContain('reserved');
    expect(client.query.mock.calls[3][0]).toBe('COMMIT');
  });

  test('dokumentummal → with_doc + fájl-INSERT', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([{ id: 3, prefix: '', year_reset: false, pad: 4 }]));
    const client = { query: jest.fn(), release: jest.fn() };
    pool.connect = jest.fn().mockResolvedValue(client);
    client.query
      .mockResolvedValueOnce(rows([]))                       // BEGIN
      .mockResolvedValueOnce(rows([{ current_seq: 12 }]))    // counter
      .mockResolvedValueOnce(rows([{ id: 60, reg_no: '0012', entry_date: '2026-09-17' }])) // INSERT entry
      .mockResolvedValueOnce(rows([]))                       // INSERT file
      .mockResolvedValueOnce(rows([]));                      // COMMIT
    const res = await call('docRegEntryCreate', [{ group_id: 3, files: [{ file_name: 'a.pdf', base64: 'data:application/pdf;base64,AAAA' }] }]);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.file_count).toBe(1);
    const entryIns = client.query.mock.calls[2];
    expect(entryIns[1]).toContain('with_doc');
    expect(client.query.mock.calls[3][0]).toMatch(/INSERT INTO doc_register_files/i);
  });

  test('idegen/nem létező csoport → elutasít, nincs tranzakció', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([])); // group ownership → 0 sor
    pool.connect = jest.fn();
    const res = await call('docRegEntryCreate', [{ group_id: 999 }]);
    expect(res.body.result.ok).toBe(false);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  test('kézi szám (manual_no) ütközik → ROLLBACK, elutasít', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([{ id: 3, prefix: 'FCT', year_reset: true, pad: 4 }]));
    const client = { query: jest.fn(), release: jest.fn() };
    pool.connect = jest.fn().mockResolvedValue(client);
    client.query
      .mockResolvedValueOnce(rows([]))                    // BEGIN
      .mockResolvedValueOnce(rows([{ '?column?': 1 }]))   // manual dup SELECT → van
      .mockResolvedValueOnce(rows([]));                   // ROLLBACK
    const res = await call('docRegEntryCreate', [{ group_id: 3, manual_no: 'FCT-2026-0007' }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/deja/i);
    expect(client.query.mock.calls[2][0]).toBe('ROLLBACK');
  });
});

// ─── docRegSearch ────────────────────────────────────────────
describe('docRegSearch', () => {
  test('üres kereső → üres lista, nincs SQL', async () => {
    setUser(ADMIN);
    const res = await call('docRegSearch', [{ q: '' }]);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.entries).toEqual([]);
    expect(pool.query).not.toHaveBeenCalled();
  });
  test('keresés company_id-szűrt + ILIKE minta', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([{ id: 1, group_name: 'Facturi', reg_no: 'FCT-2026-0001' }]));
    const res = await call('docRegSearch', [{ q: 'FCT' }]);
    expect(res.body.result.ok).toBe(true);
    const [sql, params] = pool.query.mock.calls[0];
    expect(params[0]).toBe(CID);
    expect(params[1]).toBe('%FCT%');
    expect(String(sql)).toMatch(/ILIKE/i);
  });
});

// ─── docRegFileGet — tenant ──────────────────────────────────
describe('docRegFileGet', () => {
  test('company_id kötve a lekérdezésben', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([{ file_name: 'a.pdf', mime: 'application/pdf', data_base64: 'data:...' }]));
    const res = await call('docRegFileGet', [{ file_id: 9 }]);
    expect(res.body.result.ok).toBe(true);
    expect(pool.query.mock.calls[0][1]).toEqual([9, CID]);
  });
  test('nem található → hiba', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([]));
    const res = await call('docRegFileGet', [{ file_id: 9 }]);
    expect(res.body.result.ok).toBe(false);
  });
});
