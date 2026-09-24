// ============================================================
//  VallorSoft — handlers/routeSimple.js
//  ÚJ, egyszerű útvonaltervező (2026-09-24): kiindulópont + cél
//  + tetszőleges köztespontok → útvonal + orszagonkénti km + útdíj.
//  Semmi mást nem csinál (nincs GPS/kamion-paraméter/fuvar-kötés).
//
//  Két RPC:
//   - rpAcSearch(q)      — Google-szerű európai cím-autocomplete
//                          (HERE ha van cég-kulcs → fallback Photon+Nominatim)
//   - rpPlanRoute(pts[]) — HERE Routing v8 (transportMode=car; spans=length,countryCode
//                          + return=polyline,summary,tolls). Válasz:
//                          {polyline:[[lat,lng]...], totalKm, durationMin,
//                           byCountry:[{cc,km,tollCost}], toll:{total,currency},
//                           bounds:{minLat,minLng,maxLat,maxLng}, source:'here'|'osrm'}
//                          HERE-kulcs nélkül: OSRM-fallback (csak polyline+km,
//                          nincs orszag-bontás/toll — a UI jelzi).
// ============================================================
const maps = require('../lib/mapsProvider');
const tollEstimate = require('../lib/tollEstimate');

const UA = 'VallorSoft/1.0 (utvonaltervezo)';
const TIMEOUT_MS = 20000;

async function jsonGet(url, headers) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: Object.assign({ 'User-Agent': UA }, headers || {}) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = new Error((body && (body.title || body.error)) || ('HTTP ' + res.status));
      e.status = res.status; e.body = body;
      throw e;
    }
    return body;
  } finally { clearTimeout(t); }
}

// ── Autocomplete — EURÓPAI (nem RO-biased, mint a `mapsProvider`) ────────
// A `mapsProvider.autocomplete` Photonja RO-centrikus, a Nominatimja pedig
// countrycodes=ro,hu,md,bg,rs → Karlsruhe/Wien/Milano stb. eltűnik.
// Az útvonaltervezőben teljes Európát akarunk lefedni, ezért itt saját,
// szűkítés-mentes lekérdezéseket használunk.

// A találat rangsorolása: HELYSÉG (város/település) ELSŐBBSÉGET kap az utca/házszám előtt.
// city > town > municipality > county > village > state > country > utca/házszám
const PLACE_RANK = {
  city: 1, town: 2, municipality: 3, county: 4, village: 5, region: 6, state: 7, country: 8,
};

async function _photonEuropean(q) {
  // Photon EU-centrikus bias, korlátozás NÉLKÜL.
  // 1) Először CSAK települések (osm_tag=place) — így minden Karlsruhe-jellegű
  //    keresés a valódi VÁROS találatokat adja elöl.
  // 2) Külön általános keresés is (címek/POI-k) — a városok mögé rendezve.
  // A `lang` param csak a VÁLASZ nyelvét befolyásolja — a QUERY multi-lang
  // matching (name / alt_name / name:xx) az összes OSM name-változatra
  // automatikusan megy, tehát „Bécs" → Wien, „Kolozsvár" → Cluj is működik.
  const [placeD, allD] = await Promise.all([
    jsonGet('https://photon.komoot.io/api/?q=' + encodeURIComponent(q)
      + '&limit=8&osm_tag=place&lat=50&lon=15&location_bias_scale=0.1').catch(() => ({})),
    jsonGet('https://photon.komoot.io/api/?q=' + encodeURIComponent(q)
      + '&limit=10&lat=50&lon=15&location_bias_scale=0.1').catch(() => ({})),
  ]);
  function mapFeature(f) {
    const p = f.properties || {};
    const streetAddr = [p.street, p.housenumber].filter(Boolean).join(' ');
    const isPlace = p.osm_key === 'place';
    const placeType = isPlace ? p.osm_value : null;
    const main = p.name || streetAddr || p.city || p.country || '';
    // Települési találatnál a sub tömör: „Bavaria, Germany" — nincs postcode/utca
    let sub;
    if (isPlace) {
      sub = [p.state, p.country].filter(Boolean).join(', ');
    } else {
      sub = [streetAddr && streetAddr !== main ? streetAddr : null, p.postcode, p.city, p.state, p.country].filter(Boolean).join(', ');
    }
    const label = sub ? (main + ', ' + sub) : main;
    const lat = f.geometry && f.geometry.coordinates ? f.geometry.coordinates[1] : null;
    const lng = f.geometry && f.geometry.coordinates ? f.geometry.coordinates[0] : null;
    return { label, title: main || label, lat, lng, _rank: isPlace ? (PLACE_RANK[placeType] || 9) : 20 };
  }
  const seen = new Set();
  const out = [];
  ((placeD && placeD.features) || []).concat((allD && allD.features) || []).forEach((f) => {
    const it = mapFeature(f);
    if (!it.label) return;
    const key = it.label.toLowerCase().slice(0, 80);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(it);
  });
  out.sort((a, b) => a._rank - b._rank);
  return out.map(({ _rank, ...rest }) => rest);
}

async function _nominatimEuropean(q) {
  // Nominatim korlátozás NÉLKÜL, egész Európát/világot lefedve.
  // A `class=place` sorok (settlement) elöl.
  const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=10&accept-language=en&q='
    + encodeURIComponent(q);
  const d = await jsonGet(url, { 'Accept-Language': 'en' });
  const seen = new Set();
  const out = [];
  ((Array.isArray(d) ? d : [])).forEach((it) => {
    const a = it.address || {};
    const isPlace = it.class === 'place';
    const placeType = isPlace ? it.type : null;
    const main = it.name || a.road || (it.display_name || '').split(',')[0] || '';
    const city = a.city || a.town || a.village || a.municipality || a.county || '';
    let sub;
    if (isPlace) {
      sub = [a.state, a.country].filter(Boolean).join(', ');
    } else {
      const streetAddr = a.road && a.road !== main ? [a.road, a.house_number].filter(Boolean).join(' ') : null;
      sub = [streetAddr, a.postcode, city, a.country].filter(Boolean).join(', ');
    }
    const label = [main, sub].filter(Boolean).join(', ') || it.display_name || '';
    const lat = it.lat != null ? parseFloat(it.lat) : null;
    const lng = it.lon != null ? parseFloat(it.lon) : null;
    if (!label) return;
    const key = label.toLowerCase().slice(0, 80);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ label, title: main || label, lat, lng, _rank: isPlace ? (PLACE_RANK[placeType] || 9) : 20 });
  });
  out.sort((a, b) => a._rank - b._rank);
  return out.map(({ _rank, ...rest }) => rest);
}

async function _hereAutosuggest(q, key) {
  // HERE Autosuggest — teljes Európát lefedi (bias EU-központ).
  // resultType=locality → CSAK települési találatok elsőként.
  // Külön általános autosuggest is, hogy legyen fallback címekre/POI-kra.
  // HERE Autosuggest — nincs `lang` restriction, hogy a multi-lang matchelés
  // működjön (Bécs → Wien, Kolozsvár → Cluj, Prága → Praha stb.)
  const [locD, allD] = await Promise.all([
    jsonGet('https://autosuggest.search.hereapi.com/v1/autosuggest?q=' + encodeURIComponent(q)
      + '&at=50,15&limit=8&types=area&apiKey=' + encodeURIComponent(key)).catch(() => ({})),
    jsonGet('https://autosuggest.search.hereapi.com/v1/autosuggest?q=' + encodeURIComponent(q)
      + '&at=50,15&limit=10&apiKey=' + encodeURIComponent(key)).catch(() => ({})),
  ]);
  function mapIt(it, isPlace) {
    return {
      label: (it.address && it.address.label) || it.title,
      title: it.title,
      lat: it.position ? it.position.lat : null,
      lng: it.position ? it.position.lng : null,
      _rank: isPlace ? 1 : (it.resultType === 'locality' || it.resultType === 'administrativeArea' ? 2 : 20),
    };
  }
  const seen = new Set();
  const out = [];
  ((locD && locD.items) || []).forEach((it) => {
    const m = mapIt(it, true);
    if (!m.label) return;
    const key = m.label.toLowerCase().slice(0, 80);
    if (seen.has(key)) return;
    seen.add(key); out.push(m);
  });
  ((allD && allD.items) || []).forEach((it) => {
    const m = mapIt(it, false);
    if (!m.label) return;
    const key = m.label.toLowerCase().slice(0, 80);
    if (seen.has(key)) return;
    seen.add(key); out.push(m);
  });
  out.sort((a, b) => a._rank - b._rank);
  return out.map(({ _rank, ...rest }) => rest);
}

async function rpAcSearch(req, res, args) {
  const q = String((args && args.q) || '').trim();
  if (q.length < 2) return res.json({ result: { ok: true, items: [] } });
  const cid = req.session.user.company_id;
  const bucket = [];
  const seen = new Set();
  function push(items) {
    (items || []).forEach((it) => {
      const key = (it.label || '').toLowerCase().slice(0, 80);
      if (!it.label || seen.has(key)) return;
      seen.add(key);
      bucket.push({
        label: it.label,
        title: it.title || it.label,
        lat: it.lat != null ? Number(it.lat) : null,
        lng: it.lng != null ? Number(it.lng) : null,
      });
    });
  }
  try {
    // HERE ha van cég-kulcs — a legpontosabb Európa-lefedettség
    const cfg = await maps.getConfig(cid);
    if (cfg.vendor === 'here' && cfg.key) {
      try { push(await _hereAutosuggest(q, cfg.key)); } catch (_) { /* fallback */ }
    }
    if (bucket.length < 8) {
      try { push(await _photonEuropean(q)); } catch (_) { /* fallback */ }
    }
    if (bucket.length < 5) {
      try { push(await _nominatimEuropean(q)); } catch (_) { /* fallback */ }
    }
    return res.json({ result: { ok: true, items: bucket.slice(0, 10) } });
  } catch (e) {
    return res.json({ result: { ok: false, err: 'Cautare esuata: ' + (e.message || 'necunoscut') } });
  }
}

// ── HERE Flexible Polyline dekóder (kulcs nélküli, tömör implementáció) ───
// Referencia: https://github.com/heremaps/flexible-polyline (Apache-2.0).
function decodeHereFlex(encoded) {
  const DECODE_TABLE = [
    62,-1,-1,-1,63,52,53,54,55,56,57,58,59,60,61,-1,-1,-1,-1,-1,-1,-1,
    0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,
    -1,-1,-1,-1,-1,-1,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,
  ];
  function decodeChar(c) {
    const v = c.charCodeAt(0) - 45;
    if (v < 0 || v >= DECODE_TABLE.length) return -1;
    return DECODE_TABLE[v];
  }
  function decodeUnsignedVarint(chars, idx) {
    let result = 0n; let shift = 0n;
    while (idx.i < chars.length) {
      const b = BigInt(decodeChar(chars[idx.i])); idx.i++;
      result |= (b & 0x1Fn) << shift;
      if ((b & 0x20n) === 0n) return result;
      shift += 5n;
    }
    return result;
  }
  function decodeSignedVarint(chars, idx) {
    const r = decodeUnsignedVarint(chars, idx);
    if ((r & 1n) !== 0n) return -((r >> 1n) + 1n);
    return r >> 1n;
  }
  const idx = { i: 0 };
  // header: version (5 bit varint), then value = (precision << 4) | (thirdDim << 1) | thirdDimPrecision? — parse a header word.
  const version = decodeUnsignedVarint(encoded, idx);
  if (version !== 1n) throw new Error('flex-poly-version');
  const val = decodeUnsignedVarint(encoded, idx);
  const precision = Number(val & 15n);
  const thirdDim = Number((val >> 4n) & 7n);
  const thirdDimPrec = Number((val >> 7n) & 15n);
  const factor = Math.pow(10, precision);
  const factor3 = Math.pow(10, thirdDimPrec);
  let lat = 0n, lng = 0n, z = 0n;
  const pts = [];
  while (idx.i < encoded.length) {
    lat += decodeSignedVarint(encoded, idx);
    lng += decodeSignedVarint(encoded, idx);
    if (thirdDim) z += decodeSignedVarint(encoded, idx);
    pts.push([Number(lat) / factor, Number(lng) / factor]);
  }
  return pts;
  // (factor3/z használatlan — 2D-t adunk vissza a Leaflet-nek)
}

// Haversine távolság (méter) két lat/lng pont között
function haversine(a, b) {
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// ── HERE Routing v8 ───────────────────────────────────────────────────────
async function planHere(waypoints, key) {
  const origin = waypoints[0].lat + ',' + waypoints[0].lng;
  const destination = waypoints[waypoints.length - 1].lat + ',' + waypoints[waypoints.length - 1].lng;
  const via = waypoints.slice(1, -1).map((w) => 'via=' + w.lat + ',' + w.lng).join('&');
  const url = 'https://router.hereapi.com/v8/routes?transportMode=car'
    + '&origin=' + encodeURIComponent(origin)
    + '&destination=' + encodeURIComponent(destination)
    + (via ? '&' + via : '')
    + '&return=polyline,summary,tolls'
    + '&spans=length,countryCode'
    + '&currency=EUR&apikey=' + encodeURIComponent(key);
  const data = await jsonGet(url);
  const route = data.routes && data.routes[0];
  if (!route) throw new Error('HERE eroare: nu s-a returnat un traseu');

  const allPoints = [];
  const kmByCountry = {}; // cc -> meter
  let totalDurationSec = 0;

  (route.sections || []).forEach((sec) => {
    const secPts = sec.polyline ? decodeHereFlex(sec.polyline) : [];
    // Ne duplikáljuk a szakasz-határon a közös pontot
    if (allPoints.length && secPts.length) secPts.shift();
    const baseOffset = allPoints.length; // az utolsó szakasz kezdete a globális tömbben
    secPts.forEach((p) => allPoints.push(p));
    if (sec.summary) {
      totalDurationSec += Number(sec.summary.duration || 0);
    }
    // spans: [{offset, length?, countryCode}, ...] — az offset a szakaszon belüli.
    // Ha nincs spans (vagy nincs country-cc), fallback: a szakasz teljes hossza egyetlen ismeretlen országhoz.
    const spans = Array.isArray(sec.spans) ? sec.spans : [];
    if (spans.length && spans.some((s) => s.countryCode)) {
      for (let i = 0; i < spans.length; i++) {
        const cc = spans[i].countryCode || '??';
        // Az adott span globális pont-tartománya:
        const localStart = Number(spans[i].offset || 0);
        const localEnd = i + 1 < spans.length ? Number(spans[i + 1].offset || 0) : (secPts.length + (allPoints.length && secPts.length ? 1 : 0));
        // A duplikáció miatt (első pontot levágtuk) a globális index eltolódik.
        // A `secPts` a levágás UTÁNI tömb; az eredeti offset a HERE-poly UTÁN érvényes.
        // Egyszerűsítés: a spans offsetjeit közvetlenül a `secPts.original`-hoz kötjük.
        // Ehhez szükségünk lenne a levágás nélküli tömbre. Újradekódolás.
        const raw = decodeHereFlex(sec.polyline);
        const a = Math.max(0, Math.min(raw.length - 1, Number(spans[i].offset || 0)));
        const b = Math.max(a, Math.min(raw.length - 1, i + 1 < spans.length ? Number(spans[i + 1].offset || raw.length - 1) : raw.length - 1));
        let dist = 0;
        for (let k = a; k < b; k++) dist += haversine(raw[k], raw[k + 1]);
        kmByCountry[cc] = (kmByCountry[cc] || 0) + dist;
      }
    } else if (sec.summary && sec.summary.length) {
      const cc = '??';
      kmByCountry[cc] = (kmByCountry[cc] || 0) + Number(sec.summary.length || 0);
    }
    // Elkerüljük a mellékhatást: baseOffset itt informatív, de nem használjuk.
    void baseOffset;
  });

  // Útdíj: közös parser (tollProvider.parseHereToll)
  let tollTotal = 0, tollCurrency = 'EUR';
  const tollByCountry = {};
  (route.sections || []).forEach((sec) => {
    (sec.tolls || []).forEach((toll) => {
      const fares = toll.fares || [];
      if (!fares.length) return;
      let best = null;
      fares.forEach((f) => {
        const v = f.price && f.price.value != null ? parseFloat(f.price.value) : 0;
        if (f.price && f.price.currency) tollCurrency = f.price.currency;
        if (best == null || v < best) best = v;
      });
      const cost = best || 0;
      tollTotal += cost;
      const cc = toll.countryCode || '??';
      tollByCountry[cc] = (tollByCountry[cc] || 0) + cost;
    });
  });

  const totalMeters = Object.values(kmByCountry).reduce((s, m) => s + m, 0);
  const byCountry = Object.keys(kmByCountry).sort((a, b) => kmByCountry[b] - kmByCountry[a]).map((cc) => ({
    cc,
    km: Math.round((kmByCountry[cc] / 1000) * 10) / 10,
    tollCost: Math.round((tollByCountry[cc] || 0) * 100) / 100,
  }));
  const bounds = computeBounds(allPoints);
  return {
    polyline: allPoints,
    totalKm: Math.round((totalMeters / 1000) * 10) / 10,
    durationMin: Math.round(totalDurationSec / 60),
    byCountry,
    toll: { total: Math.round(tollTotal * 100) / 100, currency: tollCurrency },
    bounds,
    source: 'here',
  };
}

// ── OSRM fallback + a cég toll_rates ráta táblájából útdíj-becslés ────────
// (mint a fuvar-kiírásban — orszagonkénti €/km vagy vignette a
// `toll_rates` táblából, alapértékek `DEFAULT_RATES`-ből)
async function planOsrm(waypoints, companyId) {
  const coords = waypoints.map((w) => w.lng + ',' + w.lat).join(';');
  const url = 'https://router.project-osrm.org/route/v1/driving/' + coords + '?overview=full&geometries=geojson';
  const data = await jsonGet(url);
  const route = data.routes && data.routes[0];
  if (!route) throw new Error('OSRM eroare: nu s-a returnat un traseu');
  const points = (route.geometry.coordinates || []).map((c) => [c[1], c[0]]);
  const bounds = computeBounds(points);

  // Ország-bontás + útdíj a saját ráta-táblából (Photon reverse + toll_rates).
  let byCountry = [];
  let tollTotal = 0;
  try {
    const est = await tollEstimate.estimateFromPolyline(companyId, points);
    // Az est.byCountry mezői: {cc, name, km, mode, cost}. A UI byCountry-alakja: {cc, km, tollCost}
    byCountry = (est.byCountry || []).map((r) => ({ cc: r.cc, km: Math.round(r.km * 10) / 10, tollCost: r.cost, mode: r.mode }));
    tollTotal = est.total || 0;
  } catch (_) { /* ha a reverse-geokód nem elérhető, üres marad */ }

  return {
    polyline: points,
    totalKm: Math.round(((route.distance || 0) / 1000) * 10) / 10,
    durationMin: Math.round((route.duration || 0) / 60),
    byCountry,
    toll: { total: Math.round(tollTotal * 100) / 100, currency: 'EUR' },
    bounds,
    source: 'osrm',
  };
}

function computeBounds(points) {
  if (!points.length) return null;
  let minLat = points[0][0], maxLat = points[0][0], minLng = points[0][1], maxLng = points[0][1];
  points.forEach((p) => {
    if (p[0] < minLat) minLat = p[0]; else if (p[0] > maxLat) maxLat = p[0];
    if (p[1] < minLng) minLng = p[1]; else if (p[1] > maxLng) maxLng = p[1];
  });
  return { minLat, maxLat, minLng, maxLng };
}

// ── FŐ RPC: rpPlanRoute ──────────────────────────────────────────────────
async function rpPlanRoute(req, res, args) {
  try {
    const raw = Array.isArray(args && args.waypoints) ? args.waypoints : [];
    const cid = req.session.user.company_id;
    // Geokódolás cím → koordináta (ha nem jött koordináta a klienstől)
    const pts = [];
    for (let i = 0; i < raw.length; i++) {
      const w = raw[i] || {};
      const lat = w.lat != null ? Number(w.lat) : null;
      const lng = w.lng != null ? Number(w.lng) : null;
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        pts.push({ lat, lng, label: String(w.label || '').slice(0, 200) });
        continue;
      }
      const addr = String(w.label || w.address || '').trim();
      if (!addr) return res.json({ result: { ok: false, err: 'Punctul #' + (i + 1) + ' este gol.' } });
      const g = await maps.geocode(cid, addr);
      pts.push({ lat: g.lat, lng: g.lng, label: g.label || addr });
    }
    if (pts.length < 2) return res.json({ result: { ok: false, err: 'Sunt necesare cel putin 2 puncte.' } });
    if (pts.length > 25) return res.json({ result: { ok: false, err: 'Prea multe puncte (max. 25).' } });

    const cfg = await maps.getConfig(cid);
    if (cfg.vendor === 'here' && cfg.key) {
      try {
        const r = await planHere(pts, cfg.key);
        return res.json({ result: { ok: true, ...r, waypoints: pts } });
      } catch (e) {
        // HERE nem elérhető → OSRM-fallback + jelzés a UI-nak
        const r = await planOsrm(pts, cid).catch(() => null);
        if (r) return res.json({ result: { ok: true, ...r, waypoints: pts, hereError: e.message || 'HERE nedisponibil' } });
        return res.json({ result: { ok: false, err: 'HERE eroare: ' + (e.message || 'necunoscut') } });
      }
    }
    // Nincs HERE-kulcs → OSRM + saját toll_rates-alapú útdíj-becslés
    const r = await planOsrm(pts, cid);
    return res.json({ result: { ok: true, ...r, waypoints: pts, noHereKey: true } });
  } catch (e) {
    return res.json({ result: { ok: false, err: e.message || 'Eroare de server' } });
  }
}

module.exports = { rpAcSearch, rpPlanRoute };
