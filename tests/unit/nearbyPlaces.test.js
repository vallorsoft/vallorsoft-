const np = require('../../lib/nearbyPlaces');

describe('nearbyPlaces', () => {
  const LAT = 45.65, LNG = 25.6;

  test('buildQuery: cégek + elnevezett utak a sugáron belül', () => {
    const q = np.buildQuery(LAT, LNG, 200);
    expect(q).toContain('around:200,45.65,25.6');
    expect(q).toContain('["highway"]["name"]');
    expect(q).toMatch(/\[~"\^\(shop\|office/);
  });

  test('parseOverpass: cégek távolság szerint, utcák külön, név nélküli kimarad', () => {
    const data = { elements: [
      { type: 'way', center: { lat: LAT + 0.001, lon: LNG }, tags: { name: 'BILKA STEEL', industrial: 'factory', 'addr:street': 'Str. Zizinului', 'addr:housenumber': '110' } },
      { type: 'node', lat: LAT + 0.0002, lon: LNG, tags: { name: 'OMV', amenity: 'fuel' } },
      { type: 'node', lat: LAT, lon: LNG, tags: { amenity: 'parking' } },
      { type: 'way', center: { lat: LAT + 0.0003, lon: LNG }, tags: { name: 'Strada Zizinului', highway: 'primary' } },
      { type: 'way', center: { lat: LAT + 0.002, lon: LNG }, tags: { name: 'Strada Zizinului', highway: 'primary' } },
    ] };
    const r = np.parseOverpass(data, LAT, LNG);
    expect(r.places.map((p) => p.name)).toEqual(['OMV', 'BILKA STEEL']);
    expect(r.places[1].street).toBe('Str. Zizinului 110');
    expect(r.places[0].kind).toBe('amenity:fuel');
    expect(r.streets).toHaveLength(1);
    expect(r.streets[0].dist).toBeLessThan(40);
  });

  test('nearby: Overpass-hívás, cache, hibánál üres lista', async () => {
    let calls = 0;
    const fetch = async () => { calls++; return { ok: true, json: async () => ({ elements: [{ type: 'node', lat: LAT, lon: LNG + 0.0001, tags: { name: 'Depozit X', building: 'warehouse' } }] }) }; };
    const r1 = await np.nearby(LAT, LNG, { fetch });
    const r2 = await np.nearby(LAT, LNG, { fetch });
    expect(r1.places[0].name).toBe('Depozit X');
    expect(r2).toBe(r1);
    expect(calls).toBe(1);
    expect(np.closestName(r1, 50)).toBe('Depozit X');
    expect(np.closestName(r1, 2)).toBeNull();
    const bad = await np.nearby(10, 10, { fetch: async () => ({ ok: false, status: 504 }) });
    expect(bad.ok).toBe(false);
    expect(bad.places).toEqual([]);
    const cold = await np.nearby(11, 11, { cacheOnly: true, fetch });
    expect(cold.ok).toBe(false);
    expect(calls).toBe(1);
    expect((await np.nearby('x', 1)).ok).toBe(false);
  });
});
