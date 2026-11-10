// ============================================================
//  VallorSoft — lib/waybillRows.js
//  A menetlevél útvonal-táblájának sorai: a rögzített pontok
//  (Plecare / Încărcare / Descărcare / Sosire) + a határátlépések
//  IDŐRENDBEN közéjük fésülve.
//
//  A pontok dátuma/órája a sofőr által beírt helyi (román) idő; a
//  határátlépés valós időpont, amit Europe/Bucharest szerint írunk ki —
//  így a kettő ugyanazon az órán hasonlítható össze.
//  Tiszta függvények (nincs DB) → egységteszt: tests/unit/waybillRows.test.js
// ============================================================
const { describeCrossing } = require('./borderPoints');

const TZ = 'Europe/Bucharest';
const _fmt = new Intl.DateTimeFormat('sv-SE', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** Valós időpont → { date:'YYYY-MM-DD', time:'HH:MM' } román idő szerint. */
function roDateTime(v) {
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return null;
  const s = _fmt.format(d).replace(',', '');          // "2026-03-02 08:15"
  const m = /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/.exec(s);
  return m ? { date: m[1], time: m[2] } : null;
}

const _isoDate = (s) => { const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(s || '').trim()); return m ? m[1] : ''; };
const _hhmm = (s) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(s || '').trim()); return m ? (('0' + m[1]).slice(-2) + ':' + m[2]) : ''; };

/** 'YYYY-MM-DD' → 'DD.MM.YYYY' (más formát változatlanul ad vissza). */
function dateRo(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '').trim());
  return m ? (m[3] + '.' + m[2] + '.' + m[1]) : String(s || '').trim();
}

function _isTip(p, word) {
  return String((p && p.tip) || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().indexOf(word) === 0;
}

// Egy pont rendezési kulcsa. Óra nélküli pontnál nem tudjuk a napon belüli
// sorrendet: az indulás a nap elejére, az érkezés a végére, a többi délre kerül.
function _punctKey(p) {
  const d = _isoDate(p && p.data);
  if (!d) return '';
  const t = _hhmm(p && p.time);
  if (t) return d + ' ' + t;
  if (_isTip(p, 'plecare')) return d + ' 00:00';
  if (_isTip(p, 'sosire')) return d + ' 23:59';
  return d + ' 12:00';
}

/**
 * @param {Array} puncte    a menetlevél pontjai ({tip, loc, data, time, …}) — a sorrendjük megmarad
 * @param {Array} crossings határátlépések ({datetime, direction:'IN'|'OUT', locatie, lat, lng, source})
 * @param {Object} [stopTimes] állomás-id → { from, to } (valós időpontok: a GPS-ből felismert érkezés /
 *        távozás, ennek hiányában a sofőr gombnyomása); `sure:true` (biztos / jóváhagyott GPS-találat) a beírt
 *        órát is felülírja, a többi csak a hiányzó órát pótolja
 * @returns {Array} sorok: { kind:'punct', tip, loc, date, time, timeTo?, gps? }
 *                       | { kind:'border', direction, name, country, countryRo, coords, date, time, source }
 */
function buildRouteRows(puncte, crossings, stopTimes) {
  const st = stopTimes && typeof stopTimes === 'object' ? stopTimes : {};
  // a pont ideje: megbízható GPS-idő → beírt óra → egyéb valós idő
  const pts = (Array.isArray(puncte) ? puncte.filter((p) => p && typeof p === 'object') : []).map((p, i) => {
    // állomás-id szerint, különben a pont sorszáma szerint ('#i' — lásd fillTrackTimes)
    const t = (p.stopId != null && p.stopId !== '' ? st[String(p.stopId)] : null) || st['#' + i];
    // a MEGBÍZHATÓ GPS-idő (biztos / jóváhagyott állomás) az elsődleges: a beírt órát is felülírja;
    // a többi forrás (javaslat, gombnyomás, útvonal) csak a hiányzó órát pótolja
    if (_hhmm(p.time) && !(t && t.sure)) return p;
    const a = t && t.from ? roDateTime(t.from) : null;
    if (!a) return p;
    const b = t.to ? roDateTime(t.to) : null;
    // a GPS a valós időpont → a dátum is onnan jön (a beírt / tervezett nap eltérhet)
    const q = { ...p, data: a.date, time: a.time, _gps: true };
    if (b && b.date === a.date && b.time !== a.time) q._timeTo = b.time;   // távozás, ha ugyanaznap
    return q;
  });
  const xs = [];
  (Array.isArray(crossings) ? crossings : []).forEach((c) => {
    if (!c || typeof c !== 'object') return;
    const dt = roDateTime(c.datetime);
    if (!dt) return;
    const d = describeCrossing(c);
    xs.push({
      kind: 'border', direction: c.direction === 'IN' ? 'IN' : 'OUT',
      name: d.name, country: d.country, countryRo: d.countryRo, coords: d.coords,
      date: dt.date, time: dt.time, source: c.source || null, _key: dt.date + ' ' + dt.time,
    });
  });
  xs.sort((a, b) => (a._key < b._key ? -1 : a._key > b._key ? 1 : 0));

  // A határátlépés az indulás UTÁN és az érkezés ELŐTT áll a lapon.
  const lo = pts.length && _isTip(pts[0], 'plecare') ? 1 : 0;
  const hi = pts.length > lo && _isTip(pts[pts.length - 1], 'sosire') ? pts.length - 1 : pts.length;
  const keys = pts.map(_punctKey);
  const at = pts.map(() => []);
  const tail = [];
  xs.forEach((x) => {
    let idx = -1;
    for (let i = lo; i < hi; i++) { if (keys[i] && keys[i] > x._key) { idx = i; break; } }
    if (idx < 0) idx = hi;
    if (idx >= pts.length) tail.push(x); else at[idx].push(x);
  });

  const out = [];
  const pub = (x) => { const o = Object.assign({}, x); delete o._key; return o; };
  pts.forEach((p, i) => {
    at[i].forEach((x) => out.push(pub(x)));
    const d = _isoDate(p.data);
    const row = { kind: 'punct', tip: p.tip || '', loc: p.loc || '', date: d || String(p.data || '').trim(), time: _hhmm(p.time) };
    if (p._gps) { row.gps = true; if (p._timeTo) row.timeTo = p._timeTo; }
    out.push(row);
  });
  tail.forEach((x) => out.push(pub(x)));
  return out;
}

/**
 * Az indulás / érkezés pontos ideje a fejléchez: elsőként a Plecare / Sosire
 * pont (a sofőr által beírt dátum + óra), különben a menetlevél tárolt
 * időpontja (helyi időként tárolva → UTC-ben olvassuk ki).
 * @returns {{date:string, time:string}} time üres, ha nincs megadva óra
 */
function tripEndpoint(puncte, kind, storedDt) {
  const pts = Array.isArray(puncte) ? puncte.filter((p) => p && typeof p === 'object') : [];
  const word = kind === 'sosire' ? 'sosire' : 'plecare';
  const list = pts.filter((p) => _isTip(p, word) && _isoDate(p.data));
  const p = word === 'sosire' ? list[list.length - 1] : list[0];
  if (p && _hhmm(p.time)) return { date: _isoDate(p.data), time: _hhmm(p.time) };
  if (storedDt) {
    const d = storedDt instanceof Date ? storedDt : new Date(storedDt);
    if (!isNaN(d.getTime())) {
      const iso = d.toISOString();
      const t = iso.slice(11, 16);
      // 00:00 = csak dátummal rögzített (régi / irodai) menetlevél → óra nélkül
      return { date: iso.slice(0, 10), time: t === '00:00' ? '' : t };
    }
  }
  if (p) return { date: _isoDate(p.data), time: '' };
  return { date: '', time: '' };
}

// ── Idő a GPS-útvonalból ─────────────────────────────────────────────
// Ha egy pontnak nincs beírt órája és állomáshoz sem köthető, de a címében
// ott a koordináta ("… (48.22610, 17.93158)"), a vontató GPS-pontsorából
// megkeressük, mikor állt ott a kamion.
const TRACK_RADIUS_M = 300, TRACK_GAP_SEC = 30 * 60, TRACK_MIN_SEC = 120;

function coordsOf(loc) {
  const all = String(loc || '').match(/\((-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})\)/g);
  if (!all) return null;
  const m = /\((-?[\d.]+)\s*,\s*(-?[\d.]+)\)/.exec(all[all.length - 1]);
  const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
  return (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) ? { lat, lng } : null;
}
function _distM(la1, ln1, la2, ln2) {
  return Math.hypot((la1 - la2) * 111000, (ln1 - ln2) * 111000 * Math.cos(la1 * Math.PI / 180));
}
/** A kamion látogatásai egy pont körül: [{from, to}] másodpercben, időrendben. */
function trackVisits(track, lat, lng, fromSec, toSec) {
  const out = [];
  let run = null;
  const close = () => { if (run && run.to - run.from >= TRACK_MIN_SEC) out.push(run); run = null; };
  for (const p of (Array.isArray(track) ? track : [])) {
    if (!Array.isArray(p) || !Number.isFinite(p[0])) continue;
    if (fromSec != null && p[0] < fromSec) continue;
    if (toSec != null && p[0] > toSec) break;
    if (_distM(p[1], p[2], lat, lng) > TRACK_RADIUS_M) { close(); continue; }
    if (run && p[0] - run.to > TRACK_GAP_SEC) close();
    if (!run) run = { from: p[0], to: p[0] }; else run.to = p[0];
  }
  close();
  return out;
}
/**
 * A még idő nélküli, koordinátás pontokhoz a GPS-pontsorból keres érkezést / távozást,
 * és '#<sorszám>' kulccsal a stopTimes-ba írja. Ugyanazt a látogatást nem adja ki kétszer
 * (két pont ugyanazon a helyen → két külön megállás, ha volt).
 * @param {Array} track [[t(sec), lat, lng, …], …] időrendben
 */
function fillTrackTimes(puncte, stopTimes, track) {
  const st = stopTimes || {};
  const pts = Array.isArray(puncte) ? puncte.filter((p) => p && typeof p === 'object') : [];
  const used = new Set();
  pts.forEach((p, i) => {
    if (_hhmm(p.time) || st['#' + i]) return;
    if (p.stopId != null && p.stopId !== '' && st[String(p.stopId)]) return;
    const c = coordsOf(p.loc);
    if (!c) return;
    const d = _isoDate(p.data);
    const base = d ? Date.parse(d + 'T00:00:00Z') / 1000 : null;
    const vis = trackVisits(track, c.lat, c.lng, base != null ? base - 86400 : null, base != null ? base + 3 * 86400 : null)
      .filter((v) => !used.has(v.from + ':' + v.to));
    if (!vis.length) return;
    // a beírt naphoz legközelebbi, azon belül a leghosszabb megállás
    const mid = base != null ? base + 43200 : null;
    vis.sort((a, b) => {
      if (mid != null) {
        const da = Math.round(Math.abs((a.from + a.to) / 2 - mid) / 86400), db = Math.round(Math.abs((b.from + b.to) / 2 - mid) / 86400);
        if (da !== db) return da - db;
      }
      return (b.to - b.from) - (a.to - a.from);
    });
    const v = vis[0];
    used.add(v.from + ':' + v.to);
    st['#' + i] = { from: new Date(v.from * 1000), to: new Date(v.to * 1000) };
  });
  return st;
}

module.exports = { fillTrackTimes, trackVisits, coordsOf, buildRouteRows, tripEndpoint, roDateTime, dateRo, TZ };
