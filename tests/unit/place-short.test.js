// public/place-short.js — rövid fuvar-címke (megbízó · város → város) a fuvar-választókhoz
describe('place-short', () => {
  let w;
  beforeAll(() => {
    w = {};
    global.window = w;
    jest.isolateModules(() => { require('../../public/place-short.js'); });
  });
  afterAll(() => { delete global.window; });

  test.each([
    ['Strada Gării 12, 555400 Copșa Mică, Jud. Sibiu, România', 'Copșa Mică'],
    ['Kossuth Lajos utca 5, 4025 Debrecen, Magyarország', 'Debrecen'],
    ['Hauptstraße 3, 80331 München, Deutschland', 'München'],
    ['Sat Arcus, Cart. Poiana Arcusului nr. 102, 527166, jud. Covasna', 'Arcus'],
    ['Municipiul Brașov, Str. Lungă 3', 'Brașov'],
    ['Bd. Unirii 10, București, Sector 3', 'București'],
    ['Budapest, Váci út 12', 'Budapest'],
    ['Satu Mare', 'Satu Mare'],
    ['Sfântu Gheorghe 520008', 'Sfântu Gheorghe'],
    ['Jud. Covasna', 'Jud. Covasna'],
    ['', ''],
  ])('vsCityOf(%j) → %j', (input, city) => {
    expect(w.vsCityOf(input)).toBe(city);
  });

  test('címke: megbízó (levágva) · város → város, fuvarszám nélkül', () => {
    const s = w.vsOrderShort({ fuvar_no: 'CMD-2026-0001', client: 'TRANSPORT INTERNATIONAL EUROPA LOGISTIC SRL',
      loc_incarcare: 'Strada Gării 12, 555400 Copșa Mică, România', loc_descarcare: 'Arad' });
    expect(s).toBe('TRANSPORT INTERNATIONAL E… · Copșa Mică → Arad');
    expect(s).not.toContain('CMD-2026-0001');
  });

  test('egyező címkéknél a fuvarszám is bekerül, a többinél nem', () => {
    const l = w.vsOrderShortList([
      { fuvar_no: 'CMD-1', client: 'ALFA SRL', loc_incarcare: 'Cluj', loc_descarcare: 'Arad' },
      { fuvar_no: 'CMD-2', client: 'ALFA SRL', loc_incarcare: 'Cluj, România', loc_descarcare: 'Arad' },
      { fuvar_no: 'CMD-3', client: 'BETA SRL', loc_incarcare: 'Sibiu', loc_descarcare: 'Deva' },
    ]);
    expect(l).toEqual(['CMD-1 · ALFA SRL · Cluj → Arad', 'CMD-2 · ALFA SRL · Cluj → Arad', 'BETA SRL · Sibiu → Deva']);
  });
});
