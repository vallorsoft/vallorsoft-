// ============================================================
//  Unit-teszt — lib/driverInfo.js (💬 sofőr-kérdések a fuvarkiírás chatben)
//  DB, GPS és geokódolás mockolva — nincs hálózat.
// ============================================================
let mockRules = [];
const mockDbQuery = jest.fn(async (sql, params) => {
  for (const r of mockRules) if (r.match.test(sql)) return r.fn ? r.fn(sql, params) : { rows: r.rows || [] };
  return { rows: [] };
});
jest.mock('../../db', () => ({ query: (...a) => mockDbQuery(...a) }));
let mockPositions = [];
jest.mock('../../lib/vehiclePositions', () => ({ getPositions: async () => ({ ok: true, positions: mockPositions }) }));
jest.mock('../../lib/reverseGeo', () => ({ reverseGeocode: async () => ({ address: 'Nădlac, Arad, România' }) }));
jest.mock('../../lib/routeEstimate', () => ({ geocodeCached: async () => ({ lat: 46.0, lng: 21.0 }) }));

const di = require('../../lib/driverInfo');

const NOW = new Date(2026, 9, 8, 12, 0, 0); // 2026-10-08
const DRIVERS = [
  { email: 'peto@x.ro', nume: 'Pető-Lőrincz Imre' },
  { email: 'ion@x.ro', nume: 'Ion Popescu' },
];
function baseRules() {
  return [
    { match: /FROM users WHERE company_id=\$1 AND pozicio='Sofer'/, rows: DRIVERS },
    { match: /kind='driver_alias'/, rows: [] },
    { match: /SELECT rendszam FROM vehicles WHERE company_id=\$1$/, rows: [{ rendszam: 'B104VLR' }] },
  ];
}
beforeEach(() => { mockRules = baseRules(); mockPositions = []; mockDbQuery.mockClear(); });

describe('detectTopics', () => {
  test.each([
    ['Peto hol tartt a fuvarjaval?', ['status']],
    ['Megtudod mutatni hol tart?', ['status']],
    ['Mikor tankolt Imre szeptemberben, mennyit és hol?', ['fuel']],
    ['Peto fogyasztása a múlt hónapban?', ['consumption']],
    ['mit vásárolt Peto?', ['purchases']],
    ['ce a făcut Ion săptămâna asta?', ['activity']],
    ['ki van úton?', ['status']],
    ['cine e pe drum?', ['status']],
    ['Peto határátlépései', ['border']],
  ])('%s', (txt, topics) => { expect(di.detectTopics(txt).topics).toEqual(topics); });

  test('fuvar-leírás nem lekérdezés', () => {
    expect(di.detectTopics('Peto viszi Cluj Arad 450 km').topics).toEqual([]);
    expect(di.detectTopics('felrakás Brassó, lerakás Bicske, Peto tankol útközben').topics).toEqual([]);
  });
});

describe('answer', () => {
  test('nem sofőr-kérdés → null (a fuvar-vázlat fut tovább)', async () => {
    expect(await di.answer(7, 'Holnap Brassóból Bicskére FTL, Peto viszi', [], 'hu', NOW)).toBeNull();
  });

  test('állapot: aktív fuvar állomásokkal + élő GPS, a sofőr e-mailje nem kerül ki', async () => {
    mockRules.push(
      { match: /FROM orders o WHERE o.company_id = \$1 AND LOWER\(o.email_sofer\) = \$2 AND o.status IN/, fn: (sql, p) => {
        expect(p).toEqual([7, 'peto@x.ro']);
        return { rows: [{ id: 'CMDX1', fuvar_no: 'CMD-2026-0042', status: 'In Curs', loc_incarcare: 'Brașov, RO', loc_descarcare: 'Bicske, HU', rendszam_camion: 'B 104 VLR', email_sofer: 'peto@x.ro' }] };
      } },
      { match: /FROM order_stops s/, rows: [
        { order_id: 'CMDX1', kind: 'pickup', loc: 'Brașov, RO', firma: 'Bilka', arrived_at: '2026-10-07T07:00:00Z', done_at: '2026-10-07T09:00:00Z' },
        { order_id: 'CMDX1', kind: 'delivery', loc: 'Bicske, HU', firma: 'Cegnev Kft', arrived_at: null, done_at: null },
      ] },
      { match: /FROM border_crossings b/, rows: [{ tip: 'Iesire', tara: 'RO', created_at: '2026-10-07T15:00:00Z' }] },
    );
    mockPositions = [{ rendszam: 'B104VLR', lat: 46.15, lng: 20.71, speed: 82, datetime: '2026-10-08T09:30:00Z' }];
    const r = await di.answer(7, 'Peto hol tart a fuvarjával?', [], 'hu', NOW);
    expect(r.topics).toEqual(['status']);
    expect(r.reply).toMatch(/Pető-Lőrincz Imre/);
    expect(r.html).toMatch(/CMD-2026-0042/);
    expect(r.html).toMatch(/Bicske/);
    expect(r.html).toMatch(/Nădlac/);
    expect(r.html).toMatch(/82 km\/h/);
    expect(r.html).toMatch(/külföldön/);
    expect(r.html).not.toMatch(/peto@x\.ro/);
  });

  test('utókérdés: az alany az előzményből jön', async () => {
    mockRules.push({ match: /FROM orders o WHERE o.company_id = \$1 AND LOWER\(o.email_sofer\)/, rows: [] });
    const r = await di.answer(7, 'Megtudod mutatni hol tart?', ['Peto hol tart a fuvarjával?'], 'hu', NOW);
    expect(r.reply).toMatch(/Pető-Lőrincz Imre/);
    expect(r.html).toMatch(/nem visz aktív fuvart/);
  });

  test('tankolás: a tétel saját dátuma szerint szűr, AdBlue külön, escape', async () => {
    mockRules.push({ match: /FROM fuvarlevelek fl/, fn: (sql, p) => {
      expect(p[0]).toBe(7); expect(p[1]).toBe('peto@x.ro');
      return { rows: [{ numar_fisa: 'MT-2026-0007', numar_camion: 'B104VLR', eff_date: '2026-09-30',
        alimentari: [
          { loc: 'MOL <Arad>', data: '2026-09-12', tip: 'Motorină', litru: '400', suma: '2600', plata: 'Card' },
          { loc: 'OMV', data: '2026-09-20', tip: 'AdBlue', litru: '40', suma: '120', plata: 'Card' },
          { loc: 'Shell', data: '2026-08-28', tip: 'Motorină', litru: '300', suma: '1900', plata: 'Card' },
        ], achizitii: [] }] };
    } });
    const r = await di.answer(7, 'Mikor tankolt Peto szeptemberben?', [], 'hu', NOW);
    expect(r.html).toMatch(/12\.09\.2026/);
    expect(r.html).not.toMatch(/28\.08\.2026/);
    expect(r.html).toMatch(/MOL &lt;Arad&gt;/);
    expect(r.html).toMatch(/400 L/);
    expect(r.reply).toMatch(/01\.09\.2026 – 30\.09\.2026/);
  });

  test('fogyasztás: súlyozott átlag + névleges eltérés', async () => {
    mockRules.push(
      { match: /FROM fuvarlevelek fl/, rows: [
        { numar_fisa: 'A', numar_camion: 'B104VLR', eff_date: '2026-10-02', total_km: 1000, motorina_folosit: 300, alimentari: [], achizitii: [] },
        { numar_fisa: 'B', numar_camion: 'B104VLR', eff_date: '2026-10-05', total_km: 1000, motorina_folosit: 320, alimentari: [], achizitii: [] },
      ] },
      { match: /SELECT fuel_per_100km FROM vehicles/, rows: [{ fuel_per_100km: 30 }] },
    );
    const r = await di.answer(7, 'Peto fogyasztása ezen a héten és a múlt héten?', [], 'hu', NOW);
    expect(r.topics).toEqual(['consumption']);
    // csak a hét (10.05–10.08) — B menetlevél: 32 L/100km
    expect(r.html).toMatch(/32,0/);
  });

  test('rendszám alapján is (vehicle scope)', async () => {
    mockRules.push({ match: /FROM fuvarlevelek fl/, fn: (sql, p) => { expect(p[1]).toBe('B104VLR'); expect(sql).toMatch(/numar_camion/); return { rows: [] }; } });
    const r = await di.answer(7, 'B 104 VLR menetlevelei?', [], 'ro', NOW);
    expect(r.topics).toEqual(['waybills']);
    expect(r.html).toMatch(/Nu există date/);
  });

  test('több egyező sofőr → választó gombok', async () => {
    mockRules[0] = { match: /FROM users WHERE company_id=\$1 AND pozicio='Sofer'/, rows: [{ email: 'a@x', nume: 'Ion Pop' }, { email: 'b@x', nume: 'Ion Ionescu' }] };
    const r = await di.answer(7, 'Ion hol tart?', [], 'hu', NOW);
    expect(r.questions[0].options).toEqual(['Ion Pop hol tart?', 'Ion Ionescu hol tart?']);
  });

  test('alany nélküli állapot-kérdés → flotta-lista', async () => {
    mockRules.push({ match: /o.email_sofer IS NOT NULL AND o.status IN/, rows: [
      { id: 'O1', fuvar_no: 'CMD-2026-0001', nume_sofer: 'Ion Popescu', email_sofer: 'ion@x.ro', rendszam_camion: 'B104VLR', loc_incarcare: 'Cluj', loc_descarcare: 'Arad' },
    ] });
    const r = await di.answer(7, 'ki van úton?', [], 'hu', NOW);
    expect(r.meta.fleet).toBe(true);
    expect(r.html).toMatch(/Ion Popescu/);
    expect(r.html).toMatch(/CMD-2026-0001/);
  });

  test('alany nélküli tankolás-kérdés → melyik sofőr?', async () => {
    const r = await di.answer(7, 'mikor tankoltak?', [], 'hu', NOW);
    expect(r.questions[0].options[0]).toMatch(/tankolásai\?$/);
  });

  test('minden lekérdezés company_id-szűrt', async () => {
    await di.answer(7, 'Mit csinált Peto a héten?', [], 'hu', NOW);
    for (const [sql, params] of mockDbQuery.mock.calls) {
      expect(params[0]).toBe(7);
      expect(sql).toMatch(/company_id/);
    }
  });
});
