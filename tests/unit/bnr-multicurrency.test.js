// Valutás bonok: BNR XML (minden valuta) feldolgozás + tétel-átváltás RON-ra.
jest.mock('../../db', () => ({ query: jest.fn(async () => ({ rows: [] })) }));

const bnr = require('../../services/bnr');
const { normalizeCurrency, convertItem } = require('../../lib/itemCurrency');

const XML = `<?xml version="1.0"?><DataSet><Body><Cube date="2026-11-19">
  <Rate currency="EUR">4.9765</Rate><Rate currency="HUF" multiplier="100">1.2450</Rate>
  <Rate currency="USD">4.3010</Rate></Cube>
  <Cube date="2026-11-20"><Rate currency="EUR">4.9780</Rate><Rate multiplier="100" currency="JPY">2.8000</Rate></Cube>
  </Body></DataSet>`;

describe('parseBnrXml', () => {
  test('minden valuta, multiplier-rel osztva, több nap', () => {
    const days = bnr.parseBnrXml(XML);
    expect(days.map((d) => d.date)).toEqual(['2026-11-19', '2026-11-20']);
    expect(days[0].rates.EUR).toBeCloseTo(4.9765, 6);
    expect(days[0].rates.HUF).toBeCloseTo(0.01245, 8);
    expect(days[1].rates.JPY).toBeCloseTo(0.028, 8);
  });
  test('hibás bemenet → üres', () => {
    expect(bnr.parseBnrXml(null)).toEqual([]);
    expect(bnr.parseBnrXml('<x/>')).toEqual([]);
  });
});

describe('normalizeCurrency', () => {
  test.each([
    ['lei', 'RON'], ['€', 'EUR'], ['eur', 'EUR'], ['Ft', 'HUF'], ['zł', 'PLN'],
    ['Kč', 'CZK'], ['лв', 'BGN'], ['£', 'GBP'], ['$', 'USD'], ['sek', 'SEK'],
  ])('%s → %s', (inp, out) => expect(normalizeCurrency(inp)).toBe(out));
  test('értelmetlen → null', () => {
    expect(normalizeCurrency('')).toBeNull();
    expect(normalizeCurrency('ab12')).toBeNull();
  });
});

describe('convertItem', () => {
  afterEach(() => jest.restoreAllMocks());

  test('EUR bon → RON a tétel dátumára, az eredeti megmarad', async () => {
    jest.spyOn(bnr, 'getRateFor').mockResolvedValue({ currency: 'EUR', rate: 4.9765, date: '2026-11-20' });
    const out = await convertItem({ data: '2026-11-21', suma_orig: 100, suma: 100, valuta: 'eur' }, 'suma');
    expect(bnr.getRateFor).toHaveBeenCalledWith('EUR', '2026-11-21');
    expect(out).toMatchObject({ valuta: 'EUR', suma_orig: 100, suma: 497.65, curs_bnr: 4.9765, curs_data: '2026-11-20' });
  });

  test('régi kliens: csak suma + valuta → az összeget eredetinek veszi', async () => {
    jest.spyOn(bnr, 'getRateFor').mockResolvedValue({ currency: 'HUF', rate: 0.01245, date: '2026-11-20' });
    const out = await convertItem({ data: '2026-11-20', pret: 20000, valuta: 'HUF' }, 'pret');
    expect(out.pret_orig).toBe(20000);
    expect(out.pret).toBe(249);
  });

  test('RON tétel → nincs átváltás, régi mezők törölve', async () => {
    const spy = jest.spyOn(bnr, 'getRateFor');
    const out = await convertItem({ suma: 300, valuta: 'RON', curs_bnr: 5 }, 'suma');
    expect(spy).not.toHaveBeenCalled();
    expect(out).toEqual({ suma: 300, valuta: 'RON' });
  });

  test('BNR nem elérhető → a kliens árfolyamát tartja meg', async () => {
    jest.spyOn(bnr, 'getRateFor').mockResolvedValue(null);
    const out = await convertItem({ suma_orig: 10, valuta: 'EUR', curs_bnr: 5 }, 'suma');
    expect(out.suma).toBe(50);
  });

  test('BNR + kliens-árfolyam sincs → curs_lipsa jelölés', async () => {
    jest.spyOn(bnr, 'getRateFor').mockResolvedValue(null);
    const out = await convertItem({ suma: 10, valuta: 'EUR' }, 'suma');
    expect(out.curs_lipsa).toBe(true);
    expect(out.suma_orig).toBe(10);
  });
});

describe('getRateFor', () => {
  test('RON = 1, érvénytelen kód = null', async () => {
    expect((await bnr.getRateFor('RON', '2026-11-20')).rate).toBe(1);
    expect(await bnr.getRateFor('XX', '2026-11-20')).toBeNull();
  });
  test('DB-ből a legutóbbi <= dátum (hétvége → péntek)', async () => {
    const db = require('../../db');
    db.query.mockResolvedValueOnce({ rows: [{ rate: '4.9765', d: '2026-11-13' }] });
    const hit = await bnr.getRateFor('EUR', '2026-11-15');
    expect(hit).toEqual({ currency: 'EUR', rate: 4.9765, date: '2026-11-13' });
    expect(db.query.mock.calls[0][1]).toEqual(['EUR', '2026-11-15']);
  });
});
