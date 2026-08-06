// ============================================================
//  fuvarlevel-save auto-Finalizat kiugrás (mock DB)
//  ------------------------------------------------------------
//  Regresszió-őr a 2026-08-06-i „fuvar sofőr-tulajdonos" javításhoz:
//    - Belső sofőrhöz kiosztott fuvarnál (email_sofer NOT NULL, nem
//      Extern) a menetlevél-beküldés CSAK waybilled_at-et állít; a
//      done_at-et NEM (a driver a milestone-gombbal állítja). Auto-
//      Finalizat SEM megy → a fuvar ott marad, ahol volt.
//    - Extern / nincs email_sofer esetén megőrizzük a régi
//      viselkedést: done_at is beállítódik + auto-Finalizat futhat.
//  Így a CMD-MS8NDEHONVF-szerű eset (tervezett lerakó-dátum a
//  menetlevélen, de a driver még nem nyomta meg a lerakás gombot)
//  többé nem eredményez váratlan Finalizat-ot.
// ============================================================
jest.mock('../../db', () => require('../helpers/db-mock').pool);

const request = require('supertest');
const express = require('express');
const { reset, pool } = require('../helpers/db-mock');
const { setUser, sessionMiddleware, fixtures } = require('../helpers/session-mock');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(sessionMiddleware);
app.use(require('../../routes/soferApi'));

beforeEach(() => { reset(); setUser(fixtures.sofer); });

// Közös body — 1 pickup + 1 delivery, mindkettőn dátum a menetlevélen
function _bodyWithPuncte(orderId) {
  return {
    id: 'MT-2026-0001', fileName: 'wb.pdf',
    puncte: [
      { orderId, role: 'loading',   data: '2026-08-01', tip: 'Incarcare', loc: 'Arad' },
      { orderId, role: 'unloading', data: '2026-08-03', tip: 'Descarcare', loc: 'Budapest' },
    ],
    orderIds: [orderId],
    // A többi mező opcionális; INSERT-hez elég ennyi (a mock elfogadja).
    kmInceput: 0, kmSfarsit: 0, cantInceput: 0, cantSfarsit: 0,
    alimentari: [], achizitii: [], tranzite: [],
    indulasDt: '2026-08-01T06:00', erkezesDt: '2026-08-03T20:00',
  };
}

// A mock a valós soferApi.js `fuvarlevel-save` hívási sorrendjét követi:
//  1) INSERT INTO document_series ... RETURNING (auto-doc-számláló)
//  2) SELECT FROM border_crossings (fetchTripCrossings — window)
//  3) SELECT FROM border_crossings (fetchTripCrossings — seed)
//  4) INSERT INTO fuvarlevelek
//  5) Puncte-loop (per orderId × 2 pont: pickup+delivery):
//     - SELECT status,email_sofer FROM orders (csak első puncte-nál, cache)
//     - SELECT id FROM order_stops (fallback)
//     - UPDATE order_stops
//  6) Extern esetében: UPDATE orders SET status='Finalizat'
function _mockCommonPrefix(driverOwned) {
  const status = driverOwned ? 'Alocat' : 'Extern';
  const email  = driverOwned ? fixtures.sofer.email : null;
  pool.query
    .mockResolvedValueOnce({ rowCount: 1, rows: [{ prefix: 'MT', current_seq: 1 }] })  // 1) document_series
    .mockResolvedValueOnce({ rows: [] })                                                // 2) border_crossings window
    .mockResolvedValueOnce({ rows: [] })                                                // 3) border_crossings seed
    .mockResolvedValueOnce({ rowCount: 1, rows: [] })                                   // 4) INSERT fuvarlevelek
    // 5.a) SELECT status,email_sofer FROM orders (1× — a Map cache-eli)
    .mockResolvedValueOnce({ rows: [{ status, email_sofer: email }] });
}

test('belső sofőrhöz kiosztott fuvar: order_stops CSAK waybilled_at-et kap, NEM done_at → auto-Finalizat SQL NEM fut', async () => {
  const body = _bodyWithPuncte('CMD-MS8N');
  _mockCommonPrefix(true);
  pool.query
    // 5.b/pickup) SELECT id FROM order_stops → id=101
    .mockResolvedValueOnce({ rows: [{ id: 101 }] })
    // 5.c/pickup) UPDATE order_stops SET waybilled_at
    .mockResolvedValueOnce({ rowCount: 1, rows: [] })
    // 5.b/delivery) SELECT id → id=102
    .mockResolvedValueOnce({ rows: [{ id: 102 }] })
    // 5.c/delivery) UPDATE order_stops SET waybilled_at
    .mockResolvedValueOnce({ rowCount: 1, rows: [] });
  // 6) Auto-Finalizat: NEM hívódik (externOrders tömb üres), mock nélkül OK.

  const res = await request(app).post('/api/fuvarlevel-save').send(body);
  expect(res.body.success).toBe(true);

  const allSql = pool.query.mock.calls.map(c => c[0]).join('\n');
  // Driver-owned: az UPDATE-ek waybilled_at-et állítanak, NEM done_at-et
  expect(allSql).toMatch(/UPDATE order_stops[\s\S]{0,120}?SET[\s\S]{0,120}?waybilled_at\s*=\s*COALESCE\(waybilled_at/);
  expect(allSql).not.toMatch(/UPDATE order_stops[\s\S]{0,120}?SET[\s\S]{0,120}?done_at\s*=\s*COALESCE\(done_at/);
  // És NINCS „UPDATE orders SET status = 'Finalizat'" hívás
  expect(allSql).not.toMatch(/UPDATE orders SET status = 'Finalizat'/);
});

test('Extern (nincs internal driver): a régi viselkedés marad — done_at + waybilled_at + auto-Finalizat futhat', async () => {
  const body = _bodyWithPuncte('CMD-EXT1');
  _mockCommonPrefix(false);
  pool.query
    .mockResolvedValueOnce({ rows: [{ id: 201 }] })          // pickup stop
    .mockResolvedValueOnce({ rowCount: 1, rows: [] })        // UPDATE done_at + waybilled_at
    .mockResolvedValueOnce({ rows: [{ id: 202 }] })          // delivery stop
    .mockResolvedValueOnce({ rowCount: 1, rows: [] })        // UPDATE done_at + waybilled_at
    .mockResolvedValueOnce({ rowCount: 1, rows: [] });       // 6) UPDATE orders SET status='Finalizat'

  const res = await request(app).post('/api/fuvarlevel-save').send(body);
  expect(res.body.success).toBe(true);

  const allSql = pool.query.mock.calls.map(c => c[0]).join('\n');
  // Extern: az UPDATE tartalmazza a done_at-et is
  expect(allSql).toMatch(/UPDATE order_stops[\s\S]{0,200}?SET[\s\S]{0,200}?done_at\s*=\s*COALESCE\(done_at/);
  // És a záró auto-Finalizat SQL fut
  expect(allSql).toMatch(/UPDATE orders SET status = 'Finalizat'/);
});
