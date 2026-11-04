// ============================================================
//  VallorSoft — lib/tollProvider.js
//  Valós útdíj a HERE Routing v8-ból (transportMode=truck, return=tolls).
//  CSAK akkor hívódik, ha a cégnek van HERE-kulcsa (mapsProvider) ÉS a
//  felhasználó a „Pontos" váltót bekapcsolta. Hiba/kulcs hiánya esetén a
//  hívó visszaesik az ingyenes becslésre.
//
//  GPS-nyomvonal alapú útdíj (hereTollFromTrace): a jármű GPS-naplójának
//  pontsorát a HERE „Route Import" végpontja ráilleszti az úthálózatra
//  (POST /v8/import → routeHandle), majd a routeHandle-ről kérjük le az
//  útdíjat (GET /v8/routes/{handle}?return=tolls). Így a díj a TÉNYLEGESEN
//  megtett útra számolódik, nem egy újratervezett útvonalra.
// ============================================================

const HERE_BASE = 'https://router.hereapi.com/v8';
const TIMEOUT_MS = 25000;

// Az útvonaltervező (utvonaltervezes.html „🚛 Rută pentru camion") alap-
// szerelvénye: EU nyerges vontató + félpótkocsi, 40 t. A GPS-útdíj ugyanezt
// veszi alapul, erre jön rá a jármű saját adata, majd a kézi bevitel.
const TRUCK_DEFAULTS = Object.freeze({
  grossWeight: 40000,   // kg
  height: 400,          // cm
  length: 1650,         // cm
  width: 255,           // cm
  weightPerAxle: 11500, // kg
  axleCount: 5,
  trailerCount: 1,
  emissionClass: null,  // 'EURO6' … — a DE/AT díjat erősen befolyásolja
});

const EMISSION_CLASSES = ['EURO0', 'EURO1', 'EURO2', 'EURO3', 'EURO4', 'EURO5', 'EURO6', 'EEV'];

// Számtartományok (a hibás bevitel ne menjen ki a HERE-nek)
const RANGES = {
  grossWeight: [1000, 60000],
  height: [100, 500],
  length: [200, 3000],
  width: [100, 300],
  weightPerAxle: [500, 20000],
  axleCount: [2, 12],
  trailerCount: [0, 4],
};

function _num(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

// Bármilyen bemenetből tiszta kamion-paraméterek; a tartományon kívüli
// érték null lesz (a hívó ilyenkor az alapra esik vissza).
function normalizeTruck(p) {
  const src = p || {};
  const out = {};
  Object.keys(RANGES).forEach((k) => {
    const n = _num(src[k]);
    const [lo, hi] = RANGES[k];
    out[k] = n != null && n >= lo && n <= hi ? Math.round(n) : null;
  });
  const ec = String(src.emissionClass || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  out.emissionClass = EMISSION_CLASSES.includes(ec) ? ec : null;
  return out;
}

// Rétegek egyesítése: alap ← jármű ← kézi bevitel (csak a nem-null értékek írnak felül).
function mergeTruck(...layers) {
  const out = Object.assign({}, TRUCK_DEFAULTS);
  layers.forEach((l) => {
    const n = normalizeTruck(l);
    Object.keys(n).forEach((k) => { if (n[k] != null) out[k] = n[k]; });
  });
  return out;
}

// A `vehicles` sor kamion-mezői → paraméter-réteg (null, ami nincs megadva).
// Vontatónál a `axle_count=2` / `trailer_count=0` a DB-oszlop ALAPÉRTÉKE (nincs
// kitöltve), nem a szerelvény valós adata — ilyenkor az útvonaltervező
// szerelvény-alapja (5 tengely, 1 pótkocsi) marad érvényben.
function truckFromVehicle(v) {
  if (!v) return {};
  const tractor = v.tip === 'Vontato';
  const ax = v.axle_count != null ? Number(v.axle_count) : null;
  const tr = v.trailer_count != null ? Number(v.trailer_count) : null;
  return {
    grossWeight: v.weight_kg,
    height: v.height_cm,
    length: v.length_cm,
    width: v.width_cm,
    weightPerAxle: v.weight_per_axle_kg,
    axleCount: tractor && ax != null && ax <= 2 ? null : ax,
    trailerCount: tractor && tr === 0 ? null : tr,
    emissionClass: v.emission_class,
  };
}

// HERE v8 kamion-lekérdezés paraméterei — UGYANAZOK a nevek, mint az
// útvonaltervező planHere()-jében (handlers/routeSimple.js).
function truckQuery(p) {
  const t = p || {};
  const q = [];
  ['grossWeight', 'height', 'length', 'width', 'weightPerAxle', 'trailerCount', 'axleCount'].forEach((k) => {
    if (t[k] != null) q.push('vehicle[' + k + ']=' + encodeURIComponent(t[k]));
  });
  if (t.emissionClass && /^EURO\d$/.test(t.emissionClass)) {
    q.push('tolls[emissionType]=' + encodeURIComponent('euro' + t.emissionClass.slice(4)));
  }
  return q;
}

function _dist(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// GPS-pont bármilyen formában → {lat,lng,t?}. A gps_track_days tömör pontja:
// [t (mp), lat, lng, speed, ...]; az illesztett geometria pontja: [lat, lng].
function _pt(p) {
  if (Array.isArray(p)) {
    if (p.length === 2) return { lat: Number(p[0]), lng: Number(p[1]) };
    return { t: p[0], lat: Number(p[1]), lng: Number(p[2]) };
  }
  if (p && p.lat != null) return { t: p.t, lat: Number(p.lat), lng: Number(p.lng) };
  return null;
}

// Nyomvonal ritkítása: az egy helyben álló pontok kiesnek, és csak ~stepM
// méterenként marad pont. Ha így is túl sok, a lépést növeljük. Az utolsó
// pont mindig megmarad (a lerakó / napvég ne vesszen el).
function thinTrace(points, opts) {
  const o = Object.assign({ stepM: 150, maxPoints: 4000 }, opts || {});
  const pts = (points || []).map(_pt).filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng)
    && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 && !(p.lat === 0 && p.lng === 0));
  if (pts.length < 2) return pts;
  let step = o.stepM;
  for (let guard = 0; guard < 12; guard++) {
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      if (_dist(out[out.length - 1], pts[i]) >= step) out.push(pts[i]);
    }
    const last = pts[pts.length - 1];
    if (out[out.length - 1] !== last && _dist(out[out.length - 1], last) > 20) out.push(last);
    if (out.length <= o.maxPoints) return out;
    step *= 1.6;
  }
  return [pts[0], pts[pts.length - 1]];
}

// Egy fare ára EUR-ban (a currency=EUR kérésre a HERE `convertedPrice`-t is ad).
function _fareEur(f) {
  const cp = f && f.convertedPrice;
  if (cp && cp.value != null && String(cp.currency || '').toUpperCase() === 'EUR') {
    return { value: parseFloat(cp.value) || 0, currency: 'EUR' };
  }
  const p = (f && f.price) || {};
  return { value: p.value != null ? (parseFloat(p.value) || 0) : 0, currency: String(p.currency || 'EUR').toUpperCase() };
}

// A HERE válasz toll-szakaszaiból összegzi a díjat. Tollonként a
// LEGOLCSÓBB fizetési mód (fares) számít — a HERE több fare-t adhat
// ugyanarra a kapura (készpénz/transzponder), ezeket NEM adjuk össze.
// A bérlet/matrica (`pass`) fare-ek NEM km-alapú díjak: ha egy tollnak csak
// ilyen fare-je van, külön a `passes` listába kerül (a total-ba nem).
function parseHereToll(data) {
  let total = 0;
  let currency = 'EUR';
  const byCountry = {};
  const passes = [];
  const route = data && data.routes && data.routes[0];
  const sections = (route && route.sections) || [];
  let lengthM = 0;
  sections.forEach((sec) => {
    if (sec.summary && sec.summary.length) lengthM += Number(sec.summary.length) || 0;
    (sec.tolls || []).forEach((toll) => {
      const fares = toll.fares || [];
      if (!fares.length) return;
      const cc = toll.countryCode || '??';
      const regular = fares.filter((f) => !f.pass);
      if (!regular.length) {
        let best = null;
        fares.forEach((f) => { const p = _fareEur(f); if (best == null || p.value < best.value) best = p; });
        passes.push({
          country: cc,
          name: toll.tollSystem || (fares[0] && fares[0].name) || '',
          cost: Math.round(((best && best.value) || 0) * 100) / 100,
          currency: (best && best.currency) || 'EUR',
        });
        return;
      }
      let best = null;
      regular.forEach((f) => {
        const p = _fareEur(f);
        if (best == null || p.value < best.value) best = p;
      });
      if (best && best.currency) currency = best.currency;
      const cost = (best && best.value) || 0;
      total += cost;
      byCountry[cc] = (byCountry[cc] || 0) + cost;
    });
  });
  const breakdown = Object.keys(byCountry).map((cc) => ({ country: cc, cost: Math.round(byCountry[cc] * 100) / 100 }));
  return {
    total: Math.round(total * 100) / 100,
    currency,
    breakdown,
    passes,
    km: lengthM ? Math.round(lengthM / 100) / 10 : null,
    source: 'here',
  };
}

async function _fetchJson(fetchFn, url, init) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await fetchFn(url, Object.assign({ signal: ctrl.signal }, init || {}));
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const e = new Error((data && (data.title || data.cause)) || ('HERE eroare (' + resp.status + ')'));
      e.status = resp.status;
      throw e;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function hereToll(waypoints, key, truck) {
  const pts = (waypoints || []).filter((w) => w && w.lat != null && w.lng != null);
  if (pts.length < 2) throw new Error('insufficient-coords');
  if (!key) throw new Error('no-here-key');
  const origin = pts[0].lat + ',' + pts[0].lng;
  const destination = pts[pts.length - 1].lat + ',' + pts[pts.length - 1].lng;
  const via = pts.slice(1, -1).map((w) => 'via=' + w.lat + ',' + w.lng).join('&');
  const tq = truck ? truckQuery(truck) : [];
  const url = HERE_BASE + '/routes?transportMode=truck'
    + '&origin=' + encodeURIComponent(origin)
    + '&destination=' + encodeURIComponent(destination)
    + (via ? '&' + via : '')
    + (tq.length ? '&' + tq.join('&') : '')
    + '&return=summary,tolls&currency=EUR&apikey=' + encodeURIComponent(key);
  const data = await _fetchJson(fetch, url, { headers: { 'User-Agent': 'VallorSoft/1.0' } });
  if (!data.routes || !data.routes.length) throw new Error((data && data.title) || 'HERE eroare');
  return parseHereToll(data);
}


// Nyomvonal előkészítése a HERE Route Importhoz.
// A HERE a nyomvonalat ÚTVONAL-GEOMETRIAKÉNT kezeli, nem ritka GPS-mintaként:
// ha két pont messze van egymástól (kanyart levágó egyenes), a ráillesztés
// megszakad („importSplitRoute"). Ezért: az álló/ismétlődő pontok ki (≤5 m),
// majd a szakaszok kitöltése legfeljebb `stepM` méterenként (lineáris
// interpoláció). A legjobb bemenet a már úthálózatra illesztett geometria
// (gps_track_days.segments) — azt a handler adja át.
function densifyTrace(points, opts) {
  const o = Object.assign({ stepM: 25, minM: 5 }, opts || {});
  const pts = (points || []).map(_pt).filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng)
    && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 && !(p.lat === 0 && p.lng === 0));
  if (pts.length < 2) return pts;
  const base = [pts[0]];
  for (let i = 1; i < pts.length; i++) if (_dist(base[base.length - 1], pts[i]) >= o.minM) base.push(pts[i]);
  const out = [base[0]];
  for (let i = 1; i < base.length; i++) {
    const a = base[i - 1], b = base[i];
    const steps = Math.ceil(_dist(a, b) / o.stepM);
    for (let s = 1; s < steps; s++) {
      const f = s / steps;
      out.push({ lat: Math.round((a.lat + (b.lat - a.lat) * f) * 1e6) / 1e6, lng: Math.round((a.lng + (b.lng - a.lng) * f) * 1e6) / 1e6 });
    }
    out.push(b);
  }
  return out;
}

// Hosszú nyomvonal darabolása egymásba érő (1 közös pont) részekre.
function _chunks(trace, size) {
  if (trace.length <= size) return [trace];
  const out = [];
  for (let s = 0; s < trace.length - 1; s += size - 1) out.push(trace.slice(s, s + size));
  return out;
}

// Egy nyomvonal-darab → útdíj, két HERE-hívással.
//   trace: [{lat,lng}], truck: mergeTruck() eredménye, depIso: indulási idő
//   acceptSplit: ha a HERE csak darabolva tudta illeszteni, akkor is számol
//                (a válasz `approx:true` jelölést kap)
// Válasz: parseHereToll() + { calls, notices, approx }. Hiba esetén err.calls a
// ténylegesen elküldött hívások száma; split esetén err.code='split'.
async function _traceOnce(trace, key, truck, opts) {
  let made = 0;
  const base = (opts && opts.fetch) || fetch;
  const fetchFn = (u, i) => { made++; return base(u, i); };
  try {
    const r = await _traceOnceInner(trace, key, truck, fetchFn, opts || {});
    r.calls = made;
    return r;
  } catch (e) {
    e.calls = made;
    throw e;
  }
}

async function _traceOnceInner(trace, key, truck, fetchFn, opts) {
  const tq = truckQuery(truck);
  const dep = opts.depIso || null;
  const common = 'transportMode=truck' + (dep ? '&departureTime=' + encodeURIComponent(dep) : '');
  const importUrl = HERE_BASE + '/import?' + common + '&return=routeHandle&apikey=' + encodeURIComponent(key);
  const imported = await _fetchJson(fetchFn, importUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'VallorSoft/1.0' },
    body: JSON.stringify({ trace: trace.map((p) => ({ lat: p.lat, lng: p.lng })) }),
  });
  const notices = (imported.notices || []).map((n) => n && n.code).filter(Boolean);
  const handle = imported.routes && imported.routes[0] && imported.routes[0].routeHandle;
  const split = notices.includes('importSplitRoute');
  if (split && !(opts.acceptSplit && handle)) {
    const e = new Error('importSplitRoute'); e.code = 'split'; throw e;
  }
  if (!handle) {
    throw new Error('HERE: traseul GPS nu a putut fi potrivit pe drum');
  }
  const routeUrl = HERE_BASE + '/routes/' + encodeURIComponent(handle) + '?' + common
    + (tq.length ? '&' + tq.join('&') : '')
    + '&return=summary,tolls&currency=EUR&apikey=' + encodeURIComponent(key);
  const data = await _fetchJson(fetchFn, routeUrl, { headers: { 'User-Agent': 'VallorSoft/1.0' } });
  if (!data.routes || !data.routes.length) {
    throw new Error('HERE: nu s-a putut calcula taxa pe traseul GPS');
  }
  const r = parseHereToll(data);
  r.notices = notices.concat(((data.notices || []).map((n) => n && n.code).filter(Boolean)));
  r.approx = split;
  return r;
}

function _sumResults(list) {
  const out = { total: 0, currency: 'EUR', breakdown: [], passes: [], km: 0, notices: [], calls: 0, approx: false, source: 'here' };
  const byC = {};
  list.forEach((r) => {
    out.total += r.total || 0;
    out.km += r.km || 0;
    if (r.approx) out.approx = true;
    (r.breakdown || []).forEach((b) => { byC[b.country] = (byC[b.country] || 0) + b.cost; });
    (r.passes || []).forEach((p) => out.passes.push(p));
    (r.notices || []).forEach((n) => { if (!out.notices.includes(n)) out.notices.push(n); });
  });
  out.total = Math.round(out.total * 100) / 100;
  out.km = Math.round(out.km * 10) / 10;
  out.breakdown = Object.keys(byC).map((cc) => ({ country: cc, cost: Math.round(byC[cc] * 100) / 100 }));
  return out;
}

// Nyomvonal → útdíj.
//   points: GPS-pontok VAGY úthálózatra illesztett geometria ([t,lat,lng,…] / [lat,lng] / {lat,lng})
//   opts.depIso: indulási idő (ISO) — a díj időfüggő lehet
//   opts.maxPoints: egy HERE-kérés legnagyobb pontszáma (alap 20000; a fölötte
//                   lévő nyomvonal egymásba érő darabokban megy)
// Ha a HERE nem tudja egyben illeszteni (importSplitRoute), a darabot
// kettévágjuk (a vágópont mindkét félben benne van), legfeljebb `maxDepth`
// szintig; utána a darabolt útvonalból számolunk, `approx` jelöléssel.
async function hereTollFromTrace(points, key, truck, opts) {
  if (!key) throw new Error('no-here-key');
  const o = Object.assign({ maxDepth: 2, stepM: 25, maxPoints: 20000 }, opts || {});
  let dep = o.depIso || null;
  if (!dep) {
    const first = (points || []).map(_pt).find((p) => p && p.t);
    if (first) dep = new Date(first.t * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  }
  const trace = densifyTrace(points, o);
  if (trace.length < 2) throw new Error('insufficient-coords');
  const t = truck || mergeTruck();
  let calls = 0;
  async function once(tr, acceptSplit) {
    try {
      const r = await _traceOnce(tr, key, t, { fetch: o.fetch, depIso: dep, acceptSplit });
      calls += r.calls || 0;
      return r;
    } catch (e) {
      calls += e.calls || 0;
      throw e;
    }
  }
  async function run(tr, depth) {
    try {
      return [await once(tr, false)];
    } catch (e) {
      if (e.code !== 'split') throw e;
      if (depth < o.maxDepth && tr.length >= 4) {
        const mid = Math.floor(tr.length / 2);
        const a = await run(tr.slice(0, mid + 1), depth + 1);
        const b = await run(tr.slice(mid), depth + 1);
        return a.concat(b);
      }
      return [await once(tr, true)];
    }
  }
  let parts = [];
  try {
    for (const ch of _chunks(trace, o.maxPoints)) parts = parts.concat(await run(ch, 0));
  } catch (e) {
    e.calls = calls;
    throw e;
  }
  const sum = _sumResults(parts);
  sum.calls = calls;
  sum.trace_points = trace.length;
  sum.pieces = parts.length;
  return sum;
}

module.exports = {
  hereToll, parseHereToll, hereTollFromTrace, densifyTrace, thinTrace, truckQuery, normalizeTruck, mergeTruck,
  truckFromVehicle, TRUCK_DEFAULTS, EMISSION_CLASSES,
};
