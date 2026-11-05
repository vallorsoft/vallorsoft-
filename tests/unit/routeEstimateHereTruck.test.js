// HERE-kulcsos cégnél az útvonal-becslés KIZÁRÓLAG HERE kamion-routing, 40 t.
jest.mock('../../db', () => ({ query: jest.fn(async () => ({ rows: [] })) }));
const maps = require('../../lib/mapsProvider');
const est = require('../../lib/routeEstimate');

const flex = require('@here/flexpolyline');
const poly = (pts) => flex.encode({ precision: 5, thirdDim: 0, thirdDimPrecision: 0, polyline: pts });

describe('estimateRoute — HERE kamion 40 t', () => {
  let calls;
  beforeEach(() => {
    calls = [];
    jest.spyOn(maps, 'bump').mockImplementation(() => {});
  });
  afterEach(() => { jest.restoreAllMocks(); delete global.fetch; });

  test('HERE-kulcsnál truck mód, 40000 kg, szakaszonkénti km, OSRM nincs hívva', async () => {
    jest.spyOn(maps, 'getConfig').mockResolvedValue({ vendor: 'here', key: 'K' });
    global.fetch = jest.fn(async (url) => {
      calls.push(url);
      return { ok: true, status: 200, json: async () => ({ routes: [{ sections: [
        { summary: { length: 500000, duration: 21600 }, polyline: poly([[44.9, 26.0], [46.1, 24.3]]) },
        { summary: { length: 250000, duration: 10800 }, polyline: poly([[46.1, 24.3], [46.2, 21.3]]) },
      ] }] }) };
    });
    const r = await est.estimateRoute([{ lat: 44.9, lng: 26.0 }, { lat: 46.1, lng: 24.3 }, { lat: 46.2, lng: 21.3 }], 7);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('router.hereapi.com/v8/routes?transportMode=truck');
    expect(calls[0]).toContain('vehicle[grossWeight]=40000');
    expect(calls[0]).toContain('via=46.1,24.3');
    expect(r.source).toBe('here-truck');
    expect(r.km).toBe(750);
    expect(r.legs.map((l) => l.km)).toEqual([500, 250]);
    expect(maps.bump).toHaveBeenCalledWith(7, 'here');
  });

  test('HERE-hiba esetén nincs autós OSRM-tartalék — hiba', async () => {
    jest.spyOn(maps, 'getConfig').mockResolvedValue({ vendor: 'here', key: 'K' });
    global.fetch = jest.fn(async (url) => { calls.push(url); return { ok: false, status: 500, json: async () => ({}) }; });
    await expect(est.estimateRoute([{ lat: 44.9, lng: 26.0 }, { lat: 46.2, lng: 21.3 }], 7)).rejects.toThrow();
    expect(calls.some((u) => u.includes('project-osrm'))).toBe(false);
  });

  test('HERE-kulcs nélkül marad az OSRM', async () => {
    jest.spyOn(maps, 'getConfig').mockResolvedValue({ vendor: 'free', key: null });
    global.fetch = jest.fn(async (url) => { calls.push(url); return { ok: true, status: 200,
      json: async () => ({ code: 'Ok', routes: [{ distance: 100000, duration: 3600, geometry: { coordinates: [[26, 44.9], [21.3, 46.2]] } }] }) }; });
    const r = await est.estimateRoute([{ lat: 44.9, lng: 26.0 }, { lat: 46.2, lng: 21.3 }], 7);
    expect(r.source).toBe('osrm');
    expect(calls[0]).toContain('project-osrm');
  });
});

describe('routeChain — forrás továbbadása a fuvar-kiírónak', () => {
  const rc = require('../../lib/routeChain');
  const mk = (source) => async (part) => ({ km: 100, durationSeconds: 3600, polyline: [], waypoints: part.map((p) => ({ lat: p.lat, lng: p.lng, label: 'x' })),
    legs: part.slice(1).map(() => ({ fromLabel: 'a', toLabel: 'b', km: 100, durationSeconds: 3600 })), source });
  const wps = [{ type: 'loading', lat: 1, lng: 1 }, { type: 'unloading', lat: 2, lng: 2 }];
  test('HERE kamion → source here-truck', async () => {
    expect((await rc.routeChain(1, wps, { estimate: mk('here-truck') })).source).toBe('here-truck');
  });
  test('OSRM → source osrm', async () => {
    expect((await rc.routeChain(1, wps, { estimate: mk('osrm') })).source).toBe('osrm');
  });
});

describe('OSRM-ok jelzése + HERE-re váltás utáni újraszámolás', () => {
  afterEach(() => { jest.restoreAllMocks(); delete global.fetch; });
  test('HERE-kulcs nélkül a válasz megmondja, miért OSRM', async () => {
    jest.spyOn(maps, 'getConfig').mockResolvedValue({ vendor: 'free', key: null, reason: 'decrypt-failed' });
    global.fetch = jest.fn(async () => ({ ok: true, status: 200,
      json: async () => ({ code: 'Ok', routes: [{ distance: 1000, duration: 60, geometry: { coordinates: [[26, 44.9], [21.3, 46.2]] } }] }) }));
    const r = await est.estimateRoute([{ lat: 44.9, lng: 26.0 }, { lat: 46.2, lng: 21.3 }], 7);
    expect(r).toMatchObject({ source: 'osrm', free_reason: 'decrypt-failed' });
  });

  test('orderRouteKm: azonos állomás-lista, de régi OSRM-eredmény + van HERE → újraszámol', async () => {
    const pool = require('../../db');
    const ork = require('../../lib/orderRouteKm');
    const rc = require('../../lib/routeChain');
    jest.spyOn(maps, 'getConfig').mockResolvedValue({ vendor: 'here', key: 'K' });
    const spy = jest.spyOn(rc, 'routeChain').mockResolvedValue({ km: 500, durationSeconds: 1, polyline: [], waypoints: [], legs: [],
      loaded_km: 500, empty_km: 0, source: 'here-truck' });
    const stops = [{ kind: 'pickup', loc: 'A' }, { kind: 'delivery', loc: 'B' }];
    pool.query.mockReset();
    pool.query.mockResolvedValueOnce({ rows: stops })
      .mockResolvedValueOnce({ rows: [{ km: 480, route_geo: { sig: 'pickup|A > delivery|B', km: 480, src: 'osrm', waypoints: [] } }] })
      .mockResolvedValue({ rows: [] });
    const r = await ork.computeForOrder(7, 'O1');
    expect(spy).toHaveBeenCalled();
    expect(r).toMatchObject({ km: 500, km_updated: true });
  });
});
