// tests/unit/route-order-load.test.js — útvonaltervező: fuvar betöltése
//   - _buildOrderRoutePoints: stop-sorrend, régi fuvar fallback, mentett
//     route_geo koordináták + köztespontok átvétele
//   - getOrderRouteForPlanning: szerep-kapu, cégre szűrt lekérdezés, nem talált
'use strict';

jest.mock('../../db', () => ({ query: jest.fn() }));
const pool = require('../../db');
const handlers = require('../../handlers/routePlannerHandlers');
const { _buildOrderRoutePoints } = handlers;

function mkReq(pozicio) {
  return { session: { user: pozicio ? { id: 1, company_id: 7, email: 'a@b.c', pozicio } : null } };
}
function mkRes() {
  const r = {};
  r.json = jest.fn().mockImplementation(function (o) { r._body = o; return r; });
  return r;
}

describe('_buildOrderRoutePoints', () => {
  test('a stopok sorrendje megmarad (interleaved), típus + cég + dátum', () => {
    const stops = [
      { kind: 'pickup', loc: 'Cluj', firma: 'A SRL', data: '2026-10-01' },
      { kind: 'delivery', loc: 'Arad', firma: 'B SRL', data: '2026-10-02', done_at: '2026-10-02T10:00:00Z' },
      { kind: 'pickup', loc: 'Timisoara', firma: null, data: null },
      { kind: 'delivery', loc: 'Budapest', firma: 'C Kft', data: '2026-10-03' },
    ];
    const r = _buildOrderRoutePoints({}, stops, null);
    expect(r.points.map((p) => p.label)).toEqual(['Cluj', 'Arad', 'Timisoara', 'Budapest']);
    expect(r.points.map((p) => p.kind)).toEqual(['pickup', 'delivery', 'pickup', 'delivery']);
    expect(r.points[1]).toMatchObject({ firma: 'B SRL', date: '2026-10-02', done: true });
    expect(r.fromGeo).toBe(false);
  });

  test('régi (stop nélküli) fuvar → felrakó + lerakó mező', () => {
    const r = _buildOrderRoutePoints({ loc_incarcare: 'Brasov', loc_descarcare: 'Wien', data_incarcare: new Date('2026-09-01T00:00:00Z') }, [], null);
    expect(r.points.map((p) => [p.kind, p.label])).toEqual([['pickup', 'Brasov'], ['delivery', 'Wien']]);
    expect(r.points[0].date).toBe('2026-09-01');
  });

  test('mentett route_geo: koordináták a megállókra + köztespont a helyén', () => {
    const stops = [{ kind: 'pickup', loc: 'Cluj' }, { kind: 'delivery', loc: 'Arad' }];
    const rg = { waypoints: [
      { type: 'loading', address: 'Cluj', lat: 46.77, lng: 23.6 },
      { type: 'waypoint', address: 'Deva', lat: 45.88, lng: 22.9 },
      { type: 'unloading', address: 'Arad', lat: 46.18, lng: 21.31 },
    ] };
    const r = _buildOrderRoutePoints({}, stops, JSON.stringify(rg));
    expect(r.fromGeo).toBe(true);
    expect(r.points.map((p) => p.kind)).toEqual(['pickup', 'via', 'delivery']);
    expect(r.points[0]).toMatchObject({ label: 'Cluj', lat: 46.77, lng: 23.6 });
    expect(r.points[1]).toMatchObject({ label: 'Deva', lat: 45.88 });
  });

  test('route_geo megálló-száma eltér a stopokétól → csak a stopok (geokódolásra)', () => {
    const stops = [{ kind: 'pickup', loc: 'A' }, { kind: 'delivery', loc: 'B' }, { kind: 'delivery', loc: 'C' }];
    const rg = { waypoints: [{ type: 'loading', lat: 1, lng: 1 }, { type: 'unloading', lat: 2, lng: 2 }] };
    const r = _buildOrderRoutePoints({}, stops, rg);
    expect(r.fromGeo).toBe(false);
    expect(r.points.every((p) => p.lat == null)).toBe(true);
    expect(r.points).toHaveLength(3);
  });

  test('25 pontnál több → levágva, jelezve', () => {
    const stops = Array.from({ length: 30 }, (_, i) => ({ kind: i % 2 ? 'delivery' : 'pickup', loc: 'P' + i }));
    const r = _buildOrderRoutePoints({}, stops, null);
    expect(r.points).toHaveLength(25);
    expect(r.truncated).toBe(true);
  });
});

describe('getOrderRouteForPlanning', () => {
  beforeEach(() => pool.query.mockReset());

  test('Sofer → tiltva, DB-hívás nélkül', async () => {
    const res = mkRes();
    await handlers.getOrderRouteForPlanning(mkReq('Sofer'), res, [{ orderId: 'CMD-1' }]);
    expect(res._body.result.ok).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('ismeretlen / más cég fuvarja → nem található (company_id-szűrt)', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })   // routeFeatureOff
      .mockResolvedValueOnce({ rows: [] });  // orders
    const res = mkRes();
    await handlers.getOrderRouteForPlanning(mkReq('Admin'), res, [{ orderId: 'CMD-X' }]);
    expect(res._body.result.ok).toBe(false);
    const call = pool.query.mock.calls[1];
    expect(call[0]).toMatch(/o\.company_id = \$2/);
    expect(call[1]).toEqual(['CMD-X', 7]);
  });

  test('sikeres betöltés — pontok + fuvar-metaadat', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'CMD-1', fuvar_no: 'CMD-2026-0001', client: 'Ügyfél', status: 'Alocat',
        pret: '1200', km: 640, tractor_vid: 3, tractor_rendszam: 'B104VLR', tractor_fuel: '29', route_geo: null }] })
      .mockResolvedValueOnce({ rows: [{ kind: 'pickup', loc: 'Cluj' }, { kind: 'delivery', loc: 'Arad' }] });
    const res = mkRes();
    await handlers.getOrderRouteForPlanning(mkReq('Manager'), res, [{ orderId: 'CMD-1' }]);
    const r = res._body.result;
    expect(r.ok).toBe(true);
    expect(r.points).toHaveLength(2);
    expect(r.order).toMatchObject({ fuvar_no: 'CMD-2026-0001', pret: 1200, tractor_id: 3, fuel_per_100km: 29 });
    expect(pool.query.mock.calls[2][1]).toEqual(['CMD-1', 7]);
  });
});

describe('getOrdersForRoutePlanning — keresés', () => {
  beforeEach(() => pool.query.mockReset());
  test('q paraméteres LIKE, cégre szűrve', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = mkRes();
    await handlers.getOrdersForRoutePlanning(mkReq('Admin'), res, [{ q: 'Cluj' }]);
    expect(res._body.result.ok).toBe(true);
    expect(pool.query.mock.calls[0][1]).toEqual([7, '%cluj%']);
  });
});
