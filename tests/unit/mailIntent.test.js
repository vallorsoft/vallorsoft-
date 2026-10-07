// lib/mailIntent (determinisztikus szándék-felismerés + tanult sablon) és a
// lib/mailData sofőr-/időszak-szűrője, kártya-lekérdezése, táblázat-módja. DB mockolva.
let mockRows = [];
const mockQuery = jest.fn(async (sql, params) => {
  for (const r of mockRows) if (r.match.test(sql)) return { rows: typeof r.rows === 'function' ? r.rows(sql, params) : r.rows };
  return { rows: [] };
});
jest.mock('../../db', () => ({ query: (...a) => mockQuery(...a) }));

const mi = require('../../lib/mailIntent');
const md = require('../../lib/mailData');

const DRIVERS = [{ email: 'gondos@x.ro', nume: 'Gondos Imre' }, { email: 'peto@x.ro', nume: 'Pető Norbert' }, { email: 'kovi@x.ro', nume: 'Kovács Imre' }];
const NOW = new Date(2026, 9, 7); // 2026-10-07
beforeEach(() => {
  mockQuery.mockClear();
  mockRows = [
    { match: /FROM users WHERE company_id=\$1 AND pozicio='Sofer'/, rows: DRIVERS },
    { match: /FROM vehicles WHERE company_id/, rows: [{ rendszam: 'CV 12 ABC' }] },
  ];
});

describe('mailIntent.parse', () => {
  test('a képernyőképes kérés: sofőr + „kiosztott / még aktív" → driver + active, teljes időszak', async () => {
    const it = await mi.parse(7, 'Gondos imre a sofer es a neki kiosztott es meg aktiv fuvarjat kellene reszletesen elkuldeni', NOW);
    expect(it.driver).toBe('Gondos Imre');
    expect(it.status).toBe('active');
    expect(it.from).toBeNull();
    expect(mi.toQuery(it)).toEqual({ driver: 'Gondos Imre', status: 'active', all: true });
  });
  test('ragozott név („Gondos Imrének") és összes', async () => {
    const it = await mi.parse(7, 'küldd el Gondos Imrének az összes fuvarját', NOW);
    expect(it.driver).toBe('Gondos Imre');
    expect(it.all).toBe(true);
  });
  test('csak keresztnév két sofőrre illik → kérdés (nem találgat)', async () => {
    const it = await mi.parse(7, 'Imre fuvarjai', NOW);
    expect(it.driver).toBeNull();
    expect(it.driver_ambiguous).toEqual(['Gondos Imre', 'Kovács Imre']);
  });
  test('tanult becenév', async () => {
    mockRows.push({ match: /kind='driver_alias'/, rows: [{ key_norm: 'peti', email: 'peto@x.ro' }] });
    const it = await mi.parse(7, 'Peti összes fuvarja', NOW);
    expect(it.driver).toBe('Pető Norbert');
    expect(it.learned_alias).toBe(true);
  });
  test('időszakok: múlt hónap, hónapnév, dátumtartomány, utolsó N nap, idén', async () => {
    expect(await mi.parse(7, 'Gondos fuvarjai a múlt hónapban', NOW)).toMatchObject({ from: '2026-09-01', to: '2026-09-30' });
    expect(await mi.parse(7, 'cursele lui Gondos din martie', NOW)).toMatchObject({ from: '2026-03-01', to: '2026-03-31' });
    expect(await mi.parse(7, 'Gondos fuvarjai 2026-01-05 és 2026-02-10 között', NOW)).toMatchObject({ from: '2026-01-05', to: '2026-02-10' });
    expect(await mi.parse(7, 'Gondos fuvarjai az utolsó 10 napban', NOW)).toMatchObject({ from: '2026-09-27', to: '2026-10-07' });
    expect(await mi.parse(7, 'Gondos idei fuvarjai', NOW)).toMatchObject({ from: '2026-01-01', to: '2026-10-07' });
    expect(await mi.parse(7, 'Gondos novemberi fuvarjai', NOW)).toMatchObject({ from: '2025-11-01', to: '2025-11-30' });
  });
  test('rendszám szóközzel/kisbetűvel is', async () => {
    const it = await mi.parse(7, 'a cv12abc összes fuvarja', NOW);
    expect(it.vehicle).toBe('CV 12 ABC');
  });
  test('nem fuvar-kérés → null', async () => {
    expect(await mi.parse(7, 'írj egy köszönő levelet a Kovács SRL-nek', NOW)).toBeNull();
  });
  test('maradék szavak: töltelék nélkül üres, egyedi utasítással nem üres', async () => {
    expect((await mi.parse(7, 'küldd el Gondos Imrének az összes fuvarját', NOW)).residual).toEqual([]);
    expect((await mi.parse(7, 'küldd el Gondos Imrének az összes fuvarját és kérd a CMR-eket', NOW)).residual.length).toBeGreaterThan(0);
  });
});

describe('tanult sablon', () => {
  test('a név/időszak helyőrzővé válik, és visszatöltéskor behelyettesítődik', () => {
    const it = { driver: 'Gondos Imre', from: '2026-09-01', to: '2026-09-30' };
    const tpl = mi.makeTemplate({ subject: 'Cursele lui Gondos Imre', body: 'Bună ziua Gondos Imre,\n2026-09-01 – 2026-09-30\n{{cards}}', recipient: 'named', recipient_name: 'Gondos Imre' }, it, 'ro');
    expect(tpl.subject).toBe('Cursele lui {{who}}');
    expect(tpl.body).toContain('{{period}}');
    expect(tpl.recipient).toBe('driver');
    const f = mi.fillTemplate(tpl, { driver: 'Pető Norbert' }, 'ro');
    expect(f.subject).toBe('Cursele lui Pető Norbert');
    expect(f.body).toContain('toată perioada');
    expect(f.recipient_name).toBe('Pető Norbert');
    expect(mi.signature({ driver: 'X' }, 'ro')).toBe(mi.signature({ driver: 'Y' }, 'ro'));
  });
  test('konkrét fuvarszámot tartalmazó levél nem lesz sablon', async () => {
    await mi.learnTemplate(7, { subject: 'CMD-2026-0050', body: 'x' }, { driver: 'Gondos Imre' }, 'ro');
    expect(mockQuery.mock.calls.some((c) => /INSERT INTO order_chat_memory/.test(c[0]))).toBe(false);
  });
});

describe('mailData — sofőr-szűrő, teljes időszak, sok fuvar', () => {
  test('sofőr név → e-mail szerinti szűrés, cégre, időszak nélkül, nagy limittel', async () => {
    const b = await md.buildOrderWhere(7, md.sanitizeQuery({ driver: 'gondos imre', status: 'active' }));
    expect(b.p[0]).toBe(7);
    expect(b.p).toContainEqual(['gondos@x.ro']);
    expect(b.p).toContainEqual(['Alocat', 'In Curs', 'Extern']);
    expect(b.w).not.toMatch(/data_incarcare.*>=/);
    expect(b.notes.driver).toBe('Gondos Imre');
  });
  test('fetchData: MINDEN találat jön (nem csak 5), az AI felé összesítő + rövidített lista', async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ id: 'o' + i, fuvar_no: 'CMD-2026-' + String(i + 1).padStart(4, '0'), status: 'Alocat', data_incarcare: '2026-01-' + String((i % 28) + 1).padStart(2, '0'), created_at: new Date() }));
    mockRows.push({ match: /FROM orders o WHERE o.company_id=\$1/, rows: (sql, p) => (p[p.length - 1] >= 60 ? many : many.slice(0, p[p.length - 1])) });
    const r = await md.fetchData(7, md.sanitizeRequests([{ type: 'orders', driver: 'Gondos Imre' }]));
    expect(r.data.orders.length).toBe(60);
    expect(r.data.orders_summary[0]).toMatchObject({ total: 60, card_query: expect.objectContaining({ driver: 'Gondos Imre', all: true }) });
    const j = JSON.parse(r.json);
    expect(j.orders_total).toBe(60);
    expect(j.orders.length).toBeLessThanOrEqual(40);
    expect(r.json).not.toMatch(/gondos@x\.ro/); // e-mail sosem megy az AI-hoz
  });
  test('{query} kártya megmarad, sok fuvar → egyetlen táblázat', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: 'o' + i, fuvar_no: 'CMD-2026-00' + (10 + i), status: 'Alocat', loc_incarcare: 'Arad', loc_descarcare: 'Wien', created_at: new Date() }));
    mockRows.push({ match: /FROM orders o WHERE o.company_id=\$1/, rows: many });
    const cards = md.sanitizeCards([{ query: { driver: 'Gondos Imre' } }]);
    expect(cards[0].query.driver).toBe('Gondos Imre');
    const ex = await md.expandCards(7, cards);
    expect(ex.cards).toEqual(cards);
    const html = await md.renderCards(7, cards, { lang: 'hu' });
    expect((html.match(/<table/g) || []).length).toBe(1);
    expect(html).toContain('CMD-2026-0021');
    expect(html).toContain('Fuvar · 12');
  });
  test('üres szűrő → nem kártya', () => {
    expect(md.sanitizeCards([{ query: {} }])).toEqual([]);
  });
});
