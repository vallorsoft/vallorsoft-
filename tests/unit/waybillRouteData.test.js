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
  expect(routeRows.map((r) => r.km)).toEqual([100000, 100500, 101000]);
  expect(f.puncte[1]._lat).toBeUndefined();          // a tárolt sor nem kap segédmezőt
  const snap = odoSnapshot(routeRows);
  expect(snap.found).toBe(3);
  expect(snap.rows[1]).toEqual({ key: 'p1', km: 100500 });
});

test('rendszám nélkül nincs GPS-lekérés, km sincs', async () => {
  const pool = mockPool();
  const { routeRows } = await buildWaybillRoute(pool, 1, { puncte: [{ tip: 'Plecare', loc: 'A', data: '2026-03-02', time: '07:00' }] });
  expect(routeRows[0].km).toBeUndefined();
  expect(pool.query.mock.calls.some((c) => /gps_track_days/.test(c[0]))).toBe(false);
});
