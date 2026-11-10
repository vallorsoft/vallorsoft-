// ============================================================
//  Unit-teszt — lib/waybillRows.js + lib/borderPoints.js
//  A menetlevél útvonal-táblája: pontok + határátlépések időrendben,
//  dátummal és pontos idővel; az átkelő neve és a szomszéd ország.
// ============================================================
const { buildRouteRows, tripEndpoint, roDateTime, dateRo } = require('../../lib/waybillRows');
const { describeCrossing, nearestCrossingName } = require('../../lib/borderPoints');

const P = (tip, loc, data, time) => ({ tip, loc, data, time });

describe('borderPoints.describeCrossing', () => {
  test('automata sor: név a feliratból, ország a koordinátából', () => {
    const d = describeCrossing({ lat: 46.15, lng: 20.735, locatie: 'Nădlac II · GPS 46.15000, 20.73500' });
    expect(d).toMatchObject({ name: 'Nădlac II', country: 'HU', countryRo: 'Ungaria' });
  });
  test('sofőr-gomb: csak "lat, lng" szöveg → az átkelő a koordinátából', () => {
    const d = describeCrossing({ locatie: '43.8800, 25.9700' });
    expect(d).toMatchObject({ name: 'Giurgiu', country: 'BG', countryRo: 'Bulgaria' });
  });
  test('irodai, ékezet nélküli helység → ország a névből', () => {
    expect(describeCrossing({ locatie: 'Bors' })).toMatchObject({ name: 'Bors', country: 'HU' });
    expect(describeCrossing({ locatie: 'nadlac ii' }).country).toBe('HU');
  });
  test('ismeretlen hely → nincs kitalált adat', () => {
    expect(describeCrossing({ locatie: null })).toEqual({ name: null, country: null, countryRo: null, coords: null });
    // az ország közepe: se név, se ország
    const d = describeCrossing({ lat: 45.9, lng: 24.9 });
    expect(d.name).toBeNull();
    expect(d.country).toBeNull();
    expect(d.coords).toBe('45.90000, 24.90000');
  });
  test('nearestCrossingName változatlan viselkedés (8 km)', () => {
    expect(nearestCrossingName(47.115, 21.81)).toBe('Borș');
    expect(nearestCrossingName(45.9, 24.9)).toBeNull();
  });
});

describe('waybillRows.buildRouteRows', () => {
  const puncte = [
    P('Plecare', 'Garaj-Arcus', '2026-03-02', '06:30'),
    P('Încărcare', 'Cluj-Napoca', '2026-03-02', '10:00'),
    P('Descărcare', 'Wien', '2026-03-03', '14:00'),
    P('Sosire', 'Garaj-Arcus', '2026-03-05', '18:45'),
  ];
  const xs = [
    // 2026-03-02 17:20 román idő (télen UTC+2)
    { datetime: '2026-03-02T15:20:00.000Z', direction: 'OUT', locatie: 'Borș II · GPS 47.07000, 21.77000', lat: 47.07, lng: 21.77, source: 'auto' },
    { datetime: '2026-03-04T20:05:00.000Z', direction: 'IN', locatie: 'Nădlac II · GPS 46.15000, 20.73500', lat: 46.15, lng: 20.735, source: 'auto' },
  ];

  test('a határátlépés időrendben a fel-/lerakók közé kerül, román idővel', () => {
    const rows = buildRouteRows(puncte, xs);
    expect(rows.map((r) => r.kind === 'border' ? 'B:' + r.direction : r.tip))
      .toEqual(['Plecare', 'Încărcare', 'B:OUT', 'Descărcare', 'B:IN', 'Sosire']);
    expect(rows[2]).toMatchObject({ name: 'Borș II', countryRo: 'Ungaria', date: '2026-03-02', time: '17:20' });
    expect(rows[4]).toMatchObject({ name: 'Nădlac II', date: '2026-03-04', time: '22:05' });
    // a pontok megtartják a beírt dátumot + órát
    expect(rows[0]).toMatchObject({ kind: 'punct', date: '2026-03-02', time: '06:30', loc: 'Garaj-Arcus' });
  });

  test('nyári időszámítás: UTC+3', () => {
    expect(roDateTime('2026-07-10T21:30:00Z')).toEqual({ date: '2026-07-11', time: '00:30' });
  });

  test('az átlépés sosem kerül az indulás elé vagy az érkezés mögé', () => {
    const rows = buildRouteRows(puncte, [
      { datetime: '2026-03-02T02:00:00Z', direction: 'OUT', locatie: 'Borș' },
      { datetime: '2026-03-05T21:00:00Z', direction: 'IN', locatie: 'Borș' },
    ]);
    expect(rows[0].tip).toBe('Plecare');
    expect(rows[1].kind).toBe('border');
    expect(rows[rows.length - 1].tip).toBe('Sosire');
    expect(rows[rows.length - 2].kind).toBe('border');
  });

  test('óra nélküli / hibás pontok és üres bemenet nem dobnak', () => {
    expect(buildRouteRows(null, null)).toEqual([]);
    expect(buildRouteRows([], xs)).toHaveLength(2);
    const rows = buildRouteRows([P('Plecare', 'A', '2026-03-02'), null, 'x', P('Descărcare', 'B', 'ieri'), P('Sosire', 'C', '2026-03-05')],
      [{ datetime: 'nem dátum', direction: 'OUT' }, { datetime: '2026-03-03T10:00:00Z', direction: 'OUT' }]);
    expect(rows.map((r) => r.kind)).toEqual(['punct', 'punct', 'border', 'punct']);
    expect(rows[1]).toMatchObject({ date: 'ieri', time: '' });
  });
});

describe('waybillRows.tripEndpoint + dateRo', () => {
  test('a Plecare / Sosire pont dátuma + órája az elsődleges', () => {
    const puncte = [P('Plecare', 'A', '2026-03-02', '06:30'), P('Sosire', 'B', '2026-03-05', '18:45')];
    expect(tripEndpoint(puncte, 'plecare', '2026-03-02T12:00:00Z')).toEqual({ date: '2026-03-02', time: '06:30' });
    expect(tripEndpoint(puncte, 'sosire', null)).toEqual({ date: '2026-03-05', time: '18:45' });
  });
  test('pont nélkül a tárolt időpont; 00:00 = csak dátum', () => {
    expect(tripEndpoint([], 'plecare', new Date('2026-03-02T08:15:00Z'))).toEqual({ date: '2026-03-02', time: '08:15' });
    expect(tripEndpoint([], 'sosire', '2026-03-05T00:00:00Z')).toEqual({ date: '2026-03-05', time: '' });
    expect(tripEndpoint(null, 'plecare', null)).toEqual({ date: '', time: '' });
  });
  test('dateRo', () => {
    expect(dateRo('2026-03-02')).toBe('02.03.2026');
    expect(dateRo('ieri')).toBe('ieri');
  });
});

describe('fillTrackTimes — idő a GPS-útvonalból a koordinátás pontokhoz', () => {
  const { fillTrackTimes, buildRouteRows, coordsOf } = require('../../lib/waybillRows');
  const T = (iso) => Date.parse(iso) / 1000;
  const stay = (iso, min, lat, lng) => { const a = []; for (let i = 0; i <= min; i++) a.push([T(iso) + i * 60, lat, lng, 0]); return a; };

  test('coordsOf: a cím végi zárójeles koordináta', () => {
    expect(coordsOf('Hájska 1200/151, Močenok, 951 31, SK (48.22610, 17.93158)')).toEqual({ lat: 48.2261, lng: 17.93158 });
    expect(coordsOf('Garaj-Arcus')).toBeNull();
  });

  test('idő nélküli koordinátás pont megkapja az érkezés–távozás idejét', () => {
    const puncte = [
      { tip: 'Plecare', loc: 'Garaj', data: '2026-10-25', time: '11:00' },
      { tip: 'Descarcare', loc: 'Močenok (48.22610, 17.93158)', data: '2026-10-26' },
    ];
    const track = [[T('2026-10-26T06:00:00Z'), 47.5, 19.0, 60]].concat(stay('2026-10-26T09:00:00Z', 40, 48.2261, 17.9316));
    const st = fillTrackTimes(puncte, {}, track);
    const rows = buildRouteRows(puncte, [], st);
    expect(rows[1].date).toBe('2026-10-26');
    expect(rows[1].time).toBe('11:00');        // 09:00 UTC = 11:00 román idő (októberi nyári idő vége után +2)
    expect(rows[1].timeTo).toBe('11:40');
    expect(rows[1].gps).toBe(true);
  });

  test('két pont ugyanazon a helyen → két külön megállás; beírt óra érintetlen', () => {
    const puncte = [
      { tip: 'Descarcare', loc: 'A (48.22610, 17.93158)', data: '2026-10-26' },
      { tip: 'Incarcare', loc: 'A (48.22602, 17.93153)', data: '2026-10-26' },
      { tip: 'Descarcare', loc: 'A (48.22610, 17.93158)', data: '2026-10-26', time: '18:30' },
    ];
    const track = stay('2026-10-26T08:00:00Z', 30, 48.2261, 17.9316)
      .concat([[T('2026-10-26T09:30:00Z'), 48.4, 18.2, 70]])
      .concat(stay('2026-10-26T11:00:00Z', 10, 48.2261, 17.9316));
    const st = fillTrackTimes(puncte, {}, track);
    const rows = buildRouteRows(puncte, [], st);
    expect(new Set([rows[0].time, rows[1].time]).size).toBe(2);
    expect(rows[2].time).toBe('18:30');
    expect(rows[2].gps).toBeUndefined();
  });

  test('áthaladás (2 percnél rövidebb) nem ad időt', () => {
    const puncte = [{ tip: 'Descarcare', loc: 'A (48.22610, 17.93158)', data: '2026-10-26' }];
    const st = fillTrackTimes(puncte, {}, [[T('2026-10-26T08:00:00Z'), 48.2261, 17.9316, 80]]);
    expect(Object.keys(st)).toHaveLength(0);
  });
});

describe('megbízható GPS-idő az elsődleges', () => {
  const { buildRouteRows } = require('../../lib/waybillRows');
  const puncte = [{ tip: 'Descarcare', loc: 'A', data: '2026-10-26', time: '18:30', stopId: 7 }];
  const t = { from: '2026-10-27T09:00:00Z', to: '2026-10-27T09:40:00Z' };
  test('biztos állomás-idő felülírja a beírt órát (a nappal együtt)', () => {
    const r = buildRouteRows(puncte, [], { 7: { ...t, sure: true } })[0];
    expect([r.date, r.time, r.timeTo, r.gps]).toEqual(['2026-10-27', '11:00', '11:40', true]);
  });
  test('nem megbízható forrás nem írja felül a beírt órát', () => {
    const r = buildRouteRows(puncte, [], { 7: t })[0];
    expect([r.date, r.time]).toEqual(['2026-10-26', '18:30']);
  });
});
