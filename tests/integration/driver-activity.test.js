// ============================================================
//  🎬 Sofőr-aktivitás — read-only aggregátor tesztek
//  Kapuk: Admin/Manager, Sofer NEM. Cross-tenant védelem: a
//  sofőr a hívó cég users-éhez kell tartozzon. Best-effort
//  fallbackek: az opcionális táblák (UIT/border/bug/documents)
//  hiba esetén üres tömböt adnak, a fő eredmény nem hasal el.
// ============================================================
jest.mock('../../db', () => require('../helpers/db-mock').pool);

const request = require('supertest');
const express = require('express');
const { reset, rows } = require('../helpers/db-mock');
const { setUser, sessionMiddleware, fixtures } = require('../helpers/session-mock');

const app = express();
app.use(express.json());
app.use(sessionMiddleware);
app.use(require('../../routes/execute'));

beforeEach(() => reset());

// ═════════════════════════════════════════════
//  getActivityDrivers — sofőr-lista + KPI
// ═════════════════════════════════════════════
describe('getActivityDrivers', () => {
  test('Sofer → Acces interzis', async () => {
    setUser(fixtures.sofer);
    const res = await request(app).post('/api/execute').send({
      functionName: 'getActivityDrivers', arguments: [{}],
    });
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/interzis/i);
  });

  test('üres cég → üres lista + megadott dátumtartomány', async () => {
    setUser(fixtures.admin);
    const pool = require('../../db');
    pool.query.mockResolvedValueOnce(rows([])); // users SELECT üres
    const res = await request(app).post('/api/execute').send({
      functionName: 'getActivityDrivers',
      arguments: [{ from: '2026-01-01', to: '2026-01-31' }],
    });
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.items).toEqual([]);
    expect(res.body.result.from).toBe('2026-01-01');
    expect(res.body.result.to).toBe('2026-01-31');
  });

  test('két sofőr + KPI összefűzés a 3 aggregátorból', async () => {
    setUser(fixtures.admin);
    const pool = require('../../db');
    pool.query
      // users
      .mockResolvedValueOnce(rows([
        { id: 1, email: 'peto@ceg.hu', nume: 'Peto', tel: '+40...' },
        { id: 2, email: 'ana@ceg.hu',  nume: 'Ana',  tel: null },
      ]))
      // waybills
      .mockResolvedValueOnce(rows([
        { email: 'peto@ceg.hu', waybill_count: 4, km: '1200.5', last_wb_at: '2026-01-20T12:00:00Z' },
      ]))
      // orders
      .mockResolvedValueOnce(rows([
        { email: 'peto@ceg.hu', order_count: 6, last_ms_at: '2026-01-25T10:00:00Z' },
        { email: 'ana@ceg.hu',  order_count: 2, last_ms_at: '2026-01-18T09:00:00Z' },
      ]))
      // documents
      .mockResolvedValueOnce(rows([
        { email: 'peto@ceg.hu', photo_count: 12, last_photo_at: '2026-01-24T08:00:00Z' },
      ]));

    const res = await request(app).post('/api/execute').send({
      functionName: 'getActivityDrivers',
      arguments: [{ from: '2026-01-01', to: '2026-01-31' }],
    });
    expect(res.body.result.ok).toBe(true);
    const items = res.body.result.items;
    expect(items).toHaveLength(2);
    const peto = items.find((x) => x.email === 'peto@ceg.hu');
    expect(peto.waybill_count).toBe(4);
    expect(peto.km).toBe(1200.5);
    expect(peto.order_count).toBe(6);
    expect(peto.photo_count).toBe(12);
    // last_activity_at = max(last_wb=20, last_ms=25, last_photo=24) → 25
    expect(new Date(peto.last_activity_at).toISOString().slice(0, 10)).toBe('2026-01-25');
    const ana = items.find((x) => x.email === 'ana@ceg.hu');
    expect(ana.waybill_count).toBe(0);
    expect(ana.photo_count).toBe(0);
    expect(ana.order_count).toBe(2);
  });

  test('a users lekérdezés company_id-szűrt és Sofer szerep', async () => {
    setUser(fixtures.admin);
    const pool = require('../../db');
    pool.query.mockResolvedValueOnce(rows([]));
    await request(app).post('/api/execute').send({
      functionName: 'getActivityDrivers', arguments: [{}],
    });
    const sql = pool.query.mock.calls[0][0];
    const params = pool.query.mock.calls[0][1];
    expect(sql).toMatch(/FROM users/i);
    expect(sql).toMatch(/company_id = \$1/i);
    expect(sql).toMatch(/pozicio = 'Sofer'/i);
    expect(params[0]).toBe(fixtures.admin.company_id);
  });
});

// ═════════════════════════════════════════════
//  getDriverActivity — timeline aggregátor
// ═════════════════════════════════════════════
describe('getDriverActivity', () => {
  test('Sofer NEM éri el', async () => {
    setUser(fixtures.sofer);
    const res = await request(app).post('/api/execute').send({
      functionName: 'getDriverActivity',
      arguments: [{ email: 'peto@ceg.hu' }],
    });
    expect(res.body.result.ok).toBe(false);
  });

  test('üres email → hiba', async () => {
    setUser(fixtures.admin);
    const res = await request(app).post('/api/execute').send({
      functionName: 'getDriverActivity', arguments: [{}],
    });
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/Selecteaza/i);
  });

  test('cross-tenant védelem: idegen cég sofőrje → elutasítva', async () => {
    setUser(fixtures.admin);
    const pool = require('../../db');
    pool.query.mockResolvedValueOnce(rows([])); // users cross-tenant → 0
    const res = await request(app).post('/api/execute').send({
      functionName: 'getDriverActivity',
      arguments: [{ email: 'kulso@masikceg.hu' }],
    });
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/Soferul/i);
    const sql = pool.query.mock.calls[0][0];
    const params = pool.query.mock.calls[0][1];
    expect(sql).toMatch(/FROM users/i);
    expect(sql).toMatch(/company_id=\$2/i);
    expect(params[1]).toBe(fixtures.admin.company_id);
  });

  test('timeline: milestone + waybill + fuel/purchase + photo + uit + border + bug összefűzve, rendezve DESC', async () => {
    setUser(fixtures.admin);
    const pool = require('../../db');
    // 1) users OK
    pool.query.mockResolvedValueOnce(rows([{ id: 1, email: 'peto@ceg.hu', nume: 'Peto', tel: null }]));
    // 2) orders — 1 fuvar 4 milestone-nal
    pool.query.mockResolvedValueOnce(rows([{
      id: 'CMD-1', fuvar_no: 'CMD-2026-0001', client: 'ABC',
      loc_incarcare: 'Cluj', loc_descarcare: 'Bucuresti',
      data_incarcare: '2026-01-10', data_descarcare: '2026-01-12',
      status: 'Finalizat',
      sosit_incarcare_at:  '2026-01-10T09:00:00Z',
      incarcat_at:         '2026-01-10T11:00:00Z',
      sosit_descarcare_at: '2026-01-12T08:00:00Z',
      descarcat_at:        '2026-01-12T10:00:00Z',
      handover_status: null, handover_at: null, handover_location: null,
    }]));
    // 3) waybills — 1 menetlevél 1 tankolással + 1 vásárlással
    pool.query.mockResolvedValueOnce(rows([{
      id: 'MT-2026-0001', data_completare: '2026-01-13T14:00:00Z',
      erkezes_dt: '2026-01-12T22:00:00Z', indulas_dt: '2026-01-10T05:00:00Z',
      numar_camion: 'B104VLR', numar_remorca: null, total_km: 500,
      alte_mentiuni: null,
      alimentari: [{ loc: 'OMV Cluj', litru: 300, suma: 1500, valuta: 'RON', plata: 'Card', data: '2026-01-11' }],
      achizitii:  [{ loc: 'Kaufland', produs: 'kave', pret: 20, valuta: 'RON', plata: 'Cash', data: '2026-01-11' }],
      puncte: [], order_ids: ['CMD-1'],
    }]));
    // 4) documents — 1 fotó
    pool.query.mockResolvedValueOnce(rows([
      { id: 42, tip: 'POD', file_name: 'pod.jpg', order_id: 'CMD-1', created_at: '2026-01-12T10:30:00Z' },
    ]));
    // 5) order_uit_codes — 1 UIT
    pool.query.mockResolvedValueOnce(rows([
      { id: 7, order_id: 'CMD-1', uit_code: 'ABCD-1234', rendszam: 'B104VLR', source: 'manual', created_at: '2026-01-10T08:30:00Z' },
    ]));
    // 6) border_crossings — 1 ki + 1 be
    pool.query.mockResolvedValueOnce(rows([
      { id: 3, tip: 'Iesire',  tara: 'RO', locatie: 'Nadlac', gps_lat: 46, gps_lng: 21, created_at: '2026-01-10T13:00:00Z' },
      { id: 4, tip: 'Intrare', tara: 'RO', locatie: 'Nadlac', gps_lat: 46, gps_lng: 21, created_at: '2026-01-12T07:00:00Z' },
    ]));
    // 7) bug_reports — 1
    pool.query.mockResolvedValueOnce(rows([
      { id: 9, szoveg: 'Az app fagy', oldal: 'sofer', created_at: '2026-01-11T16:00:00Z' },
    ]));

    const res = await request(app).post('/api/execute').send({
      functionName: 'getDriverActivity',
      arguments: [{ email: 'peto@ceg.hu', from: '2026-01-01', to: '2026-01-31' }],
    });
    expect(res.body.result.ok).toBe(true);
    const events = res.body.result.events;

    // 4 milestone + 1 waybill + 1 fuel + 1 purchase + 1 photo + 1 uit + 2 border + 1 bug = 12
    expect(events.length).toBe(12);
    const counts = res.body.result.counts;
    expect(counts.milestone).toBe(4);
    expect(counts.waybill).toBe(1);
    expect(counts.fuel).toBe(1);
    expect(counts.purchase).toBe(1);
    expect(counts.photo).toBe(1);
    expect(counts.uit).toBe(1);
    expect(counts.border).toBe(2);
    expect(counts.bug).toBe(1);

    // Rendezés DESC — a legelső esemény a legkésőbbi
    for (let i = 1; i < events.length; i++) {
      const a = new Date(events[i - 1].at).getTime();
      const b = new Date(events[i].at).getTime();
      expect(a).toBeGreaterThanOrEqual(b);
    }

    // Fotók külön tömbben, thumb+full URL a /api/doc-download-ról
    const photos = res.body.result.photos;
    expect(photos.length).toBe(1);
    expect(photos[0].full_url).toBe('/api/doc-download/42');
    expect(photos[0].kind).toBe('POD');

    // Fuvar-lista is jön a fejléc-legördülőhöz
    expect(res.body.result.orders.length).toBe(1);
    expect(res.body.result.orders[0].id).toBe('CMD-1');
  });

  test('opcionális táblák hibája (UIT/border/bug/documents) → üres, de ok:true', async () => {
    setUser(fixtures.admin);
    const pool = require('../../db');
    pool.query
      .mockResolvedValueOnce(rows([{ id: 1, email: 'p@ceg.hu', nume: 'P', tel: null }])) // users
      .mockResolvedValueOnce(rows([]))                                  // orders üres
      .mockResolvedValueOnce(rows([]))                                  // waybills üres
      .mockRejectedValueOnce(new Error('documents séma-eltérés'))       // documents dob
      // UIT nem hívódik (orderIds üres) → nincs mock
      .mockRejectedValueOnce(new Error('border_crossings hiba'))        // border dob
      .mockRejectedValueOnce(new Error('bug_reports hiba'));            // bug dob

    const res = await request(app).post('/api/execute').send({
      functionName: 'getDriverActivity',
      arguments: [{ email: 'p@ceg.hu' }],
    });
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.events).toEqual([]);
    expect(res.body.result.photos).toEqual([]);
  });
});
