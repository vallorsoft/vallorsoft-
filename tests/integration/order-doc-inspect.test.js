// orderDocInspect — AI nélküli számla-kiolvasás + a fuvar megrendelőjével való összevetés.
jest.mock('../../db', () => require('../helpers/db-mock').pool);
jest.mock('../../services/pdf-extract', () => ({ extractText: jest.fn() }));

const request = require('supertest');
const express = require('express');
const { pool, rows, reset } = require('../helpers/db-mock');
const { setUser, sessionMiddleware, fixtures } = require('../helpers/session-mock');
const pdf = require('../../services/pdf-extract');

const app = express();
app.use(express.json({ limit: '25mb' }));
app.use(sessionMiddleware);
app.use(require('../../routes/execute'));
const call = (args) => request(app).post('/api/execute').send({ functionName: 'orderDocInspect', arguments: [args] });

const ADMIN = { ...fixtures.admin, company_id: 7 };
const PDF = 'data:application/pdf;base64,JVBERi0xLjQK';
const TXT = 'FACTURA VLR 01079\nData emitere: 04.10.2026\nFurnizor\nVALLOR TEAM S.R.L.\nCUI: RO47859317\nClient\nVESNA GC SRL\nCUI: RO25871352';

beforeEach(() => { reset(); pdf.extractText.mockReset(); setUser(ADMIN); });

test('Sofer nem használhatja', async () => {
  setUser({ ...fixtures.sofer, company_id: 7 });
  const r = await call({ data: PDF });
  expect(r.body.result.ok).toBe(false);
  expect(pdf.extractText).not.toHaveBeenCalled();
});

test('nem PDF → supported:false, nincs kiolvasás', async () => {
  const r = await call({ data: 'data:image/jpeg;base64,/9j/' });
  expect(r.body.result).toMatchObject({ ok: true, supported: false });
  expect(pdf.extractText).not.toHaveBeenCalled();
});

test('szkennelt PDF → scanned', async () => {
  pdf.extractText.mockResolvedValue({ text: '', scanned: true });
  const r = await call({ data: PDF });
  expect(r.body.result).toMatchObject({ ok: true, scanned: true });
});

test('egyező CUI → client; a saját cég CUI-ja nem számít vevőnek', async () => {
  pdf.extractText.mockResolvedValue({ text: TXT, scanned: false });
  pool.query.mockResolvedValueOnce(rows([{ cui: 'RO47859317' }]))
    .mockResolvedValueOnce(rows([{ client: 'Vesna', denumire: 'VESNA GC SRL', cui_cif: 'RO25871352' }]));
  const r = await call({ data: PDF, order_id: 'CMD-A' });
  expect(r.body.result).toMatchObject({ invoice_no: 'VLR 01079', date: '2026-10-04', match: 'client' });
  expect(r.body.result.found.cui).toBe('25871352');
  expect(pool.query.mock.calls[1][1]).toEqual(['CMD-A', 7]);
});

test('CUI nélkül név alapján is egyezik', async () => {
  pdf.extractText.mockResolvedValue({ text: TXT, scanned: false });
  pool.query.mockResolvedValueOnce(rows([{ cui: 'RO47859317' }]))
    .mockResolvedValueOnce(rows([{ client: 'S.C. Vesna GC S.R.L.', denumire: null, cui_cif: null }]));
  const r = await call({ data: PDF, order_id: 'CMD-A' });
  expect(r.body.result.match).toBe('client');
});

test('más ügyfél → mismatch', async () => {
  pdf.extractText.mockResolvedValue({ text: TXT, scanned: false });
  pool.query.mockResolvedValueOnce(rows([{ cui: 'RO47859317' }]))
    .mockResolvedValueOnce(rows([{ client: 'BILKA SRL', denumire: 'BILKA SRL', cui_cif: '11111111' }]));
  const r = await call({ data: PDF, order_id: 'CMD-A' });
  expect(r.body.result).toMatchObject({ match: 'mismatch', expected: { name: 'BILKA SRL' }, found: { name: 'VESNA GC SRL', cui: '25871352' } });
});

test('alvállalkozó számlája → carrier', async () => {
  pdf.extractText.mockResolvedValue({ text: TXT, scanned: false });
  pool.query.mockResolvedValueOnce(rows([{ cui: '99' }]))
    .mockResolvedValueOnce(rows([{ client: 'BILKA', denumire: 'BILKA', cui_cif: '1', carrier_nev: 'Vallor Team', carrier_cui: 'RO47859317' }]));
  const r = await call({ data: PDF, order_id: 'CMD-A' });
  expect(r.body.result.match).toBe('carrier');
});

test('idegen fuvar → hiba', async () => {
  pdf.extractText.mockResolvedValue({ text: TXT, scanned: false });
  pool.query.mockResolvedValueOnce(rows([{ cui: 'RO47859317' }])).mockResolvedValueOnce(rows([]));
  const r = await call({ data: PDF, order_id: 'CMD-B' });
  expect(r.body.result.ok).toBe(false);
});
