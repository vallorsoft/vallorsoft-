// ============================================================
//  VallorSoft — lib/borderPoints.js
//  Román közúti határátkelők: név + szomszéd ország.
//
//  EGY forrás a határátlépés feliratához: az automata rögzítő
//  (lib/borderAuto.js) innen veszi az átkelő nevét, a menetlevél
//  nyomtatványa pedig innen tudja, melyik országba lépett ki / melyikből
//  lépett be a kamion. A koordináták közelítők (csak felirathoz).
// ============================================================

// [név, szélesség, hosszúság, szomszéd ország ISO-kódja]
const CROSSING_POINTS = [
  ['Nădlac II', 46.150, 20.735, 'HU'], ['Nădlac', 46.167, 20.748, 'HU'], ['Cenad', 46.133, 20.590, 'HU'],
  ['Turnu', 46.265, 21.090, 'HU'], ['Vărșand', 46.630, 21.330, 'HU'], ['Salonta', 46.785, 21.530, 'HU'],
  ['Borș II', 47.070, 21.770, 'HU'], ['Borș', 47.115, 21.810, 'HU'], ['Săcuieni', 47.370, 22.000, 'HU'],
  ['Valea lui Mihai', 47.520, 22.150, 'HU'], ['Urziceni', 47.730, 22.400, 'HU'], ['Petea', 47.860, 22.880, 'HU'],
  ['Halmeu', 47.980, 23.020, 'UA'], ['Sighetu Marmației', 47.940, 23.890, 'UA'], ['Siret', 47.975, 26.065, 'UA'],
  ['Stânca-Costești', 47.880, 27.250, 'MD'], ['Sculeni', 47.330, 27.620, 'MD'], ['Albița', 46.700, 28.170, 'MD'],
  ['Oancea', 45.920, 28.110, 'MD'], ['Galați', 45.470, 28.190, 'MD'],
  ['Vama Veche', 43.745, 28.575, 'BG'], ['Negru Vodă', 43.810, 28.210, 'BG'], ['Ostrov', 44.110, 27.380, 'BG'],
  ['Giurgiu', 43.880, 25.970, 'BG'], ['Bechet', 43.770, 23.950, 'BG'], ['Calafat', 43.975, 22.935, 'BG'],
  ['Porțile de Fier I', 44.670, 22.530, 'RS'], ['Moravița', 45.255, 21.270, 'RS'], ['Naidăș', 44.880, 21.390, 'RS'],
  ['Jimbolia', 45.785, 20.720, 'RS'],
];

// Ország-nevek románul (a menetlevél nyomtatványa csak román).
const COUNTRY_RO = { HU: 'Ungaria', UA: 'Ucraina', MD: 'Republica Moldova', BG: 'Bulgaria', RS: 'Serbia' };

const NAME_KM = 8;       // ennyin belül az átkelő NEVE is kiírható
const COUNTRY_KM = 90;   // ennyin belül a legközelebbi átkelő ORSZÁGA még megbízható

function _km(la1, ln1, la2, ln2) {
  return Math.hypot((la1 - la2) * 111, (ln1 - ln2) * 111 * Math.cos(la1 * Math.PI / 180));
}

/** A legközelebbi ismert átkelő: { name, country, km } vagy null. */
function nearestCrossing(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  let best = null, bd = Infinity;
  for (const p of CROSSING_POINTS) {
    const d = _km(lat, lng, p[1], p[2]);
    if (d < bd) { bd = d; best = p; }
  }
  return best ? { name: best[0], country: best[3], km: bd } : null;
}

/** Az átkelő neve, ha a pont 8 km-en belül van (különben null). */
function nearestCrossingName(lat, lng) {
  const n = nearestCrossing(lat, lng);
  return n && n.km <= NAME_KM ? n.name : null;
}

const _fold = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[șş]/gi, 's').replace(/[țţ]/gi, 't').toLowerCase();

// Koordináta a szabad szöveges helyszínből ("GPS 46.15000, 20.73500",
// "46.1500, 20.7350") — a sofőr-gomb és a régi sorok így tárolják.
function _coordsFromText(s) {
  const m = /(-?\d{1,2}\.\d{2,})\s*[,;]\s*(-?\d{1,3}\.\d{2,})/.exec(String(s || ''));
  if (!m) return null;
  const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
  return (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) ? { lat, lng } : null;
}

/**
 * Egy rögzített határátlépés olvasható leírása a menetlevélhez.
 * @param {{lat?:number, lng?:number, locatie?:string}} c
 * @returns {{ name: string|null, country: string|null, countryRo: string|null, coords: string|null }}
 *   name    — az átkelő (helység) neve, ha ismert
 *   country — a szomszéd ország ISO-kódja (ahová kilépett / ahonnan belépett)
 *   coords  — "lat, lng" tartaléknak, ha a név nem ismert
 */
function describeCrossing(c) {
  const o = c || {};
  let lat = Number(o.lat), lng = Number(o.lng);
  if (o.lat == null || o.lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    const p = _coordsFromText(o.locatie);
    lat = p ? p.lat : NaN; lng = p ? p.lng : NaN;
  }
  let name = null, country = null;

  // 1) A tárolt felirat neve ("Nădlac II · GPS …" vagy az iroda által beírt helység)
  const raw = String(o.locatie || '').split('·')[0].replace(/\(≈\)/g, '').trim();
  const txt = /^(gps\b|-?\d)/i.test(raw) ? '' : raw;
  if (txt) {
    name = txt.slice(0, 80);
    const f = _fold(txt);
    // a leghosszabb egyező név nyer ("Nădlac II" a "Nădlac" előtt)
    const hit = CROSSING_POINTS.filter((p) => f.includes(_fold(p[0]))).sort((a, b) => b[0].length - a[0].length)[0];
    if (hit) country = hit[3];
  }
  // 2) Koordinátából
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    const n = nearestCrossing(lat, lng);
    if (n) {
      if (!name && n.km <= NAME_KM) name = n.name;
      if (!country && n.km <= COUNTRY_KM) country = n.country;
    }
  }
  return {
    name: name || null,
    country: country || null,
    countryRo: country ? (COUNTRY_RO[country] || country) : null,
    coords: (Number.isFinite(lat) && Number.isFinite(lng)) ? (lat.toFixed(5) + ', ' + lng.toFixed(5)) : null,
  };
}

module.exports = { CROSSING_POINTS, COUNTRY_RO, nearestCrossing, nearestCrossingName, describeCrossing };
