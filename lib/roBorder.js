// ============================================================
//  VallorSoft — lib/roBorder.js
//  Románia területe mint GEOZÓNA: a CargoTrack GPS-pontsorból felismeri,
//  mikor lépett ki / be a kamion az ország határán (idő + koordináta).
//
//  NINCS szükség PostGIS-re: a határpoligon (lib/geo/romania.json, ~2900
//  csúcs, geoBoundaries CC BY 4.0) a memóriában van, a „pont a poligonban"
//  vizsgálat egy rács-indexszel gyorsított sugár-módszer. Tiszta függvények,
//  DB nélkül tesztelhetők.
//
//  Hamis jelzés ellen (GPS-zaj a határ mentén, várakozás a vámnál):
//  egy irányváltás CSAK akkor számít átlépésnek, ha utána a kamion az új
//  oldalon legalább CONFIRM_M méterre eltávolodik a határtól. Ha előtte
//  visszafordul, az egész „billegés" eldobódik.
//  Az átlépés pontos helye/ideje a két szomszédos pont (belül/kívül)
//  szakaszán felezéses kereséssel, időben lineárisan interpolálva.
// ============================================================
const DATA = require('./geo/romania.json');

const CONFIRM_M = 1500;          // ennyit kell az új oldalon a határtól eltávolodni
const GAP_APPROX_SEC = 20 * 60;  // ennél nagyobb pont-hézagnál az idő csak becslés
const CELL = 0.05;               // rács-cella (fok) a gyors pont-vizsgálathoz

// Gyűrűk [[lng,lat],...] — külső + lyukak, minden poligonból
const RINGS = [];
for (const poly of DATA.coordinates) for (const ring of poly) RINGS.push(ring);

// TENGERI ZÓNA: a Fekete-tenger NEM szárazföldi határ. Az egyszerűsített
// poligon a partot néhol kissé beljebb húzza (Konstanca, Sulina kikötő),
// ami hamis „kilépést" adna a kikötőben. Ezért a román partszakasz előtti
// tenger (Vama Veche ↔ Musura-öböl) Romániának számít, és a part élei nem
// számítanak határnak a megerősítő távolság-mérésben. A zóna nyugati széle
// a szárazföld belsejében fut (román területen), az északi/déli széle a
// tengeren — ukrán / bolgár szárazföldet nem érint.
const SEA = [[28.55, 43.78], [28.62, 43.755], [31.5, 43.755], [31.5, 45.20],
             [29.73, 45.20], [29.55, 45.15], [29.0, 45.0], [28.45, 44.9], [28.45, 43.85]];
function _inRing(ring, lng, lat) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > lat) !== (b[1] > lat) && lng < a[0] + (lat - a[1]) * (b[0] - a[0]) / (b[1] - a[1])) inside = !inside;
  }
  return inside;
}

let minLng = 180, minLat = 90, maxLng = -180, maxLat = -90;
const EDGES = [];       // [x1,y1,x2,y2] — az ország-poligon élei (pont-vizsgálathoz)
const LAND_EDGES = [];  // ebből a szárazföldi határ (a tengerparti élek nélkül)
const GRID_EDGES = [];  // a rács-indexhez: ország + tengeri zóna élei
function _addRing(r, target) {
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length];
    if (a[0] === b[0] && a[1] === b[1]) continue;
    const e = [a[0], a[1], b[0], b[1]];
    if (target) target.push(e);
    GRID_EDGES.push(e);
    if (a[0] < minLng) minLng = a[0]; if (a[0] > maxLng) maxLng = a[0];
    if (a[1] < minLat) minLat = a[1]; if (a[1] > maxLat) maxLat = a[1];
  }
}
for (const r of RINGS) _addRing(r, EDGES);
_addRing(SEA, null);
for (const e of EDGES) {
  if (!_inRing(SEA, e[0], e[1]) && !_inRing(SEA, e[2], e[3])) LAND_EDGES.push(e);
}
const COLS = Math.ceil((maxLng - minLng) / CELL) + 1;
const ROWS = Math.ceil((maxLat - minLat) / CELL) + 1;

// Melyik cellán megy át határ-él (ezekben teljes vizsgálat kell)
const borderCell = new Uint8Array(COLS * ROWS);
function cellOf(lng, lat) {
  const c = Math.floor((lng - minLng) / CELL), r = Math.floor((lat - minLat) / CELL);
  if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return -1;
  return r * COLS + c;
}
for (const e of GRID_EDGES) {
  const len = Math.hypot(e[2] - e[0], e[3] - e[1]);
  const steps = Math.max(1, Math.ceil(len / (CELL / 4)));
  for (let s = 0; s <= steps; s++) {
    const f = s / steps;
    const k = cellOf(e[0] + (e[2] - e[0]) * f, e[1] + (e[3] - e[1]) * f);
    if (k >= 0) {
      borderCell[k] = 1;
      // a szomszéd cellák is (a mintavételezés kerekítése ellen)
      const r = Math.floor(k / COLS), c = k % COLS;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && cc >= 0 && rr < ROWS && cc < COLS) borderCell[rr * COLS + cc] = 1;
      }
    }
  }
}

function _pipExact(lng, lat) {
  if (_inRing(SEA, lng, lat)) return true;
  let inside = false;
  for (const e of EDGES) {
    const y1 = e[1], y2 = e[3];
    if ((y1 > lat) !== (y2 > lat)) {
      const x = e[0] + (lat - y1) * (e[2] - e[0]) / (y2 - y1);
      if (lng < x) inside = !inside;
    }
  }
  return inside;
}

// Nem-határ cellák: a cella-közép eredménye érvényes az egész cellára (cache)
const cellState = new Int8Array(COLS * ROWS);   // 0 = ismeretlen, 1 = belül, 2 = kívül
/** Romániában van-e a pont (szárazföldi terület, a Duna-delta is). */
function isInRomania(lat, lng) {
  lat = +lat; lng = +lng;
  if (!isFinite(lat) || !isFinite(lng)) return null;
  if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) return false;
  const k = cellOf(lng, lat);
  if (k < 0) return false;
  if (borderCell[k]) return _pipExact(lng, lat);
  if (!cellState[k]) {
    const c = k % COLS, r = Math.floor(k / COLS);
    cellState[k] = _pipExact(minLng + (c + 0.5) * CELL, minLat + (r + 0.5) * CELL) ? 1 : 2;
  }
  return cellState[k] === 1;
}

/** Távolság (m) a legközelebbi SZÁRAZFÖLDI határ-éltől (helyi síkvetület, ~1% pontosság). */
function distToBorderM(lat, lng) {
  const kx = 111320 * Math.cos(lat * Math.PI / 180), ky = 110540;
  let best = Infinity;
  for (const e of LAND_EDGES) {
    // gyors kizárás: ha az él befoglaló doboza is messzebb van, mint a mostani legjobb
    const dxMin = Math.max(0, Math.min(e[0], e[2]) - lng, lng - Math.max(e[0], e[2])) * kx;
    const dyMin = Math.max(0, Math.min(e[1], e[3]) - lat, lat - Math.max(e[1], e[3])) * ky;
    if (dxMin > best || dyMin > best) continue;
    const ax = (e[0] - lng) * kx, ay = (e[1] - lat) * ky;
    const bx = (e[2] - lng) * kx, by = (e[3] - lat) * ky;
    const vx = bx - ax, vy = by - ay;
    const L = vx * vx + vy * vy;
    let t = L ? -(ax * vx + ay * vy) / L : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(ax + vx * t, ay + vy * t);
    if (d < best) best = d;
  }
  return best;
}

/** A két pont közti szakasz és a határ metszéspontja (felezés): 0..1 arány. */
function crossingFraction(a, b) {
  // a, b: [lat, lng]; a és b különböző oldalon
  const sa = isInRomania(a[0], a[1]);
  let lo = 0, hi = 1;
  for (let i = 0; i < 25; i++) {
    const m = (lo + hi) / 2;
    const s = isInRomania(a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m);
    if (s === sa) lo = m; else hi = m;
  }
  return (lo + hi) / 2;
}

/**
 * Határátlépések felismerése egy időrendi GPS-pontsorból.
 * @param {Array} pts  [[t (epoch mp), lat, lng, ...], ...] — a gps_track_days formátuma
 * @param {Object} [opts] { initialState: true|false|null, confirmM }
 * @returns {{ crossings: Array<{t, dir:'OUT'|'IN', lat, lng, gapSec, approx}>, state: boolean|null, pending: boolean }}
 *   `state` — az utolsó MEGERŐSÍTETT oldal (true = Romániában)
 *   `pending` — a sor végén van egy még meg nem erősített irányváltás
 */
function detectCrossings(pts, opts) {
  const o = opts || {};
  const confirmM = o.confirmM || CONFIRM_M;
  const out = [];
  let state = (o.initialState === true || o.initialState === false) ? o.initialState : null;
  let cand = null;          // { i: az új oldal első pontjának indexe }
  let pending = false;
  const valid = (p) => Array.isArray(p) && isFinite(p[0]) && isFinite(p[1]) && isFinite(p[2])
    && !(Math.abs(p[1]) < 0.01 && Math.abs(p[2]) < 0.01);
  const list = (pts || []).filter(valid);

  // Kezdő állapot: az első olyan pont, ami a határtól távol van
  let i0 = 0;
  if (state === null) {
    for (; i0 < list.length; i0++) {
      const p = list[i0];
      if (distToBorderM(p[1], p[2]) >= confirmM) { state = isInRomania(p[1], p[2]); break; }
    }
    if (state === null) return { crossings: [], state: null, pending: false };
  }

  for (let i = Math.max(1, i0); i < list.length; i++) {
    const p = list[i];
    const s = isInRomania(p[1], p[2]);
    if (cand === null) {
      if (s !== state) cand = { i };
    } else if (s === state) {
      cand = null;            // visszafordult a megerősítés előtt → billegés, eldobjuk
      continue;
    }
    if (cand !== null) {
      const last = list[i];
      if (distToBorderM(last[1], last[2]) >= confirmM) {
        const a = list[cand.i - 1], b = list[cand.i];
        const f = crossingFraction([a[1], a[2]], [b[1], b[2]]);
        const gap = b[0] - a[0];
        out.push({
          t: Math.round(a[0] + gap * f),
          dir: state ? 'OUT' : 'IN',
          lat: +(a[1] + (b[1] - a[1]) * f).toFixed(6),
          lng: +(a[2] + (b[2] - a[2]) * f).toFixed(6),
          gapSec: gap,
          approx: gap > GAP_APPROX_SEC,
        });
        state = !state;
        cand = null;
      }
    }
  }
  pending = cand !== null;
  return { crossings: out, state, pending };
}

module.exports = { isInRomania, distToBorderM, detectCrossings, crossingFraction, CONFIRM_M, GAP_APPROX_SEC };
