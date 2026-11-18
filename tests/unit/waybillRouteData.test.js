// ============================================================
//  Unit-teszt — lib/waybillRouteData.js
//  A menetlevél útvonal-sorai a GPS km-óra állással (a nyomtatvány és a
//  háttér-feltöltés közös forrása) + a tárolandó pillanatkép.
// ============================================================
const { buildWaybillRoute, odoSnapshot } = require('../../lib/waybillRouteData');

const T = (iso) => Math.floor(Date.parse(iso) / 1000);
const track = [
  [T('2026-03-02T05:00:00Z'), 46, 25, 0, 0, 100000],
  [T('2026-03-02T10:00:00Z'), 47.5, 19.0, 0, 0, 100500],
  [T('2026-03-02T10:30:00Z'), 47.5, 19.0, 0, 0, 100500],
  [T('2026-03-02T16:00:00Z'), 46, 25, 0, 0, 101000],
];

function mockPool() {
  return {
    query: jest.fn(async (sql) => {
      if (/FROM order_stops/.test(sql)) {
        return { rows: [{ id: 7, order_id: 'O1', kind: 'delivery', actual_lat: 47.5, actual_lng: 19.0 }] };
      }
      if (/FROM gps_track_days/.test(sql)) return { rows: [{ points_json: JSON.stringify(track) }] };
      return { rows: [] };
    }),
  };
}

test('óra nélküli lerakó a GPS-ből felismert hely koordinátájával kap időt ÉS km-et', async () => {
  const f = {
    numar_camion: 'B 104 VLR', puncte: [
      { tip: 'Plecare', loc: 'Arcus', data: '2026-03-02', time: '07:00' },
      { tip: 'Descarcare', loc: 'Budapest', data: '2026-03-02', stopId: 7 },
      { tip: 'Sosire', loc: 'Arcus', data: '2026-03-02', time: '18:00' },
    ],
  };
  const { routeRows } = await buildWaybillRoute(mockPool(), 1, f);
  expect(routeRows.map((r) => r.km)).toEqual([0, 100500, 0]);   // indulás/érkezés: a fejléc (itt üres → 0)
  expect(f.puncte[1]._lat).toBeUndefined();          // a tárolt sor nem kap segédmezőt
  const snap = odoSnapshot(routeRows);
  expect(snap.found).toBe(3);
  expect(snap.rows[1]).toEqual({ key: 'p1', km: 100500 });
});

test('rendszám nélkül nincs GPS-lekérés, km sincs', async () => {
  const pool = mockPool();
  const { routeRows } = await buildWaybillRoute(pool, 1, { puncte: [{ tip: 'Plecare', loc: 'A', data: '2026-03-02', time: '07:00' }] });
  expect(routeRows[0].km).toBe(0);                     // indulás: a fejléc értéke (üres → 0), nem GPS
  expect(pool.query.mock.calls.some((c) => /gps_track_days/.test(c[0]))).toBe(false);
});

test('indulás / érkezés km-e a sofőr által beírt km_inceput / km_sfarsit (a GPS-t felülírja)', async () => {
  const f = {
    numar_camion: 'B 104 VLR', km_inceput: 99950, km_sfarsit: 101020, puncte: [
      { tip: 'Plecare', loc: 'Arcus', data: '2026-03-02', time: '07:00' },
      { tip: 'Descarcare', loc: 'Budapest', data: '2026-03-02', stopId: 7 },
      { tip: 'Sosire', loc: 'Arcus', data: '2026-03-02', time: '18:00' },
    ],
  };
  const { routeRows } = await buildWaybillRoute(mockPool(), 1, f);
  expect(routeRows.map((r) => r.km)).toEqual([99950, 100500, 101020]);
});

test('sofőri km GPS nélkül is rákerül; üres érték is a fejléccel egyező (0)', async () => {
  const { applyDriverKm, buildRouteRows } = require('../../lib/waybillRows');
  const rows = buildRouteRows([
    { tip: 'Plecare', loc: 'A', data: '2026-03-02' },
    { tip: 'Sosire', loc: 'A', data: '2026-03-03' },
  ], []);
  rows[1].km = 500;
  applyDriverKm(rows, 1200, 0);
  expect(rows[0].km).toBe(1200);
  expect(rows[1].km).toBe(0);           // a GPS-érték sem marad meg — mindig a fejléc értéke
});

test('több Plecare / Sosire: a fejléc km csak a LEGELSŐ Plecare-re és a LEGUTOLSÓ Sosire-re kerül', async () => {
  const f = {
    numar_camion: 'B 104 VLR', km_inceput: 99950, km_sfarsit: 101020, puncte: [
      { tip: 'Sosire', loc: 'Arcus', data: '2026-03-02', time: '18:00' },     // ez a későbbi Sosire
      { tip: 'Plecare', loc: 'Arcus', data: '2026-03-02', time: '10:30' },    // második Plecare
      { tip: 'Sosire', loc: 'Arcus', data: '2026-03-02', time: '10:00' },     // korábbi Sosire
      { tip: 'Plecare', loc: 'Arcus', data: '2026-03-02', time: '05:30' },    // ez a legelső Plecare
    ],
  };
  const { routeRows } = await buildWaybillRoute(mockPool(), 1, f);
  const byTime = Object.fromEntries(routeRows.map((r) => [r.tip + ' ' + r.time, r.km]));
  expect(byTime['Plecare 05:30']).toBe(99950);      // legelső Plecare = fejléc
  expect(byTime['Sosire 18:00']).toBe(101020);      // legutolsó Sosire = fejléc
  expect(byTime['Plecare 10:30']).toBe(100000);     // a köztes Plecare / Sosire a GPS-ből
  expect(byTime['Sosire 10:00']).toBe(100000);
});
