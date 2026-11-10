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
 * @returns {Array} sorok: { kind:'punct', tip, loc, date, time }
 *                       | { kind:'border', direction, name, country, countryRo, coords, date, time, source }
 */
function buildRouteRows(puncte, crossings) {
  const pts = Array.isArray(puncte) ? puncte.filter((p) => p && typeof p === 'object') : [];
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
    out.push({
      kind: 'punct', tip: p.tip || '', loc: p.loc || '',
      date: d || String(p.data || '').trim(), time: _hhmm(p.time),
    });
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

module.exports = { buildRouteRows, tripEndpoint, roDateTime, dateRo, TZ };
