// ============================================================
//  VallorSoft — public/coord-parse.js  (kliens + szerver közös)
//  Beírt koordináta felismerése egy cím-mezőben. Elfogadott formák:
//    45.12345, 25.45678   ·  45.12345 25.45678  ·  45,12345 25,45678
//    45.123 N, 25.456 E   ·  N45.123 E25.456    ·  É/K/D/Ny is (HU)
//    45°07'23.4"N 25°27'21"E  (fok-perc-mp)  ·  45°07.39'N 25°27.35'E
//    Google/HERE/OSM térkép-link (…@45.1,25.2,15z · ?q=45.1,25.2 · map=15/45.1/25.2)
//  Csak egész számokat (pl. „45 25") NEM vesz koordinátának — házszám lehet.
//  parseCoords(str) → { lat, lng } | null
// ============================================================
(function (root) {
  function valid(lat, lng) {
    return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
      && !(lat === 0 && lng === 0);
  }
  function out(lat, lng) {
    if (valid(lat, lng)) return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
    // lng, lat sorrendben írták (pl. GeoJSON) → csere, ha csak így érvényes
    if (Math.abs(lat) > 90 && valid(lng, lat)) return { lat: Math.round(lng * 1e6) / 1e6, lng: Math.round(lat * 1e6) / 1e6 };
    return null;
  }
  const NEG = { S: 1, W: 1, D: 1, V: 1, NY: 1, Y: 1 }; // dél / nyugat (RO: V=vest, HU: D=dél, NY=nyugat)
  function hemiSign(h) { return h && NEG[h.toUpperCase()] ? -1 : 1; }

  // Egy koordináta-komponens (fok / fok-perc / fok-perc-mp) → tizedes fok
  function dmsToDec(s) {
    const nums = String(s).replace(/,/g, '.').match(/-?\d+(?:\.\d+)?/g);
    if (!nums || !nums.length) return NaN;
    const d = parseFloat(nums[0]);
    const m = nums[1] != null ? parseFloat(nums[1]) : 0;
    const sec = nums[2] != null ? parseFloat(nums[2]) : 0;
    if (m >= 60 || sec >= 60) return NaN;
    const v = Math.abs(d) + m / 60 + sec / 3600;
    return d < 0 || /^\s*-/.test(s) ? -v : v;
  }

  function parseCoords(input) {
    let s = String(input == null ? '' : input).trim();
    if (!s || s.length > 300) return null;

    // 1) Térkép-linkek
    let m = s.match(/@(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/)               // google …/@lat,lng,15z
      || s.match(/[?&](?:q|query|ll|center|daddr|destination|coord)=(-?\d{1,2}\.\d+)(?:,|%2C)\s*(-?\d{1,3}\.\d+)/i)
      || s.match(/[#&?]map=\d+(?:\.\d+)?\/(-?\d{1,2}\.\d+)\/(-?\d{1,3}\.\d+)/)   // osm #map=15/lat/lng
      || s.match(/[?&]map=(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/);                   // wego.here.com ?map=lat,lng,z
    if (m) return out(parseFloat(m[1]), parseFloat(m[2]));
    if (/^https?:\/\//i.test(s)) return null;

    // 2) „lat: 45.1, lng: 25.2" címkék eltávolítása
    s = s.replace(/\b(lat(itude)?|lng|lon(gitude)?|long)\s*[:=]\s*/gi, ' ').trim();

    // 3) Égtáj-betűs / fok-jeles forma
    const hasDeg = /[°º˚'′’"″”]/.test(s);
    const tokenRe = /([NSEWÉDKV]|NY)?\s*(-?\d+(?:[.,]\d+)?(?:\s*[°º˚]\s*\d+(?:[.,]\d+)?\s*['′’]?(?:\s*\d+(?:[.,]\d+)?\s*(?:["″”]|''))?)?\s*[°º˚'′’"″”]*)\s*([NSEWÉDKV]|NY)?/gi;
    if (hasDeg || /^[NSÉD]\s*\d|\d\s*[°º˚'"]?\s*[NSÉD]\b/i.test(s)) {
      const parts = [];
      let t;
      tokenRe.lastIndex = 0;
      while ((t = tokenRe.exec(s)) && parts.length < 3) {
        if (!t[2]) { tokenRe.lastIndex++; continue; }
        parts.push({ pre: t[1], val: t[2], post: t[3] });
      }
      if (parts.length === 2) {
        const h1 = (parts[0].pre || parts[0].post || '').toUpperCase();
        const h2 = (parts[1].pre || parts[1].post || '').toUpperCase();
        let a = dmsToDec(parts[0].val) * hemiSign(h1);
        let b = dmsToDec(parts[1].val) * hemiSign(h2);
        // ha az első az E/W (hosszúság), cseréljük
        const isLng = (h) => /^(E|W|K|V|NY)$/.test(h);
        if (isLng(h1) && !isLng(h2)) { const x = a; a = b; b = x; }
        return out(a, b);
      }
      if (hasDeg) return null;
    }

    // 4) Sima tizedes pár: legalább az egyik tizedes tört legyen
    // „45.1, 25.2" · „45.1 25.2" · „45.1;25.2" · „45,1 25,2" (tizedesvessző + szóköz)
    m = s.match(/^(-?\d{1,3}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)$/);
    if (m && (m[1].includes('.') || m[2].includes('.'))) return out(parseFloat(m[1]), parseFloat(m[2]));
    m = s.match(/^(-?\d{1,3},\d+)\s*[;\s]\s*(-?\d{1,3},\d+)$/);
    if (m) return out(parseFloat(m[1].replace(',', '.')), parseFloat(m[2].replace(',', '.')));
    return null;
  }

  function fmtCoords(c) { return c ? (Number(c.lat).toFixed(5) + ', ' + Number(c.lng).toFixed(5)) : ''; }

  const api = { parseCoords, fmtCoords };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VsCoord = api;
})(typeof window !== 'undefined' ? window : this);
