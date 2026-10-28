// Menetlevél-dokumentumok (handlers/waybillDocs.js) — szerep-kapu, tenant-védelem,
// fuvar-kötés csak a menetlevél saját fuvarjaihoz, formátum-validáció, törlés.
jest.mock('../../db', () => require('../helpers/db-mock').pool);
jest.mock('../../lib/audit', () => ({ fromReq: jest.fn(), record: jest.fn() }));

const request = require('supertest');
const express = require('express');
const { pool, rows, reset } = require('../helpers/db-mock');
const { setUser, sessionMiddleware, fixtures } = require('../helpers/session-mock');

const app = express();
app.use(express.json({ limit: '25mb' }));
app.use(sessionMiddleware);
app.use(require('../../routes/execute'));
const call = (fn, args) => request(app).post('/api/execute').send({ functionName: fn, arguments: args });

const ADMIN = { ...fixtures.admin, company_id: 7 };
const SOFER = { ...fixtures.sofer, company_id: 7 };
const PDF = 'data:application/pdf;base64,JVBERi0xLjQK';
const WB = { id: 'FUV-1', numar_fisa: 'MT-2026-0001', file_name: 'x', order_ids: ['CMD-A', 'CMD-B'] };

let txq;
beforeEach(() => {
  reset();
  txq = jest.fn().mockResolvedValue(rows([{ id: 11 }]));
  pool.connect = jest.fn().mockResolvedValue({ query: txq, release: jest.fn() });
});

test('Sofer nem éri el', async () => {
  setUser(SOFER);
  const r = await call('waybillDocList', [{ waybill_id: 'FUV-1' }]);
  expect(r.body.result.ok).toBe(false);
  expect(pool.query).not.toHaveBeenCalled();
});

test('idegen menetlevél: nem található', async () => {
  setUser(ADMIN);
  pool.query.mockResolvedValueOnce(rows([]));
  const r = await call('waybillDocList', [{ waybill_id: 'FUV-X' }]);
  expect(r.body.result.ok).toBe(false);
  expect(pool.query.mock.calls[0][1]).toEqual(['FUV-X', 7]);
});

test('lista: menetlevél + fuvar-dokumentumok + sofőr-feltöltések egyben', async () => {
  setUser(ADMIN);
  pool.query
    .mockResolvedValueOnce(rows([WB]))
    .mockResolvedValueOnce(rows([{ id: 'CMD-B', fuvar_no: 'CMD-2026-0002' }, { id: 'CMD-A', fuvar_no: 'CMD-2026-0001' }]))
    .mockResolvedValueOnce(rows([{ id: 1, doc_type: 'invoice', file_name: 'f.pdf' }]))
    .mockResolvedValueOnce(rows([{ id: 9, order_id: 'CMD-A', file_name: 'pod.jpg', nume_sofer: 'Ion' }]));
  const r = await call('waybillDocList', [{ waybill_id: 'FUV-1' }]);
  expect(r.body.result.ok).toBe(true);
  expect(r.body.result.orders.map(o => o.id)).toEqual(['CMD-A', 'CMD-B']);
  const [sql, vals] = pool.query.mock.calls[2];
  expect(sql).toMatch(/FROM order_documents/);
  expect(sql).toMatch(/waybill_id = \$2 OR od\.order_id = ANY/);
  expect(vals).toEqual([7, 'FUV-1', ['CMD-A', 'CMD-B']]);
  const docs = r.body.result.docs;
  expect(docs.map(d => d.src)).toEqual(['od', 'drv']);
  expect(docs[1]).toMatchObject({ doc_type: 'pod', editable: false, uploaded_by: 'Ion' });
});

test('feltöltés: order_documents-be, bármely típus fuvarhoz köthető, idegen fuvar → NULL', async () => {
  setUser(ADMIN);
  pool.query
    .mockResolvedValueOnce(rows([WB]))
    .mockResolvedValueOnce(rows([{ id: 'CMD-A' }, { id: 'CMD-B' }]));
  const r = await call('waybillDocUpload', [{ waybill_id: 'FUV-1', files: [
    { file_name: 'cmr.pdf', data: PDF, doc_type: 'order_doc', order_id: 'CMD-A' },
    { file_name: 'idegen.pdf', data: PDF, doc_type: 'order_doc', order_id: 'CMD-IDEGEN' },
    { file_name: 'szamla.pdf', data: PDF, doc_type: 'invoice', order_id: 'CMD-B' },
    { file_name: 'x.pdf', data: PDF, doc_type: 'hack' },
  ] }]);
  expect(r.body.result.ok).toBe(true);
  const ins = txq.mock.calls.filter(c => /INSERT INTO order_documents/.test(c[0])).map(c => c[1]);
  expect(ins).toHaveLength(4);
  expect(ins.map(v => v[0])).toEqual(['CMD-A', null, 'CMD-B', null]);
  expect(ins.map(v => v[1])).toEqual(['FUV-1', 'FUV-1', 'FUV-1', 'FUV-1']);
  expect(ins.map(v => v[5])).toEqual([7, 7, 7, 7]);
  expect(ins.map(v => v[6])).toEqual(['order_doc', 'order_doc', 'invoice', 'other']);
});

test('feltöltés: tiltott formátum → semmi nem íródik', async () => {
  setUser(ADMIN);
  pool.query.mockResolvedValueOnce(rows([WB])).mockResolvedValueOnce(rows([]));
  const r = await call('waybillDocUpload', [{ waybill_id: 'FUV-1', files: [
    { file_name: 'ok.pdf', data: PDF, doc_type: 'invoice' },
    { file_name: 'rossz.svg', data: 'data:image/svg+xml;base64,PHN2Zz4=', doc_type: 'other' },
  ] }]);
  expect(r.body.result.ok).toBe(false);
  expect(pool.connect).not.toHaveBeenCalled();
});

test('letöltés: aláírt változat elsőbbsége, prefix nélküli base64 → data URL; sofőr-irat cégre szűrve', async () => {
  setUser(ADMIN);
  pool.query.mockResolvedValueOnce(rows([{ file_name: 'a.pdf', original_base64: 'AAAA', signed_base64: 'SSSS' }]));
  const g = await call('waybillDocGet', [{ id: 5, src: 'od' }]);
  expect(g.body.result.doc.data).toBe('data:application/pdf;base64,SSSS');
  expect(pool.query.mock.calls[0][1]).toEqual([5, 7]);
  pool.query.mockResolvedValueOnce(rows([{ file_name: 'p.jpg', storage_url: 'data:image/jpeg;base64,QQ==' }]));
  const d = await call('waybillDocGet', [{ id: 9, src: 'drv' }]);
  expect(d.body.result.doc.mime).toBe('image/jpeg');
  expect(pool.query.mock.calls[1][0]).toMatch(/FROM documents d/);
  expect(pool.query.mock.calls[1][1]).toEqual([9, 7]);
});

test('törlés: csak a menetlevélhez tartozó dokumentum', async () => {
  setUser(ADMIN);
  pool.query
    .mockResolvedValueOnce(rows([WB]))
    .mockResolvedValueOnce(rows([{ id: 'CMD-A' }]))
    .mockResolvedValueOnce(rows([]));
  const d = await call('waybillDocDelete', [{ waybill_id: 'FUV-1', id: 6 }]);
  expect(d.body.result.ok).toBe(false);
  expect(pool.query.mock.calls[2][1]).toEqual([6, 7, 'FUV-1', ['CMD-A']]);
  expect(pool.query).toHaveBeenCalledTimes(3);
});

test('módosítás: más fuvarhoz nem köthető, a menetlevélhez kötve marad', async () => {
  setUser(ADMIN);
  pool.query
    .mockResolvedValueOnce(rows([WB]))
    .mockResolvedValueOnce(rows([{ id: 'CMD-A' }]))
    .mockResolvedValueOnce(rows([{ id: 3, order_id: 'CMD-A', waybill_id: null, note: 'n' }]))
    .mockResolvedValueOnce(rows([]));
  const r = await call('waybillDocUpdate', [{ waybill_id: 'FUV-1', id: 3, doc_type: 'invoice', order_id: 'CMD-Z' }]);
  expect(r.body.result.ok).toBe(true);
  expect(pool.query.mock.calls[3][1]).toEqual([3, 'invoice', null, 'FUV-1', 'n', 7]);
});
