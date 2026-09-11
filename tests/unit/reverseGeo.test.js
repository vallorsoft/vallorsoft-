// ============================================================
//  Unit-teszt — lib/reverseGeo.js (ingyenes reverse geocode)
//  A `fetch` mockolva; nincs valódi HTTP. Minden teszt-eset friss modul-
//  példányt kap (`jest.resetModules()`), hogy a modul-szintű rács-cache
//  ne szivárogjon át a tesztek között (kivéve a cache-specifikus teszteket,
//  amik SZÁNDÉKOSAN ugyanazt a modul-példányt használják).
// ============================================================

function freshReverseGeo() {
  jest.resetModules();
  return require('../../lib/reverseGeo');
}

function mockPhotonOk(address) {
  global.fetch.mockImplementationOnce(async (url) => {
    if (!String(url).includes('photon.komoot.io')) throw new Error('unexpected URL: ' + url);
    return {
      ok: true,
      json: async () => ({
        features: [{ properties: address }],
      }),
    };
  });
}
function mockPhotonEmpty() {
  global.fetch.mockImplementationOnce(async (url) => {
    if (!String(url).includes('photon.komoot.io')) throw new Error('unexpected URL: ' + url);
    return { ok: true, json: async () => ({ features: [] }) };
  });
}
function mockPhotonFail() {
  global.fetch.mockImplementationOnce(async (url) => {
    if (!String(url).includes('photon.komoot.io')) throw new Error('unexpected URL: ' + url);
    return { ok: false, json: async () => ({}) };
  });
}
function mockNominatimOk(display_name) {
  global.fetch.mockImplementationOnce(async (url) => {
    if (!String(url).includes('nominatim.openstreetmap.org')) throw new Error('unexpected URL: ' + url);
    return { ok: true, json: async () => ({ display_name }) };
  });
}
function mockNominatimEmpty() {
  global.fetch.mockImplementationOnce(async (url) => {
    if (!String(url).includes('nominatim.openstreetmap.org')) throw new Error('unexpected URL: ' + url);
    return { ok: true, json: async () => ({}) };
  });
}

describe('lib/reverseGeo', () => {
  const origFetch = global.fetch;
  beforeEach(() => {
    global.fetch = jest.fn();
  });
  afterAll(() => {
    global.fetch = origFetch;
  });

  test('érvénytelen koordináta (NaN) → null, nincs hálózati hívás', async () => {
    const { reverseGeocode } = freshReverseGeo();
    const r = await reverseGeocode('nem-szam', 'sem-az', 'ro');
    expect(r).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('tartományon kívüli koordináta (lat>90) → null, nincs hálózati hívás', async () => {
    const { reverseGeocode } = freshReverseGeo();
    const r = await reverseGeocode(120, 25, 'ro');
    expect(r).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('tartományon kívüli koordináta (lng>180) → null', async () => {
    const { reverseGeocode } = freshReverseGeo();
    const r = await reverseGeocode(45, 200, 'ro');
    expect(r).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('sikeres Photon-lekérdezés → cím összeállítva', async () => {
    const { reverseGeocode } = freshReverseGeo();
    mockPhotonOk({ name: 'Piața Unirii', street: 'Bulevardul Unirii', city: 'Cluj-Napoca', country: 'România' });
    const r = await reverseGeocode(46.77, 23.59, 'ro');
    expect(r).not.toBeNull();
    expect(r.address).toContain('Cluj-Napoca');
    expect(r.address).toContain('România');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('Photon üres találat → Nominatim fallback', async () => {
    const { reverseGeocode } = freshReverseGeo();
    mockPhotonEmpty();
    mockNominatimOk('Strada Exemplu 5, Cluj-Napoca, România');
    const r = await reverseGeocode(46.77, 23.59, 'ro');
    expect(r).toEqual({ address: 'Strada Exemplu 5, Cluj-Napoca, România' });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('Photon hibás válasz (!ok) → Nominatim fallback', async () => {
    const { reverseGeocode } = freshReverseGeo();
    mockPhotonFail();
    mockNominatimOk('Fallback cím');
    const r = await reverseGeocode(46.77, 23.59, 'ro');
    expect(r).toEqual({ address: 'Fallback cím' });
  });

  test('mindkét provider üres/hibás → null', async () => {
    const { reverseGeocode } = freshReverseGeo();
    mockPhotonEmpty();
    mockNominatimEmpty();
    const r = await reverseGeocode(46.77, 23.59, 'ro');
    expect(r).toBeNull();
  });

  test('mindkét provider hálózati hibát dob → null (nem crash)', async () => {
    const { reverseGeocode } = freshReverseGeo();
    global.fetch.mockImplementationOnce(async () => { throw new Error('network down'); });
    global.fetch.mockImplementationOnce(async () => { throw new Error('network down'); });
    const r = await reverseGeocode(46.77, 23.59, 'ro');
    expect(r).toBeNull();
  });

  test('city fallback: town/village használva ha nincs city', async () => {
    const { reverseGeocode } = freshReverseGeo();
    mockPhotonOk({ village: 'Kis Falu', country: 'România' });
    const r = await reverseGeocode(46.5, 23.1, 'ro');
    expect(r.address).toContain('Kis Falu');
  });

  test('name === city esetén nem duplikálja a nevet', async () => {
    const { reverseGeocode } = freshReverseGeo();
    mockPhotonOk({ name: 'Cluj-Napoca', city: 'Cluj-Napoca', country: 'România' });
    const r = await reverseGeocode(46.77, 23.59, 'ro');
    // A "Cluj-Napoca" csak egyszer szerepeljen
    const occurrences = (r.address.match(/Cluj-Napoca/g) || []).length;
    expect(occurrences).toBe(1);
  });

  test('teljesen üres properties (Photon) → null cím (nincs crash)', async () => {
    const { reverseGeocode } = freshReverseGeo();
    global.fetch.mockImplementationOnce(async () => ({ ok: true, json: async () => ({ features: [{ properties: {} }] }) }));
    mockNominatimEmpty();
    const r = await reverseGeocode(46.77, 23.59, 'ro');
    expect(r).toBeNull();
  });

  // ── Rács-alapú cache ──────────────────────────────────────
  describe('cache (rács-alapú, ugyanaz a modul-példány)', () => {
    test('ugyanaz a (kerekített) koordináta MÁSODSZOR NEM indít új hálózati hívást', async () => {
      const { reverseGeocode } = freshReverseGeo();
      mockPhotonOk({ city: 'Brașov', country: 'România' });
      const r1 = await reverseGeocode(45.6579, 25.6012, 'ro');
      expect(r1.address).toContain('Brașov');
      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Nagyon közeli koordináta (ugyanabba a ~1.1 km-es rács-cellába esik) —
      // NEM indít új hívást, a cache-elt választ adja vissza.
      const r2 = await reverseGeocode(45.6580, 25.6013, 'ro');
      expect(r2).toEqual(r1);
      expect(global.fetch).toHaveBeenCalledTimes(1); // még mindig csak 1
    });

    test('jelentősen eltérő koordináta → új hálózati hívás (más rács-cella)', async () => {
      const { reverseGeocode } = freshReverseGeo();
      mockPhotonOk({ city: 'Brașov', country: 'România' });
      await reverseGeocode(45.65, 25.60, 'ro');
      expect(global.fetch).toHaveBeenCalledTimes(1);

      mockPhotonOk({ city: 'Cluj-Napoca', country: 'România' });
      const r2 = await reverseGeocode(46.77, 23.59, 'ro'); // ~150 km arrébb
      expect(r2.address).toContain('Cluj-Napoca');
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    test('eltérő `lang` paraméter külön cache-kulcsot kap', async () => {
      const { reverseGeocode } = freshReverseGeo();
      mockPhotonOk({ city: 'Brașov', country: 'România' });
      await reverseGeocode(45.65, 25.60, 'ro');
      expect(global.fetch).toHaveBeenCalledTimes(1);

      mockPhotonOk({ city: 'Brassó', country: 'Románia' });
      const r2 = await reverseGeocode(45.65, 25.60, 'hu');
      expect(global.fetch).toHaveBeenCalledTimes(2); // nem a RO cache-ből jött
      expect(r2.address).toContain('Brassó');
    });
  });
});
