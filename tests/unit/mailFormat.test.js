// ============================================================
//  Unit-teszt — lib/mailBody (formázó jelölés), lib/mailStyle (bővített
//  kinézet), lib/mailData (adat-kérések + fuvarkártyák). DB mockolva.
// ============================================================
let mockRows = [];
const mockQuery = jest.fn(async (sql, params) => {
  for (const r of mockRows) if (r.match.test(sql)) return { rows: typeof r.rows === 'function' ? r.rows(sql, params) : r.rows };
  return { rows: [] };
});
jest.mock('../../db', () => ({ query: (...a) => mockQuery(...a) }));

const mb = require('../../lib/mailBody');
const ms = require('../../lib/mailStyle');
const md = require('../../lib/mailData');

beforeEach(() => { mockRows = []; mockQuery.mockClear(); });

describe('mailBody — formázó jelölés', () => {
  test('karakter-formázás + címek + lista + doboz + gomb', () => {
    const h = mb.render('# Cím\n**vastag** *dőlt* __alá__ ~~át~~ [color=#dc2626]piros[/color] [size=large]nagy[/size]\n- a\n- b\n[box color=#16a34a]Benne[/box]\n[btn url=https://x.ro/a?b=1&c=2]Nyit[/btn]');
    expect(h).toContain('font-size:22px');
    expect(h).toContain('<strong>vastag</strong>');
    expect(h).toContain('<em>dőlt</em>');
    expect(h).toContain('<u>alá</u>');
    expect(h).toContain('<s>át</s>');
    expect(h).toContain('color:#dc2626');
    expect(h).toContain('font-size:17px');
    expect(h).toMatch(/<ul[^>]*><li[^>]*>a<\/li><li[^>]*>b<\/li><\/ul>/);
    expect(h).toContain('border:2px solid #16a34a');
    expect(h).toContain('href="https://x.ro/a?b=1&amp;c=2"');
  });
  test('nincs HTML-/URL-injekció', () => {
    const h = mb.render('<img src=x onerror=alert(1)> [x](javascript:alert(1)) [btn url=javascript:x]B[/btn] [color=red;background:url(x)]c[/color]');
    expect(h).not.toMatch(/<img/);
    expect(h).toContain('&lt;img');
    expect(h).not.toMatch(/href="javascript/i);
    expect(h).not.toMatch(/url\(x\)"/);
  });
  test('kártyák a {{cards}} helyére, különben a végére', () => {
    expect(mb.render('A\n{{cards}}\nB', { cardsHtml: '<CARD>' }).indexOf('<CARD>')).toBeLessThan(mb.render('A\n{{cards}}\nB', { cardsHtml: '<CARD>' }).indexOf('B'));
    expect(mb.render('A', { cardsHtml: '<CARD>' })).toMatch(/<CARD>$/);
  });
  test('helykitöltők felismerése (a képernyőképes hiba)', () => {
    expect(mb.findPlaceholders('- Részletek: [Teljes adatok betöltése...]').length).toBe(1);
    expect(mb.findPlaceholders('Kedves {{nev}}!').length).toBe(1);
    expect(mb.findPlaceholders('Tisztelt [Név], …').length).toBe(1);
    expect(mb.findPlaceholders('Rendben, **holnap** 8-kor. {{cards}} [link](https://a.ro)')).toEqual([]);
  });
});

describe('mailStyle — bővített kinézet', () => {
  test('keret, csak cégnév, logó-háttér, betűméret', () => {
    const h = ms.renderStyled('<p>x</p>', { header: 'name', border: '#2563eb', border_width: 'thick', size: 'large' }, { senderName: 'Vallor Team', logoUrl: 'https://a.ro/l.png' });
    expect(h).toContain('border:4px solid #2563eb');
    expect(h).toContain('Vallor Team');
    expect(h).not.toContain('<img');
    expect(h).toContain('font-size:16px');
    const h2 = ms.renderStyled('x', { header: 'logo_name', logo_bg: '#111827' }, { senderName: 'V', logoUrl: 'https://a.ro/l.png' });
    expect(h2).toContain('<img');
    expect(h2).toContain('background:#111827');
  });
  test('ismeretlen értékek kiszűrve', () => {
    expect(ms.sanitizeStyle({ header: 'evil', border: 'red', size: 'huge', radius: 'large' })).toEqual({ radius: 'large' });
  });
});

describe('mailData — adat-kérések + fuvarkártyák', () => {
  const O50 = { id: 'X50', fuvar_no: 'CMD-2026-0050', client: 'Bilka', status: 'Finalizat', loc_incarcare: 'Arad', loc_descarcare: 'München',
    data_incarcare: '2026-05-10', data_descarcare: '2026-05-12', suly_kg: '22000', load_type: 'FTL', rendszam_camion: 'B104VLR', pret: '1800', ref: '<x>' };
  test('csak fehérlistás kérés-típusok, korlátokkal', () => {
    const r = md.sanitizeRequests([{ type: 'orders', latest: 99 }, { type: 'users' }, { type: 'sent_mails', latest: 50 }, { type: 'client' }]);
    expect(r).toEqual([expect.objectContaining({ type: 'orders', latest: 10 }), expect.objectContaining({ type: 'sent_mails', latest: 5 })]);
  });
  test('rövid fuvarszám feloldása („050" → CMD-2026-0050), cégre szűrve', async () => {
    mockRows = [{ match: /~ \$2/, rows: (sql, p) => (p[0] === 7 && p[1] === '-[0-9]{4}-0*50$' ? [O50] : []) }];
    const r = await md.resolveOrderRefs(7, ['050']);
    expect(r.found.map((o) => o.fuvar_no)).toEqual(['CMD-2026-0050']);
    const r2 = await md.resolveOrderRefs(8, ['050']);
    expect(r2.missing).toEqual(['050']);
  });
  test('„2026-049" → év + szám', async () => {
    mockRows = [{ match: /~ \$2/, rows: (sql, p) => (p[1] === '-2026-0*49$' ? [{ ...O50, fuvar_no: 'CMD-2026-0049' }] : []) }];
    expect((await md.resolveOrderRefs(7, ['2026-049'])).found[0].fuvar_no).toBe('CMD-2026-0049');
  });
  test('kártya: adat a DB-ből, escape-elve; az ár csak kérésre', async () => {
    mockRows = [{ match: /UPPER\(o\.id\)=\$2/, rows: [O50] }];
    const h = await md.renderCards(7, [{ ref: 'CMD-2026-0050' }], { lang: 'hu' });
    expect(h).toContain('Arad → München');
    expect(h).toContain('22');
    expect(h).toContain('B104VLR');
    expect(h).not.toContain('EUR');
    const h2 = await md.renderCards(7, [{ ref: 'CMD-2026-0050' }], { lang: 'hu', fields: ['price', 'ref'] });
    expect(h2).toContain('EUR');
    expect(h2).toContain('&lt;x&gt;');
  });
  test('az AI-nak menő adatban nincs e-mail cím', async () => {
    mockRows = [{ match: /FROM mail_sent/, rows: [{ id: 3, subject: 'S', text: 'T', sent_at: 'x', restorable: true }] }];
    const f = await md.fetchData(7, md.sanitizeRequests([{ type: 'sent_mails' }]));
    expect(f.json).not.toMatch(/@/);
    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toMatch(/company_id=\$1/);
    expect(sql).not.toMatch(/to_email,/);
  });
});
