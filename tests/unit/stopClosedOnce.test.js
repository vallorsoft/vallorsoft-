// Lezárt fuvar: utólag egyszer ellenőrizzük, utána többet nem keresünk rá
jest.mock('../../db', () => require('../helpers/db-mock').pool);
const { pool, rows, reset } = require('../helpers/db-mock');
const runner = require('../../lib/stopMatchRunner');

describe('pickQueue — lezárt fuvar csak egyszer', () => {
  beforeEach(() => reset());
  async function sql() {
    pool.query.mockResolvedValueOnce(rows([]));
    await runner.pickQueue(10, new Date('2026-11-12T10:00:00Z'));
    return pool.query.mock.calls[0][0];
  }
  test('a lezárt fuvar csak az egyszeri ellenőrzésre vagy kézi újrasorolásra kerül sorba', async () => {
    const s = await sql();
    expect(s).toContain("(o.status <> 'Finalizat' AND (");
    expect(s).toContain("OR (o.status = 'Finalizat' AND (st.requeued = true OR " + runner.CLOSED_ONCE_SQL + '))');
    // a heti újraellenőrzés / részleges újrapróba / gomb-keresés csak nyitott fuvarra
    const open = s.slice(s.indexOf("(o.status <> 'Finalizat'"), s.indexOf("OR (o.status = 'Finalizat'"));
    expect(open).toContain("st.status IN ('partial','no_gps','error')");
    expect(open).toContain(runner.PRESS_DUE_SQL);
  });
  test('a gomb-keresés lezárt fuvarra nem fut', () => {
    expect(runner.PRESS_DUE_SQL).toContain("o.status IN ('Alocat','In Curs')");
    expect(runner.PRESS_DUE_SQL).not.toContain("'Finalizat'");
  });
  test('egyszeri: csak ha erre a lezárásra még nem volt, a lezárás napja után, reggel 5-től', () => {
    const c = runner.CLOSED_ONCE_SQL;
    expect(c).toMatch(/closed_review_at'\)::timestamptz < o\.finalized_at/);
    expect(c).toMatch(/\(\(o\.finalized_at AT TIME ZONE 'UTC'\) AT TIME ZONE 'Europe\/Bucharest'\)::date < \(\$6::timestamptz AT TIME ZONE 'Europe\/Bucharest'\)::date/);
    expect(c).toMatch(/EXTRACT\(HOUR FROM \$6::timestamptz AT TIME ZONE 'Europe\/Bucharest'\) >= 5/);
  });
  test('a sor a fuvar státuszát is visszaadja (az ütemező ebből tudja, hogy lezárt)', async () => {
    expect(await sql()).toMatch(/SELECT o\.id, o\.company_id, o\.status,/);
  });
});

describe('markClosedReviewed', () => {
  beforeEach(() => reset());
  test('beírja az ellenőrzés idejét és leveszi az újrasorolást', async () => {
    pool.query.mockResolvedValueOnce(rows([]));
    await runner.markClosedReviewed('O1');
    const [s, p] = pool.query.mock.calls[0];
    expect(s).toMatch(/SET closed_review_at = NOW\(\), requeued = false WHERE order_id=\$1/);
    expect(p).toEqual(['O1']);
  });
  test('DB-hiba nem dob', async () => {
    pool.query.mockRejectedValueOnce(new Error('x'));
    await expect(runner.markClosedReviewed('O1')).resolves.toBeUndefined();
  });
});
