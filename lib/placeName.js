// ============================================================
//  VallorSoft — lib/placeName.js
//  Cím-szöveg tisztítás: a címkiegészítő „Hely neve, Utca, Település, Irsz., Ország"
//  formájából a hely / cég neve (pl. „Policlinica AS") NEM kerül a címbe — a cég neve
//  a külön cég-mezőbe tartozik. Kliens- és szerveroldalon ugyanez a szabály
//  (public/console-shared.js `vsStripPlaceName`).
// ============================================================
const STREET_RE = /^(str|strada|bd|bdul|blvd|bulevardul|calea|aleea|sos|soseaua|drumul|piata|splaiul|intrarea|nr|dn\d*|dj\d*|e\d+)\b|\b(utca|ut|krt|korut|ter|strasse|str|street|road|rd|avenue|ave|ulica|ul)$/;
function _norm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
const COUNTRY_RE = /^(ro|hu|de|at|sk|cz|pl|bg|it|fr|nl|be|es|rs|ua|md|si|hr|romania|hungary|magyarorszag|ungaria|germany|deutschland|germania|austria|bulgaria|italia|italy|france)$/;
function isStreet(part) { return STREET_RE.test(_norm(part)); }
// „Név, Utca, Település…" → „Utca, Település…" (legalább 3 darab, a 2. darab utca,
// az 1. maga nem utca és nem szám) — minden más cím változatlan.
function stripPlaceName(loc) {
  const s = String(loc == null ? '' : loc);
  const parts = s.split(',');
  if (parts.length < 3) return s;
  const first = parts[0].trim(), second = parts[1].trim();
  const nf = _norm(first);
  if (!nf || /^\d+$/.test(nf.replace(/ /g, '')) || isStreet(first) || !isStreet(second)) return s;
  // a maradékban maradjon település (különben az első darab volt a település: „Arad, Strada X, RO")
  const hasCity = parts.slice(2).some((p) => {
    const n = _norm(p);
    return n && !/^\d+$/.test(n.replace(/ /g, '')) && !COUNTRY_RE.test(n) && !isStreet(p);
  });
  if (!hasCity) return s;
  return parts.slice(1).join(',').trim();
}
module.exports = { COUNTRY_RE, STREET_RE, isStreet, stripPlaceName };
