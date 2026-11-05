// Fuvar / menetlevél teljes km: minden pont sorrendben, rakott / üres bontás
jest.mock('../../db', () => require('../helpers/db-mock').pool);
jest.mock('../../lib/audit', () => ({ fromReq: jest.fn() }));
jest.mock('../../lib/featureEnabled', () => ({ featureEnabled: jest.fn().mockResolvedValue(true) }));
const { pool, rows, reset } = require('../helpers/db-mock');
const rc = require('../../lib/routeChain');

// Hamis útvonal-becslő: szakaszonként a pontokban megadott km (w.km a cél ponton)
function fakeEstimate(part) {
  const legs = [];
  for (let i = 0; i < part.length - 1; i++) legs.push({ fromLabel: part[i].address, toLabel: part[i + 1].address, km: part[i + 1].km || 100, durationSeconds: 3600 });
  return Promise.resolve({ km: legs.reduce((a, l) => a + l.km, 0), durationSeconds: legs.length * 3600,
    polyline: part.map((p, i) => [46 + i * 0.1, 23]), legs,
    waypoints: part.map((p, i) => ({ type: p.type, lat: 46 + i * 0.1, lng: 23, label: p.address })) });
}

describe('classifyLegs — rakott / üres', () => {
  test('a kért példa: Ploiești fel → Copșa Mică le → Arad fel → Copșa Mică le', () => {
    expect(rc.classifyLegs(['pickup', 'delivery', 'pickup', 'delivery'])).toEqual([false, true, false]);
  });
  test('menetlevél: Plecare → … → Sosire — az odaút és a hazaút üres', () => {
    expect(rc.classifyLegs(['plecare', 'loading', 'unloading', 'loading', 'unloading', 'sosire']))
      .toEqual([true, false, true, false, true]);
  });
  test('egy felrakó, két lerakó: a lerakók közti szakasz rakott', () => {
    expect(rc.classifyLegs(['pickup', 'delivery', 'delivery'])).toEqual([false, false]);
  });
  test('két felrakó egymás után, majd két lerakó: végig rakott', () => {
    expect(rc.classifyLegs(['pickup', 'pickup', 'delivery', 'delivery'])).toEqual([false, false, false]);
  });
  test('menetlevél sor-nevek (Incarcare / Descarcare) is', () => {
    expect(rc.classifyLegs(['Plecare', 'Incarcare', 'Descarcare', 'Sosire'])).toEqual([true, false, true]);
  });
});

describe('routeChain', () => {
  test('a példa km-e sorrendben, üres km-mel együtt', async () => {
    const r = await rc.routeChain(1, [
      { type: 'loading', address: 'Ploiești' }, { type: 'unloading', address: 'Copșa Mică', km: 280 },
      { type: 'loading', address: 'Arad', km: 290 }, { type: 'unloading', address: 'Copșa Mică', km: 300 },
    ], { estimate: fakeEstimate });
    expect(r.km).toBe(870); expect(r.loaded_km).toBe(580); expect(r.empty_km).toBe(290);
    expect(r.legs.map((l) => l.empty)).toEqual([false, true, false]);
  });
  test('20 pont fölött darabolva, a darabok határán nincs kettőzés', async () => {
    const pts = [];
    for (let i = 0; i < 45; i++) pts.push({ type: i % 2 ? 'unloading' : 'loading', address: 'P' + i, km: 10 });
    const r = await rc.routeChain(1, pts, { estimate: fakeEstimate });
    expect(r.legs.length).toBe(44); expect(r.km).toBe(440); expect(r.waypoints.length).toBe(45);
  });
  test('kevesebb mint 2 pont → hiba', async () => {
    await expect(rc.routeChain(1, [{ address: 'A' }], { estimate: fakeEstimate })).rejects.toThrow();
  });
});

describe('orderRouteKm.computeForOrder', () => {
  const ork = require('../../lib/orderRouteKm');
  beforeEach(() => reset());
  const STOPS = [{ kind: 'pickup', loc: 'Ploiești' }, { kind: 'delivery', loc: 'Copșa Mică' }, { kind: 'pickup', loc: 'Arad' }, { kind: 'delivery', loc: 'Copșa Mică' }];

  test('üres km-ű fuvar: km = teljes lánc, rakott / üres bontás a route_geo-ban', async () => {
    pool.query.mockResolvedValueOnce(rows(STOPS)).mockResolvedValueOnce(rows([{ km: 0, route_geo: null }])).mockResolvedValueOnce(rows([]));
    const r = await ork.computeForOrder(7, 'A', { estimate: (p) => fakeEstimate(p.map((w, i) => Object.assign({ km: [0, 280, 290, 300][i] }, w))) });
    expect(r.km).toBe(870); expect(r.km_updated).toBe(true);
    const upd = pool.query.mock.calls[2];
    expect(upd[0]).toMatch(/km=\$4/); expect(upd[1][0]).toBe('A'); expect(upd[1][1]).toBe(7); expect(upd[1][3]).toBe(870);
    const geo = JSON.parse(upd[1][2]);
    expect(geo.empty_km).toBe(290); expect(geo.loaded_km).toBe(580); expect(geo.sig).toBe(ork.sigOf(STOPS));
  });
  test('kézzel beírt km-et nem ír felül', async () => {
    pool.query.mockResolvedValueOnce(rows(STOPS)).mockResolvedValueOnce(rows([{ km: 950, route_geo: { km: 500 } }])).mockResolvedValueOnce(rows([]));
    const r = await ork.computeForOrder(7, 'A', { estimate: fakeEstimate });
    expect(r.km_updated).toBe(false);
    expect(pool.query.mock.calls[2][0]).not.toMatch(/km=\$4/);
  });
  test('korábbi automata km frissül', async () => {
    pool.query.mockResolvedValueOnce(rows(STOPS)).mockResolvedValueOnce(rows([{ km: 500, route_geo: { km: 500 } }])).mockResolvedValueOnce(rows([]));
    const r = await ork.computeForOrder(7, 'A', { estimate: fakeEstimate });
    expect(r.km_updated).toBe(true);
  });
  test('változatlan állomás-lista → nincs újraszámolás', async () => {
    pool.query.mockResolvedValueOnce(rows(STOPS)).mockResolvedValueOnce(rows([{ km: 870, route_geo: { sig: ork.sigOf(STOPS), src: 'here-truck' } }]));
    const r = await ork.computeForOrder(7, 'A', { estimate: fakeEstimate });
    expect(r.skipped).toBe('same'); expect(pool.query).toHaveBeenCalledTimes(2);
  });
  test('hiányzó cím → kihagyva', async () => {
    pool.query.mockResolvedValueOnce(rows([{ kind: 'pickup', loc: 'A' }, { kind: 'delivery', loc: '' }]));
    expect((await ork.computeForOrder(7, 'A', { estimate: fakeEstimate })).skipped).toBe('stops');
  });
});

describe('waybillRoute', () => {
  const wr = require('../../lib/waybillRoute');
  beforeEach(() => reset());
  test('sor-típusok és koordináta a szövegből', () => {
    expect(wr.typeOf('Plecare')).toBe('plecare'); expect(wr.typeOf('Incarcare')).toBe('loading');
    expect(wr.typeOf('Descărcare')).toBe('unloading'); expect(wr.typeOf('Sosire')).toBe('sosire');
    expect(wr.coordsIn('Str. X, Arad (46.18672, 21.31239)')).toEqual({ lat: 46.18672, lng: 21.31239 });
    expect(wr.coordsIn('Garaj-Arcus')).toBeNull();
  });
  test('splitPolyline a köztes pontoknál vág', () => {
    const poly = [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]];
    const legs = wr.splitPolyline(poly, [{ lat: 0, lng: 0 }, { lat: 0, lng: 2 }, { lat: 0, lng: 4 }]);
    expect(legs).toEqual([[[0, 0], [0, 1], [0, 2]], [[0, 2], [0, 3], [0, 4]]]);
  });
  test('teljes menetlevél: Plecare → fuvarok → Sosire, km-óra összevetés, állomás tényleges helye', async () => {
    pool.query.mockResolvedValueOnce(rows([{ id: 'W1', numar_camion: null, indulas_dt: null, erkezes_dt: null, km_inceput: 1000, km_sfarsit: 2050, total_km: 1050,
      puncte: [{ tip: 'Plecare', loc: 'Garaj-Arcus' }, { tip: 'Incarcare', loc: 'Ploiești', stopId: 11 }, { tip: 'Descarcare', loc: 'Copșa Mică', stopId: 12 },
        { tip: 'Incarcare', loc: 'Arad', stopId: 13 }, { tip: 'Descarcare', loc: 'Copșa Mică', stopId: 14 }, { tip: 'Sosire', loc: 'Garaj-Arcus' }] }]));
    pool.query.mockResolvedValueOnce(rows([{ id: 11, actual_lat: 44.94, actual_lng: 26.02, loc: 'Ploiești' }]));
    pool.query.mockResolvedValueOnce(rows([]));
    const kms = [0, 200, 280, 290, 300, 160];
    const r = await wr.checkWaybill(7, 'W1', { estimate: (p) => fakeEstimate(p.map((w) => Object.assign({ km: kms[['Garaj-Arcus', 'Ploiești', 'Copșa Mică', 'Arad'].indexOf(w.address)] }, w))) });
    expect(pool.query.mock.calls[0][1]).toEqual(['W1', 7]);
    expect(pool.query.mock.calls[1][1]).toEqual([7, [11, 12, 13, 14]]);
    expect(r.planned_km).toBeGreaterThan(0); expect(r.odo_km).toBe(1050);
    const saved = pool.query.mock.calls[2][1];
    const detail = JSON.parse(saved[12]);
    expect(detail.legs.map((l) => l.empty)).toEqual([true, false, true, false, true]);
    expect(detail.waypoints[1]).toMatchObject({ lat: 46.1, lng: 23 });   // a becslő által visszaadott (a tényleges koordinátát kapta)
    expect(saved[2]).toBe(r.planned_km); expect(saved[3] + saved[4]).toBeCloseTo(r.planned_km, 0);
  });
  test('idegen / hiányzó menetlevél', async () => {
    pool.query.mockResolvedValueOnce(rows([]));
    expect((await wr.checkWaybill(7, 'X')).status).toBe('missing');
  });
});
