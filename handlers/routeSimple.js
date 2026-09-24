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
const pool = require('../db');
const maps = require('../lib/mapsProvider');
const tollEstimate = require('../lib/tollEstimate');
// Hivatalos HERE flexible polyline dekóder (a project dep-je: `@here/flexpolyline`).
// A saját, kézzel írt varint-dekóderünk némely HERE-válaszra `flex-poly-version`
// hibát dobott (a header-formátum árnyalatait nem fedte le), ezért a hivatalos
// implementációra váltunk. `decode(str) → { polyline: [[lat,lng,z?], ...], … }`.
const flexPoly = require('@here/flexpolyline');

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
  // Európa-lefedő bbox — a Photon a világon bárhonnan visszaadhat találatot;
  // itt kliens-oldali szűréssel EU-ra korlátozzuk (west=-25, south=34, east=45, north=71).
  function inEurope(lat, lng) {
    if (lat == null || lng == null) return false;
    return lat >= 34 && lat <= 71 && lng >= -25 && lng <= 45;
  }
  const seen = new Set();
  const out = [];
  ((placeD && placeD.features) || []).concat((allD && allD.features) || []).forEach((f) => {
    const it = mapFeature(f);
    if (!it.label) return;
    if (!inEurope(it.lat, it.lng)) return; // Amerika / Ázsia / Afrika / Óceánia kimarad
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
  // Európa országainak ISO2 kódjai — a keresés kizárólag európai eredményeket ad.
  const EU_CC = 'al,ad,at,ba,be,bg,by,ch,cy,cz,de,dk,ee,es,fi,fo,fr,gb,ge,gr,hr,hu,ie,is,it,li,lt,lu,lv,md,me,mk,mt,nl,no,pl,pt,ro,rs,ru,se,si,sk,sm,tr,ua,va';
  const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=10&accept-language=en&countrycodes='
    + EU_CC + '&q=' + encodeURIComponent(q);
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
  // HERE hármas keresés párhuzamosan — teljes Európát lefedi (EU-központ bias):
  //   1. Autosuggest types=area  → csak települések (Wien/Cluj/Karlsruhe)
  //   2. Autosuggest általános   → cím + POI vegyes találat
  //   3. Discover                → BEJEGYZETT CÉGEK / POI-k (Kaufland, MOL,
  //      Shell, McDonald's, DHL-terminálok stb. — mint a Google Places)
  // Nincs `lang` restriction → a multi-lang matchelés (Bécs → Wien) automatikus.
  // EURÓPA-CSAK — HERE `in=bbox:west,south,east,north` szűrő.
  // Európa lefedő bounding box: Izland/Azori-szigetek ↔ Nordkapp ↔ Ural.
  //   west  -25° (Azori)   south 34° (Ciprus/Málta)
  //   east   45° (Ural)    north 71° (Nordkapp)
  const EU_BBOX = '-25,34,45,71';
  const [locD, allD, discD] = await Promise.all([
    jsonGet('https://autosuggest.search.hereapi.com/v1/autosuggest?q=' + encodeURIComponent(q)
      + '&at=50,15&in=bbox:' + EU_BBOX + '&limit=6&types=area&apiKey=' + encodeURIComponent(key)).catch(() => ({})),
    jsonGet('https://autosuggest.search.hereapi.com/v1/autosuggest?q=' + encodeURIComponent(q)
      + '&at=50,15&in=bbox:' + EU_BBOX + '&limit=6&apiKey=' + encodeURIComponent(key)).catch(() => ({})),
    jsonGet('https://discover.search.hereapi.com/v1/discover?q=' + encodeURIComponent(q)
      + '&at=50,15&in=bbox:' + EU_BBOX + '&limit=8&apiKey=' + encodeURIComponent(key)).catch(() => ({})),
  ]);

  // Rangsor: (1) települési találat elöl (city/town), (2) POI/cég (Discover
  // categories mezővel — ipari, tankoló, üzlet), (3) egyéb cím.
  //   - `resultType`: 'locality' | 'administrativeArea' | 'place' | 'houseNumber' | 'street'
  //   - `categories`: a Discover ad ilyen tömböt — jelenléte = bejegyzett hely
  function rankFor(it) {
    var rt = it.resultType || '';
    var hasCat = Array.isArray(it.categories) && it.categories.length;
    if (rt === 'locality' || rt === 'administrativeArea') return 1;  // város-találat
    if (hasCat) return 2;                                            // bejegyzett cég/POI
    if (rt === 'place') return 3;                                    // egyéb POI (autosuggest)
    return 20;                                                       // cím / utca
  }
  function mapIt(it) {
    var label = (it.address && it.address.label) || it.title || '';
    var title = it.title || label;
    // Discover-nél a title jellemzően a cég neve; az address.label a valódi cím.
    // Ha van kategória (bejegyzett hely), a title mellé egy kategória-hint is jó.
    var catHint = null;
    if (Array.isArray(it.categories) && it.categories.length) {
      var c = it.categories[0];
      catHint = (c && (c.name || c.id)) || null;
    }
    return {
      label: label,
      title: title,
      lat: it.position ? it.position.lat : null,
      lng: it.position ? it.position.lng : null,
      catHint: catHint,
      _rank: rankFor(it),
    };
  }

  var seen = new Set();
  var out = [];
  function push(items) {
    (items || []).forEach(function (it) {
      var m = mapIt(it);
      if (!m.label) return;
      // Kulcs: label + kb. koordináta — így az azonos hely, különböző API-kból
      // származó duplikációja kiesik. (Autosuggest + Discover ugyanazt a
      // Kaufland-boltot mindkét helyről visszahozhatja.)
      var k = m.label.toLowerCase().slice(0, 80)
        + '|' + (m.lat != null ? m.lat.toFixed(3) : '')
        + '|' + (m.lng != null ? m.lng.toFixed(3) : '');
      if (seen.has(k)) return;
      seen.add(k);
      out.push(m);
    });
  }
  push((locD && locD.items) || []);
  push((discD && discD.items) || []);
  push((allD && allD.items) || []);
  out.sort(function (a, b) { return a._rank - b._rank; });
  return out.map(function (o) { var c = Object.assign({}, o); delete c._rank; return c; });
}

// ── Server-side keresés-cache (in-memory LRU, kb. 10 perc TTL) ─────────────
// A tervezés közben a felhasználó jellemzően EGY karakterrel bővíti a
// keresést, így ugyanaz a query előbb-utóbb vissza-visszajön. A cache
// megtakarít 3 HTTP-hívást (HERE + Photon + Nominatim).
const _acCache = new Map(); // key: cid + '|' + q(normalized) -> { ts, items }
const AC_TTL_MS = 10 * 60 * 1000;
const AC_MAX = 500;
function _acCacheGet(key) {
  const e = _acCache.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > AC_TTL_MS) { _acCache.delete(key); return null; }
  // LRU: a friss elemet a Map végére tesszük
  _acCache.delete(key); _acCache.set(key, e);
  return e.items;
}
function _acCacheSet(key, items) {
  _acCache.set(key, { ts: Date.now(), items });
  if (_acCache.size > AC_MAX) {
    const first = _acCache.keys().next().value;
    if (first != null) _acCache.delete(first);
  }
}

// ── Tanult sorok lekérdezése — cégenkénti prefix-match a `route_search_learn`-ből
// Rangsor: gyakoriság (pick_count) + frissesség (last_used_at) — sűrűn használt
// és nemrég használt címek legelöl.
async function _fetchLearned(cid, qNorm) {
  if (!cid || !qNorm) return [];
  try {
    // Exponenciális avulás: 30 napos „félelezés". A pick_count szorzódik a
    // (1 / (1 + napok / 30)) faktorral, hogy a frissebb pick-ek jobban rangsoroljanak.
    const r = await pool.query(
      `SELECT label, title, lat, lng, cat_hint, pick_count, last_used_at,
              pick_count * 1.0 / (1.0 + EXTRACT(EPOCH FROM (NOW() - last_used_at)) / (30 * 86400.0)) AS score
       FROM route_search_learn
       WHERE company_id = $1 AND query_norm LIKE $2 || '%'
       ORDER BY score DESC, last_used_at DESC
       LIMIT 5`,
      [cid, qNorm]);
    return r.rows.map((row) => ({
      label: row.label,
      title: row.title || row.label,
      lat: row.lat != null ? Number(row.lat) : null,
      lng: row.lng != null ? Number(row.lng) : null,
      catHint: row.cat_hint || null,
      _learned: true,
      _pickCount: row.pick_count,
    }));
  } catch (_) {
    return []; // migráció nélkül csendben üres marad
  }
}

async function rpAcSearch(req, res, args) {
  const q = String((args && args.q) || '').trim();
  if (q.length < 2) return res.json({ result: { ok: true, items: [] } });
  const cid = req.session.user.company_id;
  const key = cid + '|' + q.toLowerCase();
  const cached = _acCacheGet(key);
  if (cached) return res.json({ result: { ok: true, items: cached, cached: true } });

  const bucket = [];
  const seen = new Set();
  function push(items) {
    (items || []).forEach((it) => {
      const k = (it.label || '').toLowerCase().slice(0, 80);
      if (!it.label || seen.has(k)) return;
      seen.add(k);
      bucket.push({
        label: it.label,
        title: it.title || it.label,
        lat: it.lat != null ? Number(it.lat) : null,
        lng: it.lng != null ? Number(it.lng) : null,
        // Bejegyzett hely (Discover) kategória-hintje, ha van — a UI kis
        // pilulaként mutatja, hogy azonnal látszódjon: „🏢 Kaufland" nem cím.
        catHint: it.catHint || null,
        // Tanult sorok esetén tovább visszük a jelzést + a pick-számot,
        // a UI kis „⭐ N×" pilulával jelöli, hány cégen belüli kollega
        // pickelte már ezt a helyet ugyanerre a query-re.
        _learned: it._learned || false,
        _pickCount: it._pickCount || null,
      });
    });
  }
  try {
    // 1. LÉPÉS — Tanult sorok elsőként. Nem várunk a HERE-re, ha van
    // erős pick-history a query prefixére, az azonnal megjelenik legelöl.
    push(await _fetchLearned(cid, q.toLowerCase()));
    // Ha van HERE-kulcs, azt kizárólag használjuk (leggyorsabb + legpontosabb).
    // A Photon/Nominatim csak akkor jön, ha a HERE nem ad eleget.
    const cfg = await maps.getConfig(cid);
    if (cfg.vendor === 'here' && cfg.key) {
      try {
        push(await _hereAutosuggest(q, cfg.key));
      } catch (_) { /* fallback jön alább */ }
      if (bucket.length >= 5) {
        const out = bucket.slice(0, 10);
        _acCacheSet(key, out);
        return res.json({ result: { ok: true, items: out } });
      }
    }
    // HERE nélkül (vagy elégtelen HERE-találat esetén): Photon + Nominatim párhuzamosan.
    // A `Promise.all` felezi a latenciát az eddigi soros hívásokhoz képest.
    const [pR, nR] = await Promise.allSettled([_photonEuropean(q), _nominatimEuropean(q)]);
    if (pR.status === 'fulfilled') push(pR.value);
    if (nR.status === 'fulfilled' && bucket.length < 8) push(nR.value);
    const out = bucket.slice(0, 10);
    _acCacheSet(key, out);
    return res.json({ result: { ok: true, items: out } });
  } catch (e) {
    return res.json({ result: { ok: false, err: 'Cautare esuata: ' + (e.message || 'necunoscut') } });
  }
}

// ── HERE Flexible Polyline dekóder — hivatalos `@here/flexpolyline` lib ─────
// A visszatérés {polyline:[[lat,lng,z?], ...], precision, thirdDim, ...}.
// A Leaflet-nek 2D [lat,lng] tömböt adunk vissza.
function decodeHereFlex(encoded) {
  const r = flexPoly.decode(encoded);
  const pts = (r && r.polyline) || [];
  // A hivatalos lib visszaadhatja 3D-vel (thirdDim), de nekünk elég a 2D.
  return pts.map((p) => [p[0], p[1]]);
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
// A `truck` opció: `{grossWeight:kg, height:cm, length:cm, width:cm,
// weightPerAxle:kg, trailerCount, axleCount}` — EU-s szerelvényre alap.
async function planHere(waypoints, key, truck) {
  const origin = waypoints[0].lat + ',' + waypoints[0].lng;
  const destination = waypoints[waypoints.length - 1].lat + ',' + waypoints[waypoints.length - 1].lng;
  const via = waypoints.slice(1, -1).map((w) => 'via=' + w.lat + ',' + w.lng).join('&');
  const mode = (truck && truck.enabled) ? 'truck' : 'car';
  let truckPart = '';
  if (mode === 'truck') {
    const p = truck || {};
    const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
    const q = [];
    // HERE v8 truck params: mind alap egységek (kg, cm)
    if (num(p.grossWeight)     != null) q.push('vehicle[grossWeight]='     + num(p.grossWeight));
    if (num(p.height)          != null) q.push('vehicle[height]='          + num(p.height));
    if (num(p.length)          != null) q.push('vehicle[length]='          + num(p.length));
    if (num(p.width)           != null) q.push('vehicle[width]='           + num(p.width));
    if (num(p.weightPerAxle)   != null) q.push('vehicle[weightPerAxle]='   + num(p.weightPerAxle));
    if (num(p.trailerCount)    != null) q.push('vehicle[trailerCount]='    + num(p.trailerCount));
    if (num(p.axleCount)       != null) q.push('vehicle[axleCount]='       + num(p.axleCount));
    if (q.length) truckPart = '&' + q.join('&');
  }
  const url = 'https://router.hereapi.com/v8/routes?transportMode=' + mode
    + '&origin=' + encodeURIComponent(origin)
    + '&destination=' + encodeURIComponent(destination)
    + (via ? '&' + via : '')
    + truckPart
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

  // Útdíj — MINDEN pénznemet EUR-ra váltunk (a HERE lokális pénznemekben ad:
  // Csehország → CZK, Lengyelország → PLN, Svájc → CHF stb.). A UI egy
  // egységes EUR-értéket vár, és a felhasználó kézzel megadhat BNR-t a RON-hoz.
  //
  // Rögzített átváltási arány EUR-ra (nagyságrendileg 2026 eleji szint —
  // az útdíj-becslés amúgy sem hatósági pontosságú, kézi felülírás mindig kell).
  const TO_EUR = {
    EUR: 1, CZK: 0.041, HUF: 0.0026, PLN: 0.23, RON: 0.20, BGN: 0.51,
    HRK: 0.132, CHF: 1.06, GBP: 1.17, DKK: 0.134, SEK: 0.088, NOK: 0.085,
    TRY: 0.028, RSD: 0.0085, USD: 0.92,
  };
  function toEur(value, cur) {
    const rate = TO_EUR[String(cur || 'EUR').toUpperCase()];
    if (rate == null) return value; // ismeretlen pénznem → nem konvertáljuk
    return value * rate;
  }
  let tollTotal = 0;
  const tollByCountry = {};
  (route.sections || []).forEach((sec) => {
    (sec.tolls || []).forEach((toll) => {
      const fares = toll.fares || [];
      if (!fares.length) return;
      let best = null; let bestCur = 'EUR';
      fares.forEach((f) => {
        const v = f.price && f.price.value != null ? parseFloat(f.price.value) : 0;
        const cur = (f.price && f.price.currency) || 'EUR';
        if (best == null || v < best) { best = v; bestCur = cur; }
      });
      const costEur = toEur(best || 0, bestCur);
      tollTotal += costEur;
      const cc = toll.countryCode || '??';
      tollByCountry[cc] = (tollByCountry[cc] || 0) + costEur;
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
    toll: { total: Math.round(tollTotal * 100) / 100, currency: 'EUR' },
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
        const r = await planHere(pts, cfg.key, (args && args.truck) || null);
        return res.json({ result: { ok: true, ...r, waypoints: pts } });
      } catch (e) {
        // HERE nem elérhető → OSRM-fallback + jelzés a UI-nak
        const r = await planOsrm(pts, cid).catch(() => null);
        if (r) return res.json({ result: { ok: true, ...r, waypoints: pts, hereError: e.message || 'HERE nedisponibil' } });
        return res.json({ result: { ok: false, err: 'HERE eroare: ' + (e.message || 'necunoscut') } });
      }
    }
    // Nincs használható HERE-kulcs → OSRM + saját toll_rates-alapú útdíj-becslés
    // (a `cfg.reason` mondja meg PONTOSAN, miért esett vissza — a UI-nak megmutatjuk)
    const r = await planOsrm(pts, cid);
    return res.json({ result: { ok: true, ...r, waypoints: pts, noHereKey: true, hereReason: cfg.reason || 'unknown' } });
  } catch (e) {
    return res.json({ result: { ok: false, err: e.message || 'Eroare de server' } });
  }
}

// ── Reverse-geokód: térkép-koppintás → cím-címke (Photon reverse, ingyenes)
async function rpReverseGeocode(req, res, args) {
  try {
    const lat = Number(args && args.lat);
    const lng = Number(args && args.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.json({ result: { ok: false, err: 'Coordonate invalide.' } });
    }
    const url = 'https://photon.komoot.io/reverse?lat=' + lat + '&lon=' + lng + '&limit=1';
    const d = await jsonGet(url).catch(() => ({}));
    const f = ((d && d.features) || [])[0];
    if (!f) return res.json({ result: { ok: true, label: lat.toFixed(4) + ', ' + lng.toFixed(4), lat, lng } });
    const p = f.properties || {};
    const streetAddr = [p.street, p.housenumber].filter(Boolean).join(' ');
    const main = p.name || streetAddr || p.city || p.country || (lat.toFixed(4) + ', ' + lng.toFixed(4));
    const sub = [streetAddr && streetAddr !== main ? streetAddr : null, p.postcode, p.city, p.state, p.country].filter(Boolean).join(', ');
    const label = sub ? (main + ', ' + sub) : main;
    return res.json({ result: { ok: true, label, lat, lng } });
  } catch (e) {
    return res.json({ result: { ok: false, err: e.message || 'Eroare' } });
  }
}

// ── Pick-rögzítés — tanuló rendszer: a felhasználó által kiválasztott
// hely az aktuális bevitt query-vel párban `route_search_learn`-be kerül.
// Legközelebb ugyanannak a prefixnek a beírásakor a hely a lista elején jön.
// Multi-tenant: minden sor a session cég-jéhez van kötve.
async function rpAcPick(req, res, args) {
  try {
    if (!req.session || !req.session.user) return res.json({ result: { ok: false, err: 'no-session' } });
    const cid = req.session.user.company_id;
    const email = (req.session.user.email || '').toLowerCase().slice(0, 254) || null;
    const q = String((args && args.q) || '').trim().toLowerCase().slice(0, 80);
    const label = String((args && args.label) || '').trim().slice(0, 500);
    if (q.length < 2 || !label) return res.json({ result: { ok: false, err: 'invalid-input' } });
    const title = args.title != null ? String(args.title).slice(0, 300) : null;
    const lat = args.lat != null && Number.isFinite(Number(args.lat)) ? Number(args.lat) : null;
    const lng = args.lng != null && Number.isFinite(Number(args.lng)) ? Number(args.lng) : null;
    const catHint = args.catHint != null ? String(args.catHint).slice(0, 120) : null;
    // UPSERT: ha a (cég, query_norm, label) hármas már van, pick_count-ot növeljük
    // és a last_used_at-et frissítjük. A user_email az utolsó pickelőé marad
    // (informatív, de nem szükséges a rangsoroláshoz).
    await pool.query(
      `INSERT INTO route_search_learn
         (company_id, user_email, query_norm, label, title, lat, lng, cat_hint, pick_count, first_used_at, last_used_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, NOW(), NOW())
       ON CONFLICT (company_id, query_norm, label)
       DO UPDATE SET
         pick_count   = route_search_learn.pick_count + 1,
         last_used_at = NOW(),
         user_email   = EXCLUDED.user_email,
         title        = COALESCE(EXCLUDED.title, route_search_learn.title),
         lat          = COALESCE(EXCLUDED.lat, route_search_learn.lat),
         lng          = COALESCE(EXCLUDED.lng, route_search_learn.lng),
         cat_hint     = COALESCE(EXCLUDED.cat_hint, route_search_learn.cat_hint)`,
      [cid, email, q, label, title, lat, lng, catHint]);
    // Cache-ürítés — a tanult sor MÁR nem szerepel a friss válaszban, ne kelljen
    // 10 percet várni a hatásra. Az _acCache prefix-alapú, ezért az EGY query kulcsot
    // dobjuk el; a rövidebb/hosszabb prefixek TTL-je maradhat.
    _acCache.delete(cid + '|' + q);
    return res.json({ result: { ok: true } });
  } catch (e) {
    // Migráció-hiány / bármi más: csendben elnyeljük — a pick nem kritikus.
    return res.json({ result: { ok: true, warn: e.message || 'noop' } });
  }
}

module.exports = { rpAcSearch, rpAcPick, rpPlanRoute, rpReverseGeocode };
