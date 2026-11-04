// handlers/gpsToll.js — GPS-útdíj: jogosultság, cégszűrés, paraméter-rétegek, cache, kulcs nélküli ág
jest.mock('../../db', () => require('../helpers/db-mock').pool);
jest.mock('../../lib/mapsProvider', () => ({ getConfig: jest.fn(), bump: jest.fn() }));
jest.mock('../../lib/tollEstimate', () => ({ estimateFromPolyline: jest.fn() }));
jest.mock('../../lib/featureEnabled', () => ({ featureEnabled: jest.fn() }));
jest.mock('../../lib/audit', () => ({ fromReq: jest.fn() }));

const { pool, rows, reset } = require('../helpers/db-mock');
const maps = require('../../lib/mapsProvider');
const { estimateFromPolyline } = require('../../lib/tollEstimate');
const { featureEnabled } = require('../../lib/featureEnabled');
const tp = require('../../lib/tollProvider');
const h = require('../../handlers/gpsToll');

function call(fn, user, arg) {
  return new Promise((resolve) => {
    const res = { json: (b) => resolve(b.result) };
    h[fn]({ session: { user }, headers: {}, socket: {} }, res, [arg]);
  });
}
const ADMIN = { pozicio: 'Admin', company_id: 7, email: 'a@x.ro' };
const pts = (base, n) => Array.from({ length: n }, (_, i) => [base + i * 60, 45 + i * 0.01, 25, 80]);
const GPSMAP = rows([{ rendszam: 'CV 01 ABC', object_id: '99' }]);
const VEH = rows([{ id: 3, rendszam: 'CV01ABC', tip: 'Vontato', weight_kg: 38000, height_cm: null, length_cm: null, width_cm: null,
  weight_per_axle_kg: null, axle_count: 5, trailer_count: 1, emission_class: 'EURO6' }]);

beforeEach(() => {
  reset();
  jest.restoreAllMocks();
  maps.getConfig.mockReset(); maps.bump.mockReset();
  estimateFromPolyline.mockReset().mockResolvedValue({ total: 40, byCountry: [] });
  featureEnabled.mockReset().mockResolvedValue(true);
});

describe('gpsTollParams', () => {
  test('Sofer nem érheti el', async () => {
    const r = await call('gpsTollParams', { pozicio: 'Sofer', company_id: 7 }, { rendszam: 'X' });
    expect(r.ok).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });
  test('a jármű adata rétegződik az útvonaltervező alapjára, cégre szűrve', async () => {
    pool.query.mockResolvedValueOnce(GPSMAP).mockResolvedValueOnce(VEH);
    maps.getConfig.mockResolvedValue({ vendor: 'here', key: 'K' });
    const r = await call('gpsTollParams', ADMIN, { rendszam: 'cv-01-abc' });
    expect(r.ok).toBe(true);
    expect(r.params).toMatchObject({ grossWeight: 38000, height: 400, axleCount: 5, emissionClass: 'EURO6' });
    expect(r.from_vehicle.height).toBeNull();
    expect(r.has_here_key).toBe(true);
    expect(r.vehicle.id).toBe(3);
    expect(pool.query.mock.calls[0][1]).toEqual([7]);
    expect(pool.query.mock.calls[1][1]).toEqual([7]);
  });
});

describe('gpsTrackToll', () => {
  test('csomag-kapcsoló kikapcsolva → tiltva', async () => {
    featureEnabled.mockResolvedValue(false);
    const r = await call('gpsTrackToll', ADMIN, { rendszam: 'CV01ABC', from: '2026-10-01', to: '2026-10-02' });
    expect(r.ok).toBe(false);
  });
  test('31 napnál hosszabb időszak → hiba', async () => {
    const r = await call('gpsTrackToll', ADMIN, { rendszam: 'CV01ABC', from: '2026-08-01', to: '2026-10-01' });
    expect(r.ok).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });
  test('GPS-párosítás nélküli (más cég) jármű → hiba', async () => {
    pool.query.mockResolvedValueOnce(rows([])).mockResolvedValueOnce(rows([]));
    const r = await call('gpsTrackToll', ADMIN, { rendszam: 'B99ZZZ', from: '2026-10-01', to: '2026-10-01' });
    expect(r.ok).toBe(false);
  });
  test('HERE-kulcs nélkül: csak a ráta-becslés, HERE-hívás nincs', async () => {
    pool.query.mockResolvedValueOnce(GPSMAP).mockResolvedValueOnce(VEH)
      .mockResolvedValueOnce(rows([{ day: '2026-10-01', points_json: JSON.stringify(pts(1790000000, 30)), point_count: 30 }]));
    maps.getConfig.mockResolvedValue({ vendor: 'free', key: null });
    const spy = jest.spyOn(tp, 'hereTollFromTrace');
    const r = await call('gpsTrackToll', ADMIN, { rendszam: 'CV01ABC', from: '2026-10-01', to: '2026-10-01' });
    expect(r).toMatchObject({ ok: true, source: 'estimate', no_here_key: true });
    expect(r.estimate.total).toBe(40);
    expect(spy).not.toHaveBeenCalled();
  });
  test('cache-elt nap nem hív HERE-t, az új nap igen; kézi bevitel felülírja a járműt', async () => {
    pool.query
      .mockResolvedValueOnce(GPSMAP).mockResolvedValueOnce(VEH)
      .mockResolvedValueOnce(rows([
        { day: '2026-10-01', points_json: JSON.stringify(pts(1790000000, 30)), point_count: 30 },
        { day: '2026-10-02', points_json: JSON.stringify(pts(1790090000, 40)), point_count: 40 },
      ]))
      .mockResolvedValueOnce(rows([{ day: '2026-10-01', point_count: 30, total_eur: '11.50', km: '200.0',
        breakdown: [{ country: 'HUN', cost: 11.5 }], passes: [], notices: [] }]))
      .mockResolvedValue(rows([]));   // cache-mentés
    maps.getConfig.mockResolvedValue({ vendor: 'here', key: 'K' });
    const spy = jest.spyOn(tp, 'hereTollFromTrace').mockResolvedValue({
      total: 20, km: 300, breakdown: [{ country: 'HUN', cost: 8 }, { country: 'AUT', cost: 12 }],
      passes: [{ country: 'ROU', name: 'Rovinieta', cost: 7, currency: 'EUR' }], notices: [], calls: 2, pieces: 1 });
    const r = await call('gpsTrackToll', ADMIN, { rendszam: 'CV01ABC', from: '2026-10-01', to: '2026-10-02', truck: { grossWeight: '30000' } });
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][2]).toMatchObject({ grossWeight: 30000, axleCount: 5, emissionClass: 'EURO6' });
    // a 10-02 nap pontsora az előző nap utolsó pontjával kezdődik (összeérnek)
    expect(spy.mock.calls[0][0].length).toBe(41);
    expect(r.total).toBe(31.5);
    expect(r.breakdown).toEqual([{ country: 'HUN', cost: 19.5 }, { country: 'AUT', cost: 12 }]);
    expect(r.passes).toHaveLength(1);
    expect(r.here_calls).toBe(2);
    expect(maps.bump).toHaveBeenCalledTimes(2);
    const ins = pool.query.mock.calls.find((c) => /INSERT INTO gps_toll_days/.test(c[0]));
    expect(ins[1][0]).toBe(7);
    expect(r.days.find((d) => d.day === '2026-10-01').cached).toBe(true);
  });
  test('HERE-hiba egy napon: a nap hibával jelölve, a többi számol', async () => {
    pool.query
      .mockResolvedValueOnce(GPSMAP).mockResolvedValueOnce(VEH)
      .mockResolvedValueOnce(rows([{ day: '2026-10-01', points_json: JSON.stringify(pts(1790000000, 30)), point_count: 30 }]))
      .mockResolvedValueOnce(rows([]));
    maps.getConfig.mockResolvedValue({ vendor: 'here', key: 'K' });
    jest.spyOn(tp, 'hereTollFromTrace').mockRejectedValue(Object.assign(new Error('Unauthorized'), { calls: 1 }));
    const r = await call('gpsTrackToll', ADMIN, { rendszam: 'CV01ABC', from: '2026-10-01', to: '2026-10-01' });
    expect(r.ok).toBe(true);
    expect(r.errors).toBe(1);
    expect(r.days[0].error).toBe('Unauthorized');
    expect(maps.bump).toHaveBeenCalledTimes(1);
  });
});
