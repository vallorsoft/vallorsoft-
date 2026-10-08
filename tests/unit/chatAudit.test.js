// A teljes chat-felület átvizsgálásakor talált hibák regresszió-őrei.
jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../lib/routeEstimate', () => ({ estimateRoute: jest.fn(async () => ({ km: 1000, durationSeconds: 36000 })) }));
jest.mock('../../services/bnr', () => ({ fetchBnrEurRon: jest.fn(async () => 5) }));
const pool = require('../../db');
const co = require('../../lib/chatOps');
const mailChat = require('../../handlers/mailChat');

const req = { session: { user: { company_id: 7, id: 1, pozicio: 'Admin', email: 'a@a' } } };
const NOW = new Date(2026, 9, 8);

describe('fuvarszám-felismerés', () => {
  test('a dátum (2026-10-15) nem fuvarszám, a 2026-0042 igen', () => {
    expect(co._refIn('a felrakás 2026-10-15 legyen')).toBe(null);
    expect(co._refIn('a 2026-0042 fuvar')).toBe('2026-0042');
    expect(co._refIn('CMD-2026-0042')).toBe('CMD-2026-0042');
  });
  test('vezető nullás szám és HU ragok', () => {
    expect(co._refIn('0002 hol tart?')).toBe('0002');
    expect(co._refIn('Cine poate duce 0004?')).toBe('0004');
    expect(co._refIn('Mi van a 0003-mal?')).toBe('0003');
  });
  test('ár / telefonszám / óra nem fuvarszám', () => {
    expect(co._refIn('ár 1500 euró')).toBe(null);
    expect(co._refIn('telefon 0740123456')).toBe(null);
    expect(co._refIn('felrakás 08:00')).toBe(null);
    expect(co._refIn('0.5 t')).toBe(null);
  });
});

describe('pénzösszeg és dátum a szövegből', () => {
  test('ezres elválasztó és tizedes', () => {
    const v = (s) => co._moneyIn(s).find((x) => x.cur).v;
    expect(v('A 0001 fizetve 1.500 EUR')).toBe(1500);
    expect(v('ára 1.250,50 EUR legyen')).toBe(1250.5);
    expect(v('1 500 euró')).toBe(1500);
    expect(v('fizetve 1,500.00 eur')).toBe(1500);
    expect(v('fizetve 500€')).toBe(500);
  });
  test('érvénytelen hónap / pénzösszeg nem dátum, a „/" igen', () => {
    expect(co.dateIn('fizetve 1.500 eur', NOW)).toBe(null);
    expect(co.dateIn('12.5 eur', NOW)).toBe(null);
    expect(co.dateIn('31.02', NOW)).toBe(null);
    expect(co.dateIn('15.10', NOW)).toBe('2026-10-15');
    expect(co.dateIn(require('../../lib/mailIntent').fold('15/10'.replace(/(\d)\/(\d)/g, '$1.$2')), NOW)).toBe('2026-10-15');
  });
  test('a fizetés napja nem lesz 2030 a pénzösszegből', () => {
    expect(co.pdOps('A 0001 fizetve 1.500 EUR', NOW, false).payment_received_at).toBe('2026-10-08');
  });
});

describe('e-mail-szándék', () => {
  test('cím-kérdés nem levélírás', () => {
    expect(mailChat.isEmailIntent('Peto e-mail címe?')).toBe(false);
    expect(mailChat.isEmailIntent('care e emailul lui Peto?')).toBe(false);
    expect(mailChat.isEmailIntent('Küldd el Peto e-mail címére a CMR-t')).toBe(true);
    expect(mailChat.isEmailIntent('Küldj e-mailt a VESNA-nak')).toBe(true);
  });
});

describe('chatOps.answer — útválasztás', () => {
  beforeEach(() => { pool.query.mockReset(); pool.query.mockResolvedValue({ rows: [] }); });

  test('köszönés / köszönet / súgó AI nélkül', async () => {
    expect((await co.answer(req, 'Szia', [], 'hu', NOW)).kind).toBe('hello');
    expect((await co.answer(req, 'Mulțumesc!', [], 'ro', NOW)).kind).toBe('thanks');
    const h = await co.answer(req, 'segítség', [], 'hu', NOW);
    expect(h.kind).toBe('help');
    expect(h.reply).not.toMatch(/\d{4}/); // az előzménybe kerülő szövegben nincs példa-fuvarszám
  });

  test('„Hány lezárt fuvar volt ebben a hónapban?" — lista, NEM státusz-váltás az előzmény fuvarjára', async () => {
    pool.query.mockImplementation(async (sql, p) => {
      if (/COUNT\(\*\) OVER/.test(sql)) {
        expect(p[0]).toBe(7);
        expect(sql).toMatch(/o\.company_id = \$1/);
        expect(sql).toMatch(/status = 'Finalizat'/);
        return { rows: [{ id: 'O5', fuvar_no: 'CMD-2026-0005', client: 'VESNA', status: 'Finalizat', total: 1 }] };
      }
      return { rows: [] };
    });
    const r = await co.answer(req, 'Hány lezárt fuvar volt ebben a hónapban?', ['⚡ Dátum-módosítás — #CMD-2026-0004'], 'hu', NOW);
    expect(r.kind).toBe('order_list');
    expect(r.action).toBeUndefined();
    expect(r.html).toContain('OrderChat.openOrder');
  });

  test('kiosztatlan / aktív fuvarok listája cégre szűrve', async () => {
    const seen = [];
    pool.query.mockImplementation(async (sql, p) => { if (/COUNT\(\*\) OVER/.test(sql)) seen.push([sql, p]); return { rows: [] }; });
    expect((await co.answer(req, 'Kiosztatlan fuvarok', [], 'hu', NOW)).kind).toBe('order_list');
    expect((await co.answer(req, 'Câte curse active sunt?', [], 'ro', NOW)).kind).toBe('order_list');
    expect(seen[0][0]).toMatch(/status = 'Disponibil'/);
    expect(seen[1][0]).toMatch(/status = ANY\(\$2\)/);
    seen.forEach(([, p]) => expect(p[0]).toBe(7));
  });

  test('aktív vázlat mellett a fuvarszám nélküli javítás a vázlathoz megy (nem „melyik fuvar?")', async () => {
    for (const s of ['a lerakás holnapra csúszik', 'az ára legyen 1200 EUR', 'zárd le']) {
      expect(await co.answer(req, s, [], 'hu', NOW, { draftActive: true })).toBe(null);
    }
  });

  test('„a 0004 ára 1500 euró" ige nélkül is ár-módosítás', async () => {
    pool.query.mockImplementation(async (sql) => {
      if (/FROM orders o WHERE o\.id = \$1/.test(sql)) return { rows: [{ id: 'O4', fuvar_no: 'CMD-2026-0004', status: 'Disponibil', pret: 1000 }] };
      if (/FROM orders/.test(sql)) return { rows: [{ id: 'O4', fuvar_no: 'CMD-2026-0004' }] };
      return { rows: [] };
    });
    const r = await co.answer(req, 'A 0004 ára 1500 euró', [], 'hu', NOW);
    expect(r.action).toBe('price');
    expect(r.html).toContain('1.500,00 EUR');
  });

  test('árajánlat a megadott EUR/km rátával', async () => {
    const r = await co.answer(req, 'Mennyi lenne Cluj-Napoca - Wien 1.2 euro/km-rel?', [], 'hu', NOW);
    expect(r.kind).toBe('quote');
    expect(r.html).toContain('1.200 EUR');
    expect(r.html).toContain('1.2 EUR/km');
  });
});
