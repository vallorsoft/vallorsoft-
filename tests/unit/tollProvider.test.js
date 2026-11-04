// ============================================================
//  lib/tollProvider — HERE toll-parser (hálózat nélkül)
// ============================================================
const tp = require('../../lib/tollProvider');

describe('lib/tollProvider.parseHereToll', () => {
  test('tollonként a LEGOLCSÓBB fare, országonként összegezve', () => {
    const data = { routes: [{ sections: [
      { tolls: [
        { countryCode: 'ROU', fares: [{ price: { value: '10.5', currency: 'EUR' } }, { price: { value: '12', currency: 'EUR' } }] },
        { countryCode: 'HUN', fares: [{ price: { value: '8', currency: 'EUR' } }] },
      ] },
      { tolls: [
        { countryCode: 'ROU', fares: [{ price: { value: '5', currency: 'EUR' } }] },
      ] },
    ] }] };
    const r = tp.parseHereToll(data);
    expect(r.total).toBe(23.5);                 // ROU 10.5+5 + HUN 8
    expect(r.currency).toBe('EUR');
    expect(r.source).toBe('here');
    expect(r.breakdown.find((b) => b.country === 'ROU').cost).toBe(15.5);
    expect(r.breakdown.find((b) => b.country === 'HUN').cost).toBe(8);
  });

  test('nincs toll / üres válasz → 0', () => {
    expect(tp.parseHereToll({ routes: [{ sections: [{}] }] }).total).toBe(0);
    expect(tp.parseHereToll({}).total).toBe(0);
    expect(tp.parseHereToll(null).total).toBe(0);
  });
});

describe('lib/tollProvider.hereToll őrök (hálózat nélkül dobnak)', () => {
  test('kevesebb mint 2 koordináta → hiba', async () => {
    await expect(tp.hereToll([{ lat: 1, lng: 1 }], 'kulcs')).rejects.toThrow();
  });
  test('hiányzó kulcs → hiba', async () => {
    await expect(tp.hereToll([{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }], '')).rejects.toThrow();
  });
});

describe('lib/tollProvider — pass/matrica és convertedPrice', () => {
  test('a csak-pass toll külön listába megy, a total-ba nem', () => {
    const data = { routes: [{ sections: [{ summary: { length: 123400 }, tolls: [
      { countryCode: 'ROU', tollSystem: 'Rovinieta', fares: [{ pass: { validityPeriod: {} }, price: { value: 9, currency: 'EUR' } }] },
      { countryCode: 'HUN', fares: [
        { price: { value: 3000, currency: 'HUF' }, convertedPrice: { value: 7.5, currency: 'EUR' } },
        { pass: {}, price: { value: 1, currency: 'EUR' } },
      ] },
    ] }] }] };
    const r = tp.parseHereToll(data);
    expect(r.total).toBe(7.5);
    expect(r.breakdown).toEqual([{ country: 'HUN', cost: 7.5 }]);
    expect(r.passes).toEqual([{ country: 'ROU', name: 'Rovinieta', cost: 9, currency: 'EUR' }]);
    expect(r.km).toBe(123.4);
  });
});

describe('lib/tollProvider — kamion-paraméterek', () => {
  test('alap = útvonaltervező szerelvény; jármű ← kézi bevitel felülír', () => {
    const veh = tp.truckFromVehicle({ weight_kg: 36000, height_cm: null, axle_count: 4, emission_class: 'euro6' });
    const t = tp.mergeTruck(veh, { height: '390', axleCount: '' });
    expect(t).toEqual({ grossWeight: 36000, height: 390, length: 1650, width: 255, weightPerAxle: 11500,
      axleCount: 4, trailerCount: 1, emissionClass: 'EURO6' });
  });
  test('vontatónál a DB-alapértelmezett 2 tengely / 0 pótkocsi nem írja felül a szerelvény-alapot', () => {
    const t = tp.mergeTruck(tp.truckFromVehicle({ tip: 'Vontato', axle_count: 2, trailer_count: 0 }));
    expect(t.axleCount).toBe(5);
    expect(t.trailerCount).toBe(1);
    const s = tp.mergeTruck(tp.truckFromVehicle({ tip: 'Vontato', axle_count: 6, trailer_count: 1 }));
    expect(s.axleCount).toBe(6);
  });
  test('tartományon kívüli érték az alapra esik vissza', () => {
    expect(tp.mergeTruck({ grossWeight: 999999, emissionClass: 'EURO9' }).grossWeight).toBe(40000);
    expect(tp.mergeTruck({ emissionClass: 'EURO9' }).emissionClass).toBeNull();
  });
  test('truckQuery: a planHere nevei + tolls[emissionType]', () => {
    const q = tp.truckQuery(tp.mergeTruck({ emissionClass: 'EURO5' }));
    expect(q).toContain('vehicle[grossWeight]=40000');
    expect(q).toContain('vehicle[axleCount]=5');
    expect(q).toContain('tolls[emissionType]=euro5');
  });
});

describe('lib/tollProvider.thinTrace', () => {
  test('álló pontok kiesnek, az utolsó pont megmarad', () => {
    const pts = [];
    for (let i = 0; i < 50; i++) pts.push([1000 + i, 45, 25, 0]);            // egy helyben
    for (let i = 1; i <= 100; i++) pts.push([2000 + i, 45 + i * 0.0005, 25, 80]); // ~55 m-es lépések
    const t = tp.thinTrace(pts, { stepM: 150 });
    expect(t[0]).toEqual({ t: 1000, lat: 45, lng: 25 });
    expect(t[t.length - 1].t).toBe(2100);
    expect(t.length).toBeGreaterThan(30);   // 100 lépés × 55 m → kb. minden 3. pont marad
    expect(t.length).toBeLessThan(40);
  });
  test('maxPoints felett nő a lépés', () => {
    const pts = [];
    for (let i = 0; i < 2000; i++) pts.push([i, 45 + i * 0.002, 25]);
    expect(tp.thinTrace(pts, { stepM: 150, maxPoints: 100 }).length).toBeLessThanOrEqual(100);
  });
});

describe('lib/tollProvider.hereTollFromTrace (ál-fetch)', () => {
  const line = (n) => Array.from({ length: n }, (_, i) => [1767225600 + i * 60, 45 + i * 0.01, 25]);
  const ok = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  const tollResp = (v) => ({ routes: [{ sections: [{ summary: { length: 10000 }, tolls: [{ countryCode: 'HUN', fares: [{ price: { value: v, currency: 'EUR' } }] }] }] }] });

  test('import → routeHandle → routes/{handle}; kamion-paraméterek a második hívásban', async () => {
    const calls = [];
    const fetch = jest.fn((url, init) => {
      calls.push({ url, init });
      if (url.includes('/v8/import')) return ok({ routes: [{ routeHandle: 'H1' }] });
      return ok(tollResp(12.3));
    });
    const r = await tp.hereTollFromTrace(line(20), 'KEY', tp.mergeTruck({ emissionClass: 'EURO6' }), { fetch });
    expect(r.total).toBe(12.3);
    expect(r.calls).toBe(2);
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(calls[0].init.body).trace.length).toBeGreaterThan(1);
    expect(calls[0].url).toContain('transportMode=truck');
    expect(calls[1].url).toContain('/v8/routes/H1?');
    expect(calls[1].url).toContain('vehicle[grossWeight]=40000');
    expect(calls[1].url).toContain('tolls[emissionType]=euro6');
    expect(calls[1].url).toContain('return=summary,tolls');
  });

  test('importSplitRoute → felezve újrapróbál és összead', async () => {
    let n = 0;
    const fetch = jest.fn((url) => {
      if (url.includes('/v8/import')) {
        n++;
        if (n === 1) return ok({ notices: [{ code: 'importSplitRoute' }], routes: [] });
        return ok({ routes: [{ routeHandle: 'H' + n }] });
      }
      return ok(tollResp(5));
    });
    const r = await tp.hereTollFromTrace(line(20), 'KEY', null, { fetch });
    expect(r.total).toBe(10);
    expect(r.pieces).toBe(2);
    expect(r.calls).toBe(5);    // 1 sikertelen import + 2×(import+routes)
  });

  test('HERE HTTP-hiba → dob, a hívásszámmal', async () => {
    const fetch = jest.fn(() => Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({ title: 'Unauthorized' }) }));
    await expect(tp.hereTollFromTrace(line(5), 'KEY', null, { fetch })).rejects.toMatchObject({ message: 'Unauthorized', calls: 1 });
  });
});

describe('lib/tollProvider — sűrítés + darabolás (HERE Route Import)', () => {
  const ok = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  const tollResp = (v) => ({ routes: [{ sections: [{ summary: { length: 10000 }, tolls: [{ countryCode: 'HUN', fares: [{ price: { value: v, currency: 'EUR' } }] }] }] }] });

  test('densifyTrace: legfeljebb ~25 m-es lépések, az álló ismétlés kiesik', () => {
    const d = tp.densifyTrace([[45, 25], [45, 25], [45.01, 25]], { stepM: 25 });   // ~1,1 km
    expect(d.length).toBeGreaterThan(40);
    for (let i = 1; i < d.length; i++) {
      const dm = Math.abs(d[i].lat - d[i - 1].lat) * 111320;
      expect(dm).toBeLessThanOrEqual(26);
    }
    expect(d[d.length - 1]).toMatchObject({ lat: 45.01, lng: 25 });
  });

  test('az import a sűrített nyomvonalat kapja; az indulási idő a GPS-pontból jön', async () => {
    let body = null, url = null;
    const fetch = jest.fn((u, init) => {
      if (u.includes('/v8/import')) { body = JSON.parse(init.body); url = u; return ok({ routes: [{ routeHandle: 'H' }] }); }
      return ok(tollResp(3));
    });
    await tp.hereTollFromTrace([[1767225600, 45, 25], [1767225660, 45.01, 25]], 'K', null, { fetch });
    expect(body.trace.length).toBeGreaterThan(40);
    expect(url).toContain('departureTime=2026-01-01T00%3A00%3A00Z');
  });

  test('tartós importSplitRoute: felezés után a darabolt útvonalból számol, approx jelöléssel', async () => {
    const fetch = jest.fn((u) => {
      if (u.includes('/v8/import')) return ok({ notices: [{ code: 'importSplitRoute' }], routes: [{ routeHandle: 'HS' }] });
      return ok(tollResp(4));
    });
    const r = await tp.hereTollFromTrace([[45, 25], [45.05, 25]], 'K', null, { fetch, maxDepth: 1 });
    expect(r.approx).toBe(true);
    expect(r.total).toBe(8);                 // 2 fél × 4
    // 1 (egész, split) + 2 × [1 split + 1 import(elfogad) + 1 routes] = 7
    expect(r.calls).toBe(7);
    expect(r.notices).toContain('importSplitRoute');
  });

  test('nagy nyomvonal egymásba érő darabokban megy (maxPoints)', async () => {
    const sizes = [];
    const fetch = jest.fn((u, init) => {
      if (u.includes('/v8/import')) { sizes.push(JSON.parse(init.body).trace.length); return ok({ routes: [{ routeHandle: 'H' }] }); }
      return ok(tollResp(1));
    });
    const r = await tp.hereTollFromTrace([[45, 25], [45.05, 25]], 'K', null, { fetch, maxPoints: 100 });
    expect(sizes.length).toBeGreaterThan(1);
    sizes.forEach((n) => expect(n).toBeLessThanOrEqual(100));
    expect(r.total).toBe(sizes.length);
  });

  test('beágyazott hiba esetén a hívásszám nem duplázódik', async () => {
    let n = 0;
    const fetch = jest.fn((u) => {
      if (u.includes('/v8/import')) {
        n++;
        if (n === 1) return ok({ notices: [{ code: 'importSplitRoute' }], routes: [] });
        return Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({ title: 'Bad' }) });
      }
      return ok(tollResp(1));
    });
    await expect(tp.hereTollFromTrace([[45, 25], [45.05, 25]], 'K', null, { fetch })).rejects.toMatchObject({ calls: 2 });
  });
});
