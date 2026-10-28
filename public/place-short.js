// ============================================================
//  VallorSoft — public/place-short.js
//  Rövid fuvar-címke a fuvar-választókhoz: „Megbízó cég · Város → Város".
//  A teljes címből (utca, irányítószám, megye, ország) csak a település
//  (város/falu) marad, a cégnév levágva — hogy a választó ne tolja szét
//  az ablakot. (Ugyanaz a szabály, mint a sofőr-felület _cityOf-ja.)
//    vsCityOf('Strada X 5, 555400 Copșa Mică, Jud. Sibiu, România') → 'Copșa Mică'
//    vsOrderShort({client, loc_incarcare, loc_descarcare}) → 'ALFA SRL · Cluj → Arad'
// ============================================================
(function () {
  'use strict';
  var STREET_RE = /^(strada|str\.?|bd\.?|b-?dul|bulevardul|calea|șos(eaua)?|sos(eaua)?|șos\.?|sos\.?|aleea|piaț[aă]|piata|cart(ier)?\.?|nr\.?|intrarea|intr\.?|drumul|dr\.?|splaiul|spl\.?|fund[aă]tura|fnd\.?|utca|u\.|út|körút|tér)\b/i;
  var COUNTRY_RE = /^(rom[aâ]nia|ro|ungaria|magyarorsz[aá]g|hungary|hu|moldova|republica moldova|bulgaria|serbia|srbija|ukraine|ucraina|austria|germania|deutschland|germany|italia|italy|fran[țt]a|france|slovakia|slovacia|slovenia|croa[țt]ia|greece|grecia|poland|polska|polonia|cehia|czech|czechia|belgium|belgia|nederland|netherlands|holland|olanda|luxemburg|switzerland|elve[țt]ia|espa[ñn]a|spain|spania|portugal|portugalia|turkey|turcia|denmark|danemarca|sweden|suedia|norway|norvegia|finland|finlanda|ireland|irlanda|marea britanie|uk|united kingdom)$/i;
  var POSTAL_RE = /^\d{3,8}[a-z]?$/i;
  var POSTAL_PREFIX_RE = /^(cod(ul)?|cp|c\.p\.|postal|irsz\.?|ir\.sz\.?|zip|plz)\s*[:.]?\s*\d{3,8}[a-z]?$/i;
  var COUNTY_RE = /^(jud\.?|județul|judetul|megye)\b/i;
  // Utótagos utcanév (HU/DE/EN): „Kossuth Lajos utca 5", „Hauptstraße 3", „Main St. 4"
  var STREET_SUFFIX_RE = /((^|\s)(utca|u\.|út|útja|körút|krt\.?|tér|sor|köz|sétány|str\.|street|st\.|road|rd\.|avenue|ave\.?)|(stra(ss|ß)e|weg|gasse|platz))(\s+\d+\w*(\/\w+)?)?\.?$/i;
  // Település-előtag (RO): „Sat Arcus", „Comuna Ilieni", „Municipiul Brașov" → a név marad
  var SETTLEMENT_RE = /^(sat(ul)?|com(una)?\.?|ora[șs](ul)?|municipiul|mun\.?)\s+/i;

  function cityOf(loc) {
    var s = String(loc || '').trim();
    if (!s) return '';
    var parts = s.split(',').map(function (p) { return p.trim(); }).filter(Boolean);
    if (!parts.length) return s;
    var countyFallback = '';
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (POSTAL_RE.test(p) || POSTAL_PREFIX_RE.test(p) || COUNTRY_RE.test(p) || STREET_RE.test(p) || STREET_SUFFIX_RE.test(p)) continue;
      if (/^\d+[a-z]?$/i.test(p)) continue;
      if (COUNTY_RE.test(p)) { if (!countyFallback) countyFallback = p; continue; }
      var stripped = p.replace(SETTLEMENT_RE, '').replace(/^\d{3,8}[a-z]?\s+/i, '').replace(/\s+\d{3,8}$/, '').trim();
      if (stripped) return stripped;
    }
    return countyFallback || parts[parts.length - 1] || s;
  }
  function clip(s, n) {
    s = String(s || '').trim();
    return s.length > n ? s.slice(0, n - 1).trim() + '…' : s;
  }
  // opts.withNo: a fuvarszámot is elé teszi (pl. ha két fuvar címkéje egyezne)
  function orderShort(o, opts) {
    o = o || {}; opts = opts || {};
    var route = [cityOf(o.loc_incarcare), cityOf(o.loc_descarcare)].filter(Boolean).map(function (c) { return clip(c, 22); }).join(' → ');
    var parts = [];
    if (opts.withNo) parts.push(o.fuvar_no || o.order_id || o.id);
    if (o.client) parts.push(clip(o.client, 26));
    if (route) parts.push(route);
    if (!parts.length) parts.push(o.fuvar_no || o.order_id || o.id || '');
    return parts.join(' · ');
  }
  // Egy listára: ahol két címke azonos lenne, ott a fuvarszám is bekerül.
  function orderShortList(list) {
    var base = (list || []).map(function (o) { return orderShort(o); });
    return (list || []).map(function (o, i) {
      var dup = base.some(function (b, j) { return j !== i && b === base[i]; });
      return dup ? orderShort(o, { withNo: true }) : base[i];
    });
  }
  // Teljes leírás a title-tooltiphez (fuvarszám + cég + teljes címek).
  function orderTitle(o) {
    o = o || {};
    return [o.fuvar_no || o.order_id || o.id, o.client, [o.loc_incarcare, o.loc_descarcare].filter(Boolean).join(' → ')].filter(Boolean).join(' · ');
  }
  window.vsCityOf = cityOf;
  window.vsOrderShort = orderShort;
  window.vsOrderShortList = orderShortList;
  window.vsOrderTitle = orderTitle;
})();
