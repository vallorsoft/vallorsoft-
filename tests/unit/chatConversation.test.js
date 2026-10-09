// Beszélgetés-értés: rövid folytatások („és a 0005?", „és Gondos?"), névmások, és az
// AI-nak átadott, tartalom nélküli jelölő a helyben megválaszolt üzenetek helyén.
jest.mock('../../db', () => ({ query: jest.fn() }));
const pool = require('../../db');
const co = require('../../lib/chatOps');

const DRIVERS = [{ email: 'peto@a.t', nume: 'Peto Imre' }, { email: 'gondos@a.t', nume: 'Gondos Kálmán' }];
beforeEach(() => {
  pool.query.mockReset();
  pool.query.mockImplementation(async (sql) => {
    if (/FROM users/.test(sql) && /Sofer/.test(sql)) return { rows: DRIVERS };
    return { rows: [] };
  });
});

describe('folytatás-alak', () => {
  test('rövid kötőszavas / „is" végű üzenet folytatás, a teljes kérdés nem', () => {
    expect(co._isCarryShape('és a 0005?')).toBe(true);
    expect(co._isCarryShape('a 0006-ot is')).toBe(true);
    expect(co._isCarryShape('dar 0002?')).toBe(true);
    expect(co._isCarryShape('si Gondos?')).toBe(true);
    expect(co._isCarryShape('a 0001 ki van fizetve?')).toBe(false);
    expect(co._isCarryShape('holnap Bicske felrakás, Kassa lerakás, full áru, Peto vigye')).toBe(false);
  });
});

describe('carryOver — fuvarszám csere', () => {
  test('kérdés megismétlése új fuvarszámmal', async () => {
    expect(await co.carryOver(7, 'és a 0002?', ['a 0001 ki van fizetve?'])).toBe('a 0002 ki van fizetve?');
    expect(await co.carryOver(7, 'dar 0005?', ['cursa CMD-2026-0001 e plătită?'])).toBe('cursa 0005 e plătită?');
  });
  test('utasítás megismétlése (a végrehajtás továbbra is ✅-re)', async () => {
    expect(await co.carryOver(7, 'a 0003-at is', ['rendeld a 0004-et Petonak'])).toBe('rendeld a 0003-et Petonak');
  });
  test('egymás utáni folytatások ugyanarra a kérdésre épülnek', async () => {
    expect(await co.carryOver(7, 'és a 0006?', ['és a 0005?', 'a 0001 postázva van?'])).toBe('a 0006 postázva van?');
  });
  test('igés folytatás / nincs előzmény / ugyanaz a szám → nem folytatás', async () => {
    expect(await co.carryOver(7, 'és a 0005-öt zárd le', ['a 0001 ki van fizetve?'])).toBe(null);
    expect(await co.carryOver(7, 'és a 0005?', [])).toBe(null);
    expect(await co.carryOver(7, 'és a 0001?', ['a 0001 ki van fizetve?'])).toBe(null);
    expect(await co.carryOver(7, 'és a 0005?', ['Peto hol tart?'])).toBe(null);
  });
});

describe('carryOver — sofőr csere', () => {
  test('a régi név helyére az új kerül', async () => {
    expect(await co.carryOver(7, 'és Gondos?', ['Peto hol tart?'])).toBe('Gondos Kálmán hol tart?');
    expect(await co.carryOver(7, 'si Peto?', ['unde e Gondos?'])).toBe('Peto Imre unde e?');
  });
  test('név nélküli rövid kérdés → az új névvel', async () => {
    expect(await co.carryOver(7, 'si Peto?', ['numărul lui?'])).toBe('Peto Imre numărul lui?');
  });
  test('ugyanaz a sofőr / ismeretlen név → nem folytatás', async () => {
    expect(await co.carryOver(7, 'és Peto?', ['Peto hol tart?'])).toBe(null);
    expect(await co.carryOver(7, 'és Kovács?', ['Peto hol tart?'])).toBe(null);
  });
});

describe('névmás az előzményből', () => {
  test('„add neki a 0004-et" → az előzményben említett sofőr', async () => {
    pool.query.mockImplementation(async (sql) => {
      if (/FROM users/.test(sql) && /Sofer/.test(sql)) return { rows: DRIVERS };
      if (/FROM orders/.test(sql)) return { rows: [{ id: 'O4', fuvar_no: 'CMD-2026-0004', status: 'Disponibil', loc_incarcare: 'Sibiu', loc_descarcare: 'Munchen' }] };
      return { rows: [] };
    });
    const req = { session: { user: { company_id: 7, id: 1, pozicio: 'Admin', email: 'a@a' } } };
    const r = await co.answer(req, 'add neki a 0004-et', ['👤 Gondos Kálmán a CMD-2026-0003 fuvaron van', 'Gondos hol tart?'], 'hu', new Date(2026, 9, 8), {});
    expect(r && r.action).toBe('assign');
    expect(r.html).toMatch(/Gondos Kálmán/);
  });
});

describe('AI-beszélgetés: helyben megválaszolt üzenetek', () => {
  test('a jelölő nem tartalmaz üzenet-szöveget, és a stílus-szabály benne van a promptban', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('../../handlers/orderChat'), 'utf8');
    expect(src).toMatch(/hidden: true, text: ''/);
    expect(src).toMatch(/CONVERSATION STYLE/);
    const mail = fs.readFileSync(require.resolve('../../handlers/mailChat'), 'utf8');
    expect(mail).toMatch(/m\.hidden \? HIDDEN_NOTE/);
  });
});
