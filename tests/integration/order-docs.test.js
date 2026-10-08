// Fuvar-dokumentumok (handlers/orderDocs.js) — szerep-kapu, tenant-védelem,
// formátum/méret-validáció, kereső-szűrők, átkötés, törlés.
jest.mock('../../db', () => require('../helpers/db-mock').pool);
jest.mock('../../lib/audit', () => ({ fromReq: jest.fn(), record: jest.fn() }));

const request = require('supertest');
const express = require('express');
const { pool, rows, reset } = require('../helpers/db-mock');
const { setUser, sessionMiddleware, fixtures } = require('../helpers/session-mock');
const audit = require('../../lib/audit');

const app = express();
app.use(express.json({ limit: '25mb' }));
app.use(sessionMiddleware);
app.use(require('../../routes/execute'));
const call = (fn, args) => request(app).post('/api/execute').send({ functionName: fn, arguments: args });

const ADMIN = { ...fixtures.admin, company_id: 7 };
const SOFER = { ...fixtures.sofer, company_id: 7 };
const PDF = 'data:application/pdf;base64,JVBERi0xLjQK';

beforeEach(() => { reset(); audit.fromReq.mockClear(); });

test('Sofer nem kereshet', async () => {
  setUser(SOFER);
  const r = await call('orderDocSearch', [{}]);
  expect(r.body.result.ok).toBe(false);
  expect(pool.query).not.toHaveBeenCalled();
});

test('keresés: company_id + dátum + típus + szöveg paraméteresen', async () => {
  setUser(ADMIN);
  pool.query.mockResolvedValueOnce(rows([{ id: 1, file_name: 'f.pdf' }]));
  const r = await call('orderDocSearch', [{ q: "FCT'1%", doc_type: 'invoice', from: '2026-09-01', to: '2026-09-30', order_id: 'CMD-X' }]);
  expect(r.body.result.ok).toBe(true);
  const [sql, vals] = pool.query.mock.calls[0];
  expect(vals[0]).toBe(7);
  expect(vals).toEqual(expect.arrayContaining(['CMD-X', 'invoice', '2026-09-01', '2026-09-30', "%fct'1\\%%"]));
  expect(sql).not.toMatch(/FCT/);
  expect(sql).toMatch(/COALESCE\(od\.doc_date, od\.created_at::date\) >= \$/);
});

test('keresés: ismeretlen típus és rossz dátum figyelmen kívül', async () => {
  setUser(ADMIN);
  pool.query.mockResolvedValueOnce(rows([]));
  await call('orderDocSearch', [{ doc_type: 'hack', from: '2026-9-1' }]);
  expect(pool.query.mock.calls[0][1]).toEqual([7]);
});

test('feltöltés: idegen fuvarhoz nem lehet', async () => {
  setUser(ADMIN);
  pool.query.mockResolvedValueOnce(rows([]));
  const r = await call('orderDocAdd', [{ order_id: 'CMD-B', file_name: 'a.pdf', data: PDF }]);
  expect(r.body.result.ok).toBe(false);
  expect(pool.query).toHaveBeenCalledTimes(1);
  expect(pool.query.mock.calls[0][1]).toEqual(['CMD-B', 7]);
});

test('feltöltés: nem engedett formátum elutasítva', async () => {
  setUser(ADMIN);
  const r = await call('orderDocAdd', [{ order_id: 'CMD-A', file_name: 'x.html', data: 'data:text/html;base64,PGI+' }]);
  expect(r.body.result.ok).toBe(false);
  expect(pool.query).not.toHaveBeenCalled();
});

test('feltöltés: sikeres, típus fehérlistázva, audit', async () => {
  setUser(ADMIN);
  pool.query.mockResolvedValueOnce(rows([{ 1: 1 }])).mockResolvedValueOnce(rows([{ id: 55 }]));
  const r = await call('orderDocAdd', [{ order_id: 'CMD-A', file_name: 'f.pdf', data: PDF, doc_type: 'evil', doc_date: '2026-09-15', ref_no: 'FCT-1' }]);
  expect(r.body.result).toEqual({ ok: true, docId: 55 });
  const vals = pool.query.mock.calls[1][1];
  expect(vals[4]).toBe(7);
  expect(vals[5]).toBe('other');
  expect(vals[6]).toBe('2026-09-15');
  expect(vals[7]).toBe('FCT-1');
  expect(audit.fromReq).toHaveBeenCalledWith(expect.anything(), 'order_doc.upload', 'order', 'CMD-A', expect.any(Object));
});

test('átkötés idegen fuvarra elutasítva', async () => {
  setUser(ADMIN);
  pool.query.mockResolvedValueOnce(rows([{ order_id: 'CMD-A' }])).mockResolvedValueOnce(rows([]));
  const r = await call('orderDocUpdateMeta', [{ id: 3, order_id: 'CMD-B' }]);
  expect(r.body.result.ok).toBe(false);
  expect(pool.query).toHaveBeenCalledTimes(2);
});

test('törlés cégre szűrt', async () => {
  setUser(ADMIN);
  pool.query.mockResolvedValueOnce(rows([]));
  const r = await call('orderDocDelete', [{ id: 3 }]);
  expect(r.body.result.ok).toBe(false);
  expect(pool.query.mock.calls[0][1]).toEqual([3, 7]);
});
